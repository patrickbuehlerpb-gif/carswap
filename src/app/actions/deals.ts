"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql as raw } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import {
  dealMessages,
  dealVehicleLocks,
  deals,
  listings,
  payments,
  vehicles,
  type DealRow,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { suspendedNotice } from "@/lib/auth/guards";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import {
  createEscrowCheckout,
  markPayment,
  paymentParties,
  payoutReady,
  releaseAuthorization,
  stripeConfigured,
} from "@/lib/payments";
import { mailConfigured, siteUrl } from "@/lib/mail";
import { addSystemMessage, benachrichtige, schliesseTauschAb } from "@/lib/abschluss";

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

  await benachrichtige(
    targetListing.listing.ownerId,
    "quitt: neuer Tauschvorschlag",
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
  await benachrichtige(
    otherId,
    "quitt: neue Nachricht zu deinem Tausch",
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
        "Eines der beiden Autos steckt schon in einem anderen zugesagten Tausch. Der muss " +
        "zuerst fertig oder abgebrochen sein.",
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
            // Ein gesperrtes Inserat bleibt gesperrt. Heute führt kein Weg
            // hierher, weil ein Vorschlag ein aktives Inserat verlangt — die
            // Bedingung hält das auch dann, wenn sich das einmal ändert.
            isNull(listings.blockedAt),
          ),
        );
    });
  } catch (err) {
    if (err instanceof DealConflict) return { error: err.message };
    if (isUniqueViolation(err)) {
      return {
        error:
          "Eines der beiden Autos steckt schon in einem anderen zugesagten Tausch. Der muss " +
          "zuerst fertig oder abgebrochen sein.",
      };
    }
    console.error("Zusage fehlgeschlagen:", err);
    return { error: "Die Zusage hat nicht geklappt. Bitte die Seite neu laden und erneut versuchen." };
  }

  await addSystemMessage(dealId, me.id, `${me.name} hat das Angebot angenommen.`);

  const otherId = deal.initiatorId === me.id ? deal.counterpartyId : deal.initiatorId;
  await benachrichtige(
    otherId,
    "quitt: Tausch angenommen",
    `${me.name} hat euren Tausch angenommen. Als Nächstes wird der Ausgleich hinterlegt.\n\n${siteUrl()}/deals/${dealId}\n`,
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
          "Der Tausch ist abgebrochen. Den hinterlegten Betrag konnten wir nicht sofort " +
          "freigeben. Eine Reservierung verfällt von selbst. Ist schon abgebucht worden, " +
          "meldet sich der Support bei dir.",
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
    await benachrichtige(
      parties.payeeId,
      "quitt: Auszahlungskonto einrichten",
      "Bei eurem Tausch wird als Nächstes der Ausgleich hinterlegt. Damit er bei dir ankommt, " +
        `richte bitte zuerst dein Auszahlungskonto ein.\n\n${siteUrl()}/konto\n`,
    );
    return {
      error:
        "Die Gegenseite hat noch kein Auszahlungskonto. Wir haben ihr eben geschrieben. " +
        "Sobald das steht, kannst du einzahlen.",
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
    return { error: "Die Übergabe kannst du erst bestätigen, wenn der Ausgleich hinterlegt ist." };
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
    await benachrichtige(
      otherId,
      "quitt: Übergabe bestätigt",
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
 * Übersetzt das Ergebnis der Abwicklung in das, was die Oberfläche zeigt.
 * Die Abwicklung selbst steht in lib/abschluss — der Wartungslauf stösst
 * dieselbe an, nur ohne jemanden, dem er etwas sagen könnte.
 */
async function settleDeal(deal: DealRow, actorId: string): Promise<ActionResult> {
  const ergebnis = await schliesseTauschAb(deal, actorId);
  switch (ergebnis.art) {
    case "fertig":
    case "belegt":
      return { ok: true };
    case "zahlungen-aus":
      return { error: "Zahlungen sind auf dieser Installation nicht eingerichtet." };
    case "zahlung-ungueltig":
      if (!ergebnis.zurueckgesetzt) return { ok: true };
      return {
        error:
          "Die hinterlegte Zahlung ist nicht mehr gültig. Eine Reservierung verfällt nach sieben " +
          "Tagen. Bitte zahl den Ausgleich noch einmal ein.",
      };
    case "kein-auszahlungskonto":
      return {
        error:
          "Wir können noch nicht auszahlen: der Gegenseite fehlt das Auszahlungskonto. Wir haben " +
          "ihr geschrieben. Danach kannst du die Übergabe noch einmal bestätigen.",
      };
    case "zahlung-nicht-abwickelbar":
      return { error: ergebnis.grund + " Bitte den Ausgleich neu einzahlen." };
    case "auszahlung-gescheitert":
      return {
        error:
          "Die Auszahlung hat nicht geklappt. Der Betrag liegt sicher, und die Autos sind noch " +
          "nicht umgeschrieben. Bestätige in ein paar Minuten noch einmal.",
      };
    case "umschreiben-gescheitert":
      return {
        error:
          "Der Ausgleich ist ausgezahlt, aber das Umschreiben der Autos hat nicht geklappt. " +
          "Bestätige gleich noch einmal. Hilft das nicht, meldet sich der Support.",
      };
  }
}


