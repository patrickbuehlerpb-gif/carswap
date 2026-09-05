import "server-only";
import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, ne, or, sql as raw } from "drizzle-orm";
import { db } from "./db";
import { newId } from "./db/ids";
import {
  dealMessages,
  dealVehicleLocks,
  deals,
  listings,
  payments,
  users,
  vehicles,
  type DealRow,
} from "./db/schema";
import { sendMail, siteUrl } from "./mail";
import {
  authorizationExpiresAt,
  captureAndPayout,
  paymentParties,
  stripeConfigured,
  PaymentStateError,
  PayoutBlockedError,
} from "./payments";

/**
 * Die Zustandsmaschine hinter dem Abschluss eines Zweiertauschs.
 *
 * Sie stand ursprünglich in der Aktionsdatei. Dort lag sie falsch: was aus
 * einer «use server»-Datei exportiert wird, ist vom Browser aus aufrufbar,
 * und nicht exportiert ist es für den Wartungslauf unerreichbar. Genau den
 * braucht es aber — scheitert die Weiterleitung nach dem Einzug, liegt Geld
 * auf dem Plattformkonto, das jemand anderem gehört, und heilt heute nur,
 * wenn eine der beiden Seiten von selbst zurückkommt.
 *
 * Die Texte für die Oberfläche bleiben in der Aktion. Hier steht nur, was
 * mit Fahrzeugen, Inseraten und Zählern passiert.
 */

export async function addSystemMessage(dealId: string, authorId: string, text: string) {
  await db.insert(dealMessages).values({
    id: newId("msg"),
    dealId,
    authorId,
    body: text,
    system: true,
  });
}

export async function benachrichtige(userId: string, subject: string, text: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) return;
  await sendMail({ to: user.email, subject, text });
}

/** Übernimmt einen beidseitig bestätigten Tausch exklusiv zur Abwicklung. */
export async function claimForSettlement(dealId: string): Promise<DealRow | null> {
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
export async function releaseSettlement(dealId: string): Promise<void> {
  await db
    .update(deals)
    .set({ status: "treuhand", updatedAt: new Date() })
    .where(and(eq(deals.id, dealId), eq(deals.status, "abwicklung")));
}

/** Schliesst den Tausch ab: Halterwechsel, Inserate, Zähler, Sperren lösen. */
export async function completeDeal(deal: DealRow): Promise<void> {
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

/**
 * Ergebnis eines Abschlussversuchs.
 *
 * Bewusst ohne fertige Sätze: dieselbe Abwicklung läuft aus zwei Richtungen —
 * jemand bestätigt die Übergabe, oder der nächtliche Lauf holt einen
 * steckengebliebenen Abschluss nach. Was der eine als Fehlermeldung zeigt,
 * zählt der andere nur mit.
 */
export type AbschlussErgebnis =
  | { art: "fertig" }
  /** Die Gegenseite wickelt im selben Moment ab — hier ist nichts zu tun. */
  | { art: "belegt" }
  | { art: "zahlungen-aus" }
  /** Reservierung verfallen oder storniert: zurück in die Zusage. */
  | { art: "zahlung-ungueltig"; zurueckgesetzt: boolean }
  | { art: "kein-auszahlungskonto"; payeeId: string }
  | { art: "zahlung-nicht-abwickelbar"; grund: string }
  | { art: "auszahlung-gescheitert" }
  /** Das Geld ist beim Empfänger, die Fahrzeuge sind noch nicht umgeschrieben. */
  | { art: "umschreiben-gescheitert" };

/**
 * Wickelt einen beidseitig bestätigten Tausch ab: Geld einziehen, weiterleiten,
 * danach die Fahrzeuge umschreiben. Schlägt ein Schritt fehl, bleibt der Tausch
 * in der Treuhandphase und lässt sich erneut anstossen — die Fahrzeuge wechseln
 * erst, wenn das Geld tatsächlich beim Empfänger ist.
 */
export async function schliesseTauschAb(
  deal: DealRow,
  actorId: string,
): Promise<AbschlussErgebnis> {
  const parties = paymentParties(deal);

  if (!parties) {
    const claimed = await claimForSettlement(deal.id);
    if (!claimed) return { art: "belegt" };
    try {
      await completeDeal(claimed);
    } catch (err) {
      await releaseSettlement(deal.id);
      console.error(`Abschluss von Tausch ${deal.id} fehlgeschlagen:`, err);
      return { art: "auszahlung-gescheitert" };
    }
    return { art: "fertig" };
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
      return { art: "zahlung-ungueltig", zurueckgesetzt: false };
    }
    await addSystemMessage(
      deal.id,
      actorId,
      "Die hinterlegte Zahlung ist nicht mehr gültig. Der Ausgleich muss neu eingezahlt werden, " +
        "bevor der Tausch abgeschlossen werden kann.",
    );
    return { art: "zahlung-ungueltig", zurueckgesetzt: true };
  }

  if (!stripeConfigured()) return { art: "zahlungen-aus" };

  const claimed = await claimForSettlement(deal.id);
  if (!claimed) {
    // Die Gegenseite hat die Abwicklung im selben Moment angestossen.
    return { art: "belegt" };
  }

  let settled;
  try {
    settled = await captureAndPayout(payment);
  } catch (err) {
    await releaseSettlement(deal.id);
    if (err instanceof PayoutBlockedError) {
      await benachrichtige(
        payment.payeeId,
        "quitt: Auszahlungskonto fehlt noch",
        "Euer Tausch ist übergeben und der Ausgleich liegt bereit. Sobald du dein " +
          `Auszahlungskonto eingerichtet hast, wird er ausgezahlt.\n\n${siteUrl()}/konto\n`,
      );
      return { art: "kein-auszahlungskonto", payeeId: payment.payeeId };
    }
    if (err instanceof PaymentStateError) {
      console.error(`Zahlung zu Tausch ${deal.id} nicht abwickelbar:`, err);
      return { art: "zahlung-nicht-abwickelbar", grund: err.message };
    }
    console.error("Auszahlung fehlgeschlagen:", err);
    return { art: "auszahlung-gescheitert" };
  }

  if (settled.status !== "ausgezahlt") {
    await releaseSettlement(deal.id);
    return { art: "auszahlung-gescheitert" };
  }

  try {
    await completeDeal(claimed);
  } catch (err) {
    // Das Geld ist bereits beim Empfänger. Der Tausch bleibt in «abwicklung»
    // und lässt sich erneut anstossen — freigeben wäre hier falsch.
    console.error(`Abschluss von Tausch ${deal.id} nach erfolgter Auszahlung fehlgeschlagen:`, err);
    return { art: "umschreiben-gescheitert" };
  }
  return { art: "fertig" };
}
