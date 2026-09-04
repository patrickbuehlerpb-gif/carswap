"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNotNull, or, sql as raw } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import {
  dealMessages,
  deals,
  listings,
  payments,
  users,
  vehicles,
  type DealRow,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import {
  captureAndPayout,
  createEscrowCheckout,
  paymentParties,
  releaseAuthorization,
  stripeConfigured,
} from "@/lib/payments";
import { sendMail, siteUrl } from "@/lib/mail";

export interface ActionResult {
  ok?: boolean;
  error?: string;
  /** Weiterleitung, die der Client selbst ausführt (z.B. zu Stripe) */
  redirectTo?: string;
}

const OPEN: DealRow["status"][] = ["vorschlag", "verhandlung"];

/** Lädt einen Tausch und stellt sicher, dass der Aufrufer beteiligt ist. */
async function loadDeal(dealId: string, userId: string): Promise<DealRow | null> {
  const rows = await db
    .select()
    .from(deals)
    .where(
      and(eq(deals.id, dealId), or(eq(deals.initiatorId, userId), eq(deals.counterpartyId, userId))),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function addSystemMessage(dealId: string, authorId: string, text: string) {
  await db.insert(dealMessages).values({
    id: newId("msg"),
    dealId,
    authorId,
    body: text,
    system: true,
  });
}

async function notify(userId: string, subject: string, text: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) return;
  await sendMail({ to: user.email, subject, text });
}

/* ------------------------------------------------------------------ */
/* Vorschlag anlegen                                                   */
/* ------------------------------------------------------------------ */

const proposeSchema = z.object({
  fromVehicleId: z.string().min(1),
  toVehicleId: z.string().min(1),
  cashDelta: z.number().int().min(-2_000_000).max(2_000_000),
  message: z.string().trim().max(4000),
});

export async function proposeSwapAction(input: {
  fromVehicleId: string;
  toVehicleId: string;
  cashDelta: number;
  message: string;
}): Promise<ActionResult & { dealId?: string }> {
  const me = await requireUser();

  const limit = await checkRateLimit(`propose:${me.id}`, 20, 60 * 60);
  if (!limit.ok) return { error: "Zu viele Vorschläge in kurzer Zeit. Bitte kurz warten." };

  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) return { error: "Die Angaben zum Tausch sind unvollständig." };

  // Beide Fahrzeuge frisch aus der Datenbank — der Client liefert nur die IDs.
  const [mine] = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, parsed.data.fromVehicleId), eq(vehicles.ownerId, me.id)))
    .limit(1);
  if (!mine) return { error: "Dieses Fahrzeug gehört nicht zu deinem Konto." };

  const [targetListing] = await db
    .select({ listing: listings, vehicle: vehicles })
    .from(listings)
    .innerJoin(vehicles, eq(vehicles.id, listings.vehicleId))
    .where(and(eq(listings.vehicleId, parsed.data.toVehicleId), eq(listings.status, "aktiv")))
    .limit(1);
  if (!targetListing) return { error: "Dieses Inserat ist nicht mehr verfügbar." };
  if (targetListing.listing.ownerId === me.id) {
    return { error: "Du kannst dir kein eigenes Fahrzeug vorschlagen." };
  }

  // Kein zweiter offener Vorschlag für dieselbe Kombination
  const existing = await db
    .select({ id: deals.id })
    .from(deals)
    .where(
      and(
        eq(deals.fromVehicleId, mine.id),
        eq(deals.toVehicleId, targetListing.vehicle.id),
        or(eq(deals.status, "vorschlag"), eq(deals.status, "verhandlung"), eq(deals.status, "angenommen")),
      ),
    )
    .limit(1);
  if (existing.length) {
    return { error: "Für diese Kombination läuft bereits ein Vorschlag.", dealId: existing[0].id };
  }

  const dealId = newId("dl");
  await db.transaction(async (tx) => {
    await tx.insert(deals).values({
      id: dealId,
      fromVehicleId: mine.id,
      toVehicleId: targetListing.vehicle.id,
      initiatorId: me.id,
      counterpartyId: targetListing.listing.ownerId,
      cashDelta: parsed.data.cashDelta,
      status: "vorschlag",
    });
    await tx.insert(dealMessages).values({
      id: newId("msg"),
      dealId,
      authorId: me.id,
      body: parsed.data.message || "Ich hätte Interesse an einem Tausch.",
      offerCash: parsed.data.cashDelta,
    });
  });

  await notify(
    targetListing.listing.ownerId,
    "CarSwap: neuer Tauschvorschlag",
    `${me.name} schlägt einen Tausch für deinen ${targetListing.vehicle.make} ${targetListing.vehicle.model} vor.\n\n` +
      `${siteUrl()}/deals/${dealId}\n`,
  );

  revalidatePath("/deals");
  return { ok: true, dealId };
}

/* ------------------------------------------------------------------ */
/* Nachricht und Gegenangebot                                          */
/* ------------------------------------------------------------------ */

export async function sendDealMessageAction(
  dealId: string,
  text: string,
  offerCash?: number,
): Promise<ActionResult> {
  const me = await requireUser();
  const deal = await loadDeal(dealId, me.id);
  if (!deal) return { error: "Tausch nicht gefunden." };
  if (!OPEN.includes(deal.status) && deal.status !== "angenommen" && deal.status !== "treuhand") {
    return { error: "Dieser Vorgang ist abgeschlossen." };
  }

  const body = text.trim().slice(0, 4000);
  const hasOffer = typeof offerCash === "number" && Number.isInteger(offerCash);
  if (!body && !hasOffer) return { error: "Die Nachricht ist leer." };
  if (hasOffer && (offerCash! < -2_000_000 || offerCash! > 2_000_000)) {
    return { error: "Der Betrag liegt ausserhalb des zulässigen Bereichs." };
  }
  // Nach der Zusage ist der Betrag verbindlich
  if (hasOffer && (deal.status === "angenommen" || deal.status === "treuhand")) {
    return { error: "Nach der Zusage lässt sich der Betrag nicht mehr ändern." };
  }

  const limit = await checkRateLimit(`msg:${me.id}`, 60, 60 * 60);
  if (!limit.ok) return { error: "Zu viele Nachrichten in kurzer Zeit." };

  await db.transaction(async (tx) => {
    await tx.insert(dealMessages).values({
      id: newId("msg"),
      dealId,
      authorId: me.id,
      body: body || "Neues Angebot.",
      offerCash: hasOffer ? offerCash : null,
    });
    await tx
      .update(deals)
      .set({
        cashDelta: hasOffer ? offerCash! : deal.cashDelta,
        status: deal.status === "vorschlag" ? "verhandlung" : deal.status,
        updatedAt: new Date(),
      })
      .where(eq(deals.id, dealId));
  });

  const otherId = deal.initiatorId === me.id ? deal.counterpartyId : deal.initiatorId;
  await notify(
    otherId,
    "CarSwap: neue Nachricht zu deinem Tausch",
    `${me.name} hat dir geschrieben.\n\n${siteUrl()}/deals/${dealId}\n`,
  );

  revalidatePath(`/deals/${dealId}`);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Annehmen und ablehnen                                               */
/* ------------------------------------------------------------------ */

export async function acceptDealAction(dealId: string): Promise<ActionResult> {
  const me = await requireUser();
  const deal = await loadDeal(dealId, me.id);
  if (!deal) return { error: "Tausch nicht gefunden." };
  if (!OPEN.includes(deal.status)) return { error: "Dieser Vorschlag ist nicht mehr offen." };

  // Wer zuletzt einen Betrag geboten hat, kann ihn nicht selbst annehmen.
  const [lastOffer] = await db
    .select()
    .from(dealMessages)
    .where(and(eq(dealMessages.dealId, dealId), isNotNull(dealMessages.offerCash)))
    .orderBy(desc(dealMessages.createdAt))
    .limit(1);
  if (lastOffer && lastOffer.authorId === me.id) {
    return { error: "Du hast das aktuelle Angebot selbst gemacht — die Gegenseite ist am Zug." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(deals)
      .set({ status: "angenommen", acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(deals.id, dealId));
    // Beide Inserate aus dem Markt nehmen, solange der Tausch läuft
    await tx
      .update(listings)
      .set({ status: "in verhandlung", updatedAt: new Date() })
      .where(eq(listings.vehicleId, deal.toVehicleId));
    await tx
      .update(listings)
      .set({ status: "in verhandlung", updatedAt: new Date() })
      .where(eq(listings.vehicleId, deal.fromVehicleId));
  });
  await addSystemMessage(dealId, me.id, `${me.name} hat das Angebot angenommen.`);

  const otherId = deal.initiatorId === me.id ? deal.counterpartyId : deal.initiatorId;
  await notify(
    otherId,
    "CarSwap: Tausch angenommen",
    `${me.name} hat euren Tausch angenommen. Nächster Schritt ist die Treuhand-Einzahlung.\n\n${siteUrl()}/deals/${dealId}\n`,
  );

  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/markt");
  return { ok: true };
}

export async function rejectDealAction(dealId: string): Promise<ActionResult> {
  const me = await requireUser();
  const deal = await loadDeal(dealId, me.id);
  if (!deal) return { error: "Tausch nicht gefunden." };
  if (!OPEN.includes(deal.status)) return { error: "Dieser Vorschlag ist nicht mehr offen." };

  await db
    .update(deals)
    .set({ status: "abgelehnt", updatedAt: new Date() })
    .where(eq(deals.id, dealId));
  await addSystemMessage(dealId, me.id, `${me.name} hat den Vorschlag abgelehnt.`);

  revalidatePath(`/deals/${dealId}`);
  return { ok: true };
}

/**
 * Bricht einen bereits zugesagten Tausch ab. Eine hinterlegte Zahlung wird
 * freigegeben bzw. erstattet.
 */
export async function cancelDealAction(dealId: string): Promise<ActionResult> {
  const me = await requireUser();
  const deal = await loadDeal(dealId, me.id);
  if (!deal) return { error: "Tausch nicht gefunden." };
  if (deal.status !== "angenommen" && deal.status !== "treuhand") {
    return { error: "In diesem Zustand ist kein Abbruch nötig." };
  }

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.dealId, dealId))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  if (payment && stripeConfigured()) {
    try {
      await releaseAuthorization(payment);
    } catch (err) {
      console.error("Freigabe der Zahlung fehlgeschlagen:", err);
      return {
        error:
          "Die hinterlegte Zahlung konnte nicht freigegeben werden. Bitte melde dich beim Support, " +
          "bevor du es erneut versuchst.",
      };
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(deals)
      .set({ status: "storniert", updatedAt: new Date() })
      .where(eq(deals.id, dealId));
    for (const vehicleId of [deal.fromVehicleId, deal.toVehicleId]) {
      await tx
        .update(listings)
        .set({ status: "aktiv", updatedAt: new Date() })
        .where(and(eq(listings.vehicleId, vehicleId), eq(listings.status, "in verhandlung")));
    }
  });
  await addSystemMessage(dealId, me.id, `${me.name} hat den Tausch abgebrochen.`);

  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/markt");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Treuhand                                                            */
/* ------------------------------------------------------------------ */

export async function startEscrowAction(dealId: string): Promise<ActionResult> {
  const me = await requireUser();
  const deal = await loadDeal(dealId, me.id);
  if (!deal) return { error: "Tausch nicht gefunden." };
  if (deal.status !== "angenommen") {
    return { error: "Die Einzahlung ist erst nach beidseitiger Zusage möglich." };
  }

  const parties = paymentParties(deal);

  // Ohne Wertdifferenz gibt es nichts zu hinterlegen
  if (!parties) {
    await db
      .update(deals)
      .set({ status: "treuhand", escrowAt: new Date(), updatedAt: new Date() })
      .where(eq(deals.id, dealId));
    await addSystemMessage(dealId, me.id, "Kein Ausgleich nötig — weiter zur Übergabe.");
    revalidatePath(`/deals/${dealId}`);
    return { ok: true };
  }

  if (parties.payerId !== me.id) {
    return { error: "Die Einzahlung macht die Gegenseite — bei dir ist nichts zu tun." };
  }
  if (!stripeConfigured()) {
    return {
      error:
        "Zahlungen sind auf dieser Installation noch nicht eingerichtet (STRIPE_SECRET_KEY fehlt).",
    };
  }

  const [fromVehicle] = await db.select().from(vehicles).where(eq(vehicles.id, deal.fromVehicleId));
  const [toVehicle] = await db.select().from(vehicles).where(eq(vehicles.id, deal.toVehicleId));

  try {
    const checkout = await createEscrowCheckout(
      deal,
      `${fromVehicle.make} ${fromVehicle.model} gegen ${toVehicle.make} ${toVehicle.model}`,
    );
    return { ok: true, redirectTo: checkout.url };
  } catch (err) {
    console.error("Checkout konnte nicht angelegt werden:", err);
    return { error: "Die Zahlung konnte nicht vorbereitet werden. Bitte später erneut versuchen." };
  }
}

/**
 * Bestätigt die Übergabe. Sobald beide bestätigt haben, wird der Betrag
 * eingezogen, weitergeleitet und der Fahrzeughalter gewechselt.
 */
export async function confirmHandoverAction(dealId: string): Promise<ActionResult> {
  const me = await requireUser();
  const deal = await loadDeal(dealId, me.id);
  if (!deal) return { error: "Tausch nicht gefunden." };
  if (deal.status !== "treuhand") {
    return { error: "Die Übergabe lässt sich erst nach der Treuhand-Einzahlung bestätigen." };
  }

  const iAmInitiator = deal.initiatorId === me.id;
  const updated = await db
    .update(deals)
    .set({
      ...(iAmInitiator ? { initiatorConfirmed: true } : { counterpartyConfirmed: true }),
      updatedAt: new Date(),
    })
    .where(eq(deals.id, dealId))
    .returning();
  const fresh = updated[0];
  await addSystemMessage(dealId, me.id, `${me.name} hat die Übergabe bestätigt.`);

  if (!fresh.initiatorConfirmed || !fresh.counterpartyConfirmed) {
    const otherId = iAmInitiator ? deal.counterpartyId : deal.initiatorId;
    await notify(
      otherId,
      "CarSwap: Übergabe bestätigt",
      `${me.name} hat die Übergabe bestätigt. Sobald du das ebenfalls tust, wird der Ausgleich ausgezahlt.\n\n${siteUrl()}/deals/${dealId}\n`,
    );
    revalidatePath(`/deals/${dealId}`);
    return { ok: true };
  }

  // Beide haben bestätigt: Geld einziehen und weiterleiten
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.dealId, dealId))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  if (payment && stripeConfigured()) {
    try {
      await captureAndPayout(payment);
    } catch (err) {
      console.error("Auszahlung fehlgeschlagen:", err);
      return {
        error:
          "Die Übergabe ist vermerkt, aber die Auszahlung ist fehlgeschlagen. " +
          "Der Support kümmert sich darum — der Betrag ist sicher hinterlegt.",
      };
    }
  }

  await completeDeal(fresh);
  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/garage");
  return { ok: true };
}

/** Schliesst den Tausch ab: Halterwechsel, Inserate schliessen, Zähler hoch. */
async function completeDeal(deal: DealRow): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(deals)
      .set({ status: "abgeschlossen", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(deals.id, deal.id));

    // Die Fahrzeuge wechseln den Besitzer
    await tx
      .update(vehicles)
      .set({ ownerId: deal.counterpartyId, updatedAt: new Date() })
      .where(eq(vehicles.id, deal.fromVehicleId));
    await tx
      .update(vehicles)
      .set({ ownerId: deal.initiatorId, updatedAt: new Date() })
      .where(eq(vehicles.id, deal.toVehicleId));

    // Inserate schliessen — das neue Fahrzeug wird bei Bedarf neu eingestellt
    await tx
      .update(listings)
      .set({ status: "getauscht", updatedAt: new Date() })
      .where(eq(listings.vehicleId, deal.fromVehicleId));
    await tx
      .update(listings)
      .set({ status: "getauscht", updatedAt: new Date() })
      .where(eq(listings.vehicleId, deal.toVehicleId));

    for (const userId of [deal.initiatorId, deal.counterpartyId]) {
      await tx
        .update(users)
        .set({ swapsCompleted: raw`${users.swapsCompleted} + 1`, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }
  });
}
