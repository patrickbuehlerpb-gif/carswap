"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, isNotNull, ne, or, sql as raw } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import {
  dealMessages,
  dealVehicleLocks,
  deals,
  listings,
  payments,
  users,
  vehicles,
  type DealRow,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { suspendedNotice } from "@/lib/auth/guards";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import {
  captureAndPayout,
  createEscrowCheckout,
  markPayment,
  paymentParties,
  payoutReady,
  releaseAuthorization,
  stripeConfigured,
  authorizationExpiresAt,
  PaymentStateError,
  PayoutBlockedError,
} from "@/lib/payments";
import { mailConfigured, sendMail, siteUrl } from "@/lib/mail";

export interface ActionResult {
  ok?: boolean;
  error?: string;
  /** Weiterleitung, die der Client selbst ausführt (z.B. zu Stripe) */
  redirectTo?: string;
}

const OPEN: DealRow["status"][] = ["vorschlag", "verhandlung"];

/**
 * Verbindliche Schritte setzen eine bestätigte E-Mail-Adresse voraus — sonst
 * steht die Gegenseite am Ende mit einer Adresse da, die nie jemand erreicht
 * hat. Die Oberfläche kündigt genau das an.
 *
 * Kann diese Installation gar keine Mails verschicken, wäre die Bestätigung
 * unmöglich und die Regel würde jeden aussperren. Dann greift sie nicht — der
 * Zustand steht in /api/health und im README.
 */
function braucheBestaetigteMail(me: { emailVerified?: boolean }): string | null {
  if (!mailConfigured()) return null;
  if (me.emailVerified) return null;
  return (
    "Bitte bestätige zuerst deine E-Mail-Adresse — den Link findest du in deinem Postfach, " +
    "erneut senden kannst du ihn unter «Konto»."
  );
}

/** Der Tausch hat den Zustand gewechselt, während die Aktion lief. */
class DealConflict extends Error {}

/**
 * Postgres meldet eine verletzte Eindeutigkeit mit SQLSTATE 23505. Drizzle
 * verpackt den Treiberfehler in einen eigenen, deshalb wird die Kette der
 * Ursachen durchgesehen statt nur die oberste Ebene.
 */
function isUniqueViolation(err: unknown): boolean {
  for (let cur: unknown = err, depth = 0; cur && depth < 5; depth++) {
    if (typeof cur !== "object") break;
    if ((cur as { code?: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

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
  const stillgelegt = suspendedNotice(me);
  if (stillgelegt) return { error: stillgelegt };
  const unbestaetigt = braucheBestaetigteMail(me);
  if (unbestaetigt) return { error: unbestaetigt };

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

  try {
    await db.transaction(async (tx) => {
      await tx.insert(dealMessages).values({
        id: newId("msg"),
        dealId,
        authorId: me.id,
        body: body || "Neues Angebot.",
        offerCash: hasOffer ? offerCash : null,
      });

      if (hasOffer) {
        // Der Betrag darf nur wechseln, solange der Tausch offen ist. Die
        // Bedingung steht in der Abfrage, nicht in einer vorher gelesenen
        // Kopie — sonst überschreibt eine gleichzeitige Zusage den Zustand.
        const changed = await tx
          .update(deals)
          .set({ cashDelta: offerCash!, status: "verhandlung", updatedAt: new Date() })
          .where(and(eq(deals.id, dealId), inArray(deals.status, OPEN)))
          .returning({ id: deals.id });
        if (!changed.length) {
          throw new DealConflict(
            "Der Tausch hat inzwischen den Zustand gewechselt — bitte die Seite neu laden.",
          );
        }
      } else {
        await tx
          .update(deals)
          .set({ status: "verhandlung", updatedAt: new Date() })
          .where(and(eq(deals.id, dealId), eq(deals.status, "vorschlag")));
        await tx.update(deals).set({ updatedAt: new Date() }).where(eq(deals.id, dealId));
      }
    });
  } catch (err) {
    if (err instanceof DealConflict) return { error: err.message };
    throw err;
  }

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
  const stillgelegt = suspendedNotice(me);
  if (stillgelegt) return { error: stillgelegt };
  const unbestaetigt = braucheBestaetigteMail(me);
  if (unbestaetigt) return { error: unbestaetigt };

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

  // Gehören beide Fahrzeuge noch den Personen, über die hier verhandelt wird?
  const owners = await db
    .select({ id: vehicles.id, ownerId: vehicles.ownerId })
    .from(vehicles)
    .where(inArray(vehicles.id, [deal.fromVehicleId, deal.toVehicleId]));
  const fromOwner = owners.find((v) => v.id === deal.fromVehicleId)?.ownerId;
  const toOwner = owners.find((v) => v.id === deal.toVehicleId)?.ownerId;
  if (fromOwner !== deal.initiatorId || toOwner !== deal.counterpartyId) {
    return { error: "Eines der Fahrzeuge hat inzwischen den Besitzer gewechselt." };
  }

  // Steckt eines der Fahrzeuge schon in einem verbindlichen Tausch? Die
  // Sperrtabelle fängt das ohnehin ab; diese Abfrage gilt zusätzlich für
  // Tausche, die vor der Einführung der Sperren zugesagt wurden.
  const gebunden = await db
    .select({ id: deals.id })
    .from(deals)
    .where(
      and(
        ne(deals.id, dealId),
        inArray(deals.status, ["angenommen", "treuhand", "abwicklung"]),
        or(
          inArray(deals.fromVehicleId, [deal.fromVehicleId, deal.toVehicleId]),
          inArray(deals.toVehicleId, [deal.fromVehicleId, deal.toVehicleId]),
        ),
      ),
    )
    .limit(1);
  if (gebunden.length) {
    return {
      error:
        "Eines der beiden Fahrzeuge steckt bereits in einem anderen zugesagten Tausch. " +
        "Dieser muss zuerst abgeschlossen oder abgebrochen werden.",
    };
  }

  try {
    await db.transaction(async (tx) => {
      // Der angenommene Betrag muss der sein, der beim Laden der Seite galt.
      // Ein gleichzeitig eintreffendes Gegenangebot darf die Zusage nicht
      // stillschweigend auf einen anderen Betrag umbiegen. (Auf updatedAt
      // lässt sich nicht vergleichen: Postgres speichert Mikrosekunden,
      // die JS-Seite sieht nur Millisekunden.)
      const moved = await tx
        .update(deals)
        .set({ status: "angenommen", acceptedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(deals.id, dealId),
            inArray(deals.status, OPEN),
            eq(deals.cashDelta, deal.cashDelta),
          ),
        )
        .returning({ id: deals.id });
      if (!moved.length) {
        throw new DealConflict(
          "Der Vorschlag hat sich inzwischen geändert. Bitte die Seite neu laden und den " +
            "aktuellen Stand ansehen.",
        );
      }

      // Fahrzeugsperre: der Primärschlüssel auf der Fahrzeug-ID lässt eine
      // zweite, gleichzeitige Zusage für dasselbe Auto auflaufen.
      await tx.insert(dealVehicleLocks).values([
        { vehicleId: deal.fromVehicleId, dealId },
        { vehicleId: deal.toVehicleId, dealId },
      ]);

      // Beide Inserate aus dem Markt nehmen, solange der Tausch läuft
      await tx
        .update(listings)
        .set({ status: "in verhandlung", updatedAt: new Date() })
        .where(
          and(
            inArray(listings.vehicleId, [deal.fromVehicleId, deal.toVehicleId]),
            inArray(listings.status, ["aktiv", "pausiert", "getauscht"]),
          ),
        );
    });
  } catch (err) {
    if (err instanceof DealConflict) return { error: err.message };
    if (isUniqueViolation(err)) {
      return {
        error:
          "Eines der beiden Fahrzeuge steckt bereits in einem anderen zugesagten Tausch. " +
          "Dieser muss zuerst abgeschlossen oder abgebrochen werden.",
      };
    }
    console.error("Zusage fehlgeschlagen:", err);
    return { error: "Die Zusage hat nicht geklappt. Bitte die Seite neu laden und erneut versuchen." };
  }

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

  const rejected = await db
    .update(deals)
    .set({ status: "abgelehnt", updatedAt: new Date() })
    .where(and(eq(deals.id, dealId), inArray(deals.status, OPEN)))
    .returning({ id: deals.id });
  if (!rejected.length) return { error: "Dieser Vorschlag ist nicht mehr offen." };

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
  if (deal.status === "abwicklung") {
    return { error: "Der Ausgleich wird gerade ausgezahlt — ein Abbruch ist jetzt nicht mehr möglich." };
  }
  if (deal.status !== "angenommen" && deal.status !== "treuhand") {
    return { error: "In diesem Zustand ist kein Abbruch nötig." };
  }

  // Statuswechsel, Sperren und Inserate gehören in dieselbe Transaktion:
  // bricht der Vorgang dazwischen ab, wären die Fahrzeuge sonst dauerhaft
  // gesperrt, ohne dass ein zweiter Abbruch noch möglich wäre.
  try {
    await db.transaction(async (tx) => {
      const cancelled = await tx
        .update(deals)
        .set({ status: "storniert", updatedAt: new Date() })
        .where(and(eq(deals.id, dealId), inArray(deals.status, ["angenommen", "treuhand"])))
        .returning({ id: deals.id });
      if (!cancelled.length) {
        throw new DealConflict(
          "Der Tausch lässt sich gerade nicht abbrechen. Bitte die Seite neu laden.",
        );
      }
      await tx.delete(dealVehicleLocks).where(eq(dealVehicleLocks.dealId, dealId));
      await tx
        .update(listings)
        .set({ status: "aktiv", updatedAt: new Date() })
        .where(
          and(
            inArray(listings.vehicleId, [deal.fromVehicleId, deal.toVehicleId]),
            eq(listings.status, "in verhandlung"),
          ),
        );
    });
  } catch (err) {
    if (err instanceof DealConflict) return { error: err.message };
    throw err;
  }
  await addSystemMessage(dealId, me.id, `${me.name} hat den Tausch abgebrochen.`);
  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/markt");

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
      await markPayment(payment.id, payment.status, `Freigabe nach Abbruch fehlgeschlagen: ${err}`);
      return {
        error:
          "Der Tausch ist abgebrochen. Die hinterlegte Zahlung liess sich dabei nicht sofort " +
          "freigeben — eine Reservierung verfällt von selbst, bei einem bereits eingezogenen " +
          "Betrag meldet sich der Support.",
      };
    }
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Treuhand                                                            */
/* ------------------------------------------------------------------ */

export async function startEscrowAction(dealId: string): Promise<ActionResult> {
  const me = await requireUser();
  const stillgelegt = suspendedNotice(me);
  if (stillgelegt) return { error: stillgelegt };
  const unbestaetigt = braucheBestaetigteMail(me);
  if (unbestaetigt) return { error: unbestaetigt };

  const deal = await loadDeal(dealId, me.id);
  if (!deal) return { error: "Tausch nicht gefunden." };
  if (deal.status !== "angenommen") {
    return { error: "Die Einzahlung ist erst nach beidseitiger Zusage möglich." };
  }

  const parties = paymentParties(deal);

  // Ohne Wertdifferenz gibt es nichts zu hinterlegen
  if (!parties) {
    const moved = await db
      .update(deals)
      .set({ status: "treuhand", escrowAt: new Date(), updatedAt: new Date() })
      .where(and(eq(deals.id, dealId), eq(deals.status, "angenommen")))
      .returning({ id: deals.id });
    if (!moved.length) return { error: "Der Tausch ist nicht mehr im Zustand «angenommen»." };
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

  // Die Gegenseite muss das Geld auch empfangen können. Wird das erst beim
  // Einzug geprüft, liegt der Betrag hinterher auf dem Plattformkonto fest.
  if (!(await payoutReady(parties.payeeId))) {
    await notify(
      parties.payeeId,
      "CarSwap: Auszahlungskonto einrichten",
      "Für euren Tausch steht die Treuhand-Einzahlung an. Damit der Ausgleich bei dir ankommt, " +
        `richte bitte zuerst dein Auszahlungskonto ein.\n\n${siteUrl()}/konto\n`,
    );
    return {
      error:
        "Die Gegenseite hat ihr Auszahlungskonto noch nicht eingerichtet. Wir haben sie eben " +
        "benachrichtigt — sobald das erledigt ist, kannst du einzahlen.",
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
  // «abwicklung» heisst: beide haben bestätigt und die Auszahlung läuft oder
  // ist steckengeblieben. Ein erneuter Aufruf setzt dort fort, statt den
  // Tausch in diesem Zustand einzusperren.
  if (deal.status !== "treuhand" && deal.status !== "abwicklung") {
    return { error: "Die Übergabe lässt sich erst nach der Treuhand-Einzahlung bestätigen." };
  }

  const iAmInitiator = deal.initiatorId === me.id;

  // Nur setzen, wenn die eigene Bestätigung wirklich noch fehlt. Ein zweiter
  // Klick läuft damit ins Leere, statt den Abschluss ein zweites Mal zu starten.
  const confirmed = await db
    .update(deals)
    .set({
      ...(iAmInitiator ? { initiatorConfirmed: true } : { counterpartyConfirmed: true }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(deals.id, dealId),
        eq(deals.status, "treuhand"),
        eq(iAmInitiator ? deals.initiatorConfirmed : deals.counterpartyConfirmed, false),
      ),
    )
    .returning({ id: deals.id });

  if (confirmed.length) {
    await addSystemMessage(dealId, me.id, `${me.name} hat die Übergabe bestätigt.`);
  }

  const [fresh] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!fresh) return { error: "Tausch nicht gefunden." };

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

  const result = await settleDeal(fresh, me.id);
  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/garage");
  return result;
}

/**
 * Wickelt einen beidseitig bestätigten Tausch ab: Geld einziehen, weiterleiten,
 * danach die Fahrzeuge umschreiben. Schlägt ein Schritt fehl, bleibt der Tausch
 * in der Treuhandphase und lässt sich erneut anstossen — die Fahrzeuge wechseln
 * erst, wenn das Geld tatsächlich beim Empfänger ist.
 */
async function settleDeal(deal: DealRow, actorId: string): Promise<ActionResult> {
  const parties = paymentParties(deal);

  if (!parties) {
    const claimed = await claimForSettlement(deal.id);
    if (!claimed) return { ok: true };
    try {
      await completeDeal(claimed);
    } catch (err) {
      await releaseSettlement(deal.id);
      console.error(`Abschluss von Tausch ${deal.id} fehlgeschlagen:`, err);
      return { error: "Der Abschluss hat nicht geklappt. Bitte die Seite neu laden." };
    }
    return { ok: true };
  }

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.dealId, deal.id))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  // Eine Reservierung, die älter als die Stripe-Frist ist, gilt als verfallen —
  // auch wenn das Stornierungsereignis noch nicht angekommen ist.
  const abgelaufen =
    payment?.status === "autorisiert" &&
    (authorizationExpiresAt(payment)?.getTime() ?? Infinity) < Date.now();

  const usable =
    payment &&
    !abgelaufen &&
    (payment.status === "autorisiert" ||
      payment.status === "eingezogen" ||
      payment.status === "ausgezahlt");

  if (!usable) {
    // Reservierung verfallen, storniert oder gar nie bezahlt: zurück in die
    // Zusage, damit der Ausgleich neu hinterlegt werden kann. Auf keinen Fall
    // die Fahrzeuge umschreiben.
    const zurueck = await db
      .update(deals)
      .set({
        status: "angenommen",
        escrowAt: null,
        initiatorConfirmed: false,
        counterpartyConfirmed: false,
        updatedAt: new Date(),
      })
      .where(and(eq(deals.id, deal.id), eq(deals.status, "treuhand")))
      .returning({ id: deals.id });
    if (!zurueck.length) {
      // Die Gegenseite war schneller — der Tausch wird gerade abgewickelt
      // oder wurde abgebrochen. Dann ist hier nichts zu melden.
      return { ok: true };
    }
    await addSystemMessage(
      deal.id,
      actorId,
      "Die hinterlegte Zahlung ist nicht mehr gültig. Der Ausgleich muss neu eingezahlt werden, " +
        "bevor der Tausch abgeschlossen werden kann.",
    );
    return {
      error:
        "Die hinterlegte Zahlung ist nicht mehr gültig — eine Reservierung verfällt nach sieben " +
        "Tagen. Bitte den Ausgleich erneut einzahlen.",
    };
  }

  if (!stripeConfigured()) {
    return { error: "Zahlungen sind auf dieser Installation nicht eingerichtet." };
  }

  const claimed = await claimForSettlement(deal.id);
  if (!claimed) {
    // Die Gegenseite hat die Abwicklung im selben Moment angestossen.
    return { ok: true };
  }

  let settled;
  try {
    settled = await captureAndPayout(payment);
  } catch (err) {
    await releaseSettlement(deal.id);
    if (err instanceof PayoutBlockedError) {
      await notify(
        payment.payeeId,
        "CarSwap: Auszahlungskonto fehlt noch",
        "Euer Tausch ist übergeben und der Ausgleich liegt bereit. Sobald du dein " +
          `Auszahlungskonto eingerichtet hast, wird er ausgezahlt.\n\n${siteUrl()}/konto\n`,
      );
      return {
        error:
          "Der Ausgleich kann noch nicht ausgezahlt werden, weil das Auszahlungskonto der " +
          "Gegenseite fehlt. Wir haben sie benachrichtigt — danach lässt sich die Übergabe " +
          "erneut bestätigen.",
      };
    }
    if (err instanceof PaymentStateError) {
      console.error(`Zahlung zu Tausch ${deal.id} nicht abwickelbar:`, err);
      return { error: err.message + " Bitte den Ausgleich neu einzahlen." };
    }
    console.error("Auszahlung fehlgeschlagen:", err);
    return {
      error:
        "Die Auszahlung ist fehlgeschlagen. Der Betrag ist sicher hinterlegt und die Fahrzeuge " +
        "sind noch nicht umgeschrieben — bitte in ein paar Minuten erneut bestätigen.",
    };
  }

  if (settled.status !== "ausgezahlt") {
    await releaseSettlement(deal.id);
    return {
      error:
        "Die Auszahlung ist nicht vollständig durchgelaufen. Die Fahrzeuge sind noch nicht " +
        "umgeschrieben — bitte erneut bestätigen.",
    };
  }

  try {
    await completeDeal(claimed);
  } catch (err) {
    // Das Geld ist bereits beim Empfänger. Der Tausch bleibt in «abwicklung»
    // und lässt sich erneut anstossen — freigeben wäre hier falsch.
    console.error(`Abschluss von Tausch ${deal.id} nach erfolgter Auszahlung fehlgeschlagen:`, err);
    return {
      error:
        "Der Ausgleich ist ausgezahlt, das Umschreiben der Fahrzeuge hat aber nicht geklappt. " +
        "Bitte gleich erneut bestätigen — hilft das nicht, meldet sich der Support.",
    };
  }
  return { ok: true };
}

/** Übernimmt einen beidseitig bestätigten Tausch exklusiv zur Abwicklung. */
async function claimForSettlement(dealId: string): Promise<DealRow | null> {
  const rows = await db
    .update(deals)
    .set({ status: "abwicklung", updatedAt: new Date() })
    .where(
      and(
        eq(deals.id, dealId),
        inArray(deals.status, ["treuhand", "abwicklung"]),
        eq(deals.initiatorConfirmed, true),
        eq(deals.counterpartyConfirmed, true),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** Gibt einen zur Abwicklung übernommenen Tausch wieder frei. */
async function releaseSettlement(dealId: string): Promise<void> {
  await db
    .update(deals)
    .set({ status: "treuhand", updatedAt: new Date() })
    .where(and(eq(deals.id, dealId), eq(deals.status, "abwicklung")));
}

/** Schliesst den Tausch ab: Halterwechsel, Inserate, Zähler, Sperren lösen. */
async function completeDeal(deal: DealRow): Promise<void> {
  const dropped: { id: string; initiatorId: string }[] = [];

  await db.transaction(async (tx) => {
    const done = await tx
      .update(deals)
      .set({ status: "abgeschlossen", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(deals.id, deal.id), eq(deals.status, "abwicklung")))
      .returning({ id: deals.id });
    if (!done.length) return;

    // Die Fahrzeuge wechseln den Besitzer — aber nur, wenn sie noch den
    // Personen gehören, die den Tausch geschlossen haben.
    const fromMoved = await tx
      .update(vehicles)
      .set({ ownerId: deal.counterpartyId, updatedAt: new Date() })
      .where(and(eq(vehicles.id, deal.fromVehicleId), eq(vehicles.ownerId, deal.initiatorId)))
      .returning({ id: vehicles.id });
    const toMoved = await tx
      .update(vehicles)
      .set({ ownerId: deal.initiatorId, updatedAt: new Date() })
      .where(and(eq(vehicles.id, deal.toVehicleId), eq(vehicles.ownerId, deal.counterpartyId)))
      .returning({ id: vehicles.id });
    if (!fromMoved.length || !toMoved.length) {
      throw new Error(
        `Halterwechsel für Tausch ${deal.id} abgebrochen: ein Fahrzeug gehört nicht mehr der erwarteten Person.`,
      );
    }

    // Die Inserate wandern mit. Ohne das könnte der neue Halter sein Fahrzeug
    // nie wieder einstellen — auf listings.vehicle_id liegt ein Unique-Index.
    await tx
      .update(listings)
      .set({ ownerId: deal.counterpartyId, status: "getauscht", updatedAt: new Date() })
      .where(eq(listings.vehicleId, deal.fromVehicleId));
    await tx
      .update(listings)
      .set({ ownerId: deal.initiatorId, status: "getauscht", updatedAt: new Date() })
      .where(eq(listings.vehicleId, deal.toVehicleId));

    // Offene Vorschläge zu denselben Fahrzeugen sind damit hinfällig
    const others = await tx
      .update(deals)
      .set({ status: "storniert", updatedAt: new Date() })
      .where(
        and(
          ne(deals.id, deal.id),
          inArray(deals.status, ["vorschlag", "verhandlung"]),
          or(
            inArray(deals.fromVehicleId, [deal.fromVehicleId, deal.toVehicleId]),
            inArray(deals.toVehicleId, [deal.fromVehicleId, deal.toVehicleId]),
          ),
        ),
      )
      .returning({ id: deals.id, initiatorId: deals.initiatorId });
    dropped.push(...others);

    await tx.delete(dealVehicleLocks).where(eq(dealVehicleLocks.dealId, deal.id));

    for (const userId of [deal.initiatorId, deal.counterpartyId]) {
      await tx
        .update(users)
        .set({ swapsCompleted: raw`${users.swapsCompleted} + 1`, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }
  });

  for (const other of dropped) {
    await addSystemMessage(
      other.id,
      other.initiatorId,
      "Eines der beiden Fahrzeuge wurde inzwischen anders getauscht — dieser Vorschlag ist hinfällig.",
    );
  }
  if (dropped.length) revalidatePath("/deals");
}
