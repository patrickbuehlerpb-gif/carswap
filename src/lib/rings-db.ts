import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import { newId } from "./db/ids";
import {
  dealMessages,
  dealVehicleLocks,
  listings,
  payments,
  ringLegs,
  ringSwaps,
  type RingLegRow,
  type RingSwapRow,
} from "./db/schema";
import { ringTransfers, type RingTransfer } from "./rings";
import {
  authorizationExpiresAt,
  currentRingPayments,
  markPayment,
  releaseAuthorization,
} from "./payments";

/**
 * Datenbanknahe Bausteine des Ringtauschs. Sie liegen bewusst nicht in der
 * Aktionsdatei: der Stripe-Webhook braucht dieselben Schritte, ist aber keine
 * Server-Aktion und darf deshalb nicht aus einem `"use server"`-Modul lesen.
 */

export interface RingWithLegs {
  ring: RingSwapRow;
  /** Immer nach Position sortiert — davon hängt die Zerlegung der Zahlungen ab. */
  legs: RingLegRow[];
}

export async function loadRing(ringId: string): Promise<RingWithLegs | null> {
  const [ring] = await db.select().from(ringSwaps).where(eq(ringSwaps.id, ringId)).limit(1);
  if (!ring) return null;
  const legs = await db
    .select()
    .from(ringLegs)
    .where(eq(ringLegs.ringId, ringId))
    .orderBy(asc(ringLegs.position));
  if (legs.length !== 3) return null;
  return { ring, legs };
}

/** Die Zahlungen, die dieser Ring braucht — abgeleitet, nie gespeichert. */
export function transfersFor(legs: RingLegRow[]): RingTransfer[] {
  return ringTransfers(legs.map((l) => ({ userId: l.userId, cash: l.cash })));
}

export async function addRingSystemMessage(
  ringId: string,
  authorId: string,
  text: string,
): Promise<void> {
  await db.insert(dealMessages).values({
    id: newId("msg"),
    ringId,
    authorId,
    body: text,
    system: true,
  });
}

/**
 * Liegt für jede nötige Zahlung eine gültige Reservierung vor? Erst dann darf
 * der Ring in die Treuhandphase — sonst stünde ein Teil des Topfes offen, und
 * die Übergabe liesse sich mit fehlendem Geld bestätigen.
 */
export async function allDepositsReserved(legs: RingLegRow[]): Promise<boolean> {
  const noetig = transfersFor(legs);
  if (!noetig.length) return true;

  const vorhanden = await currentRingPayments(legs[0].ringId);
  return noetig.every((t) => {
    const zahlung = vorhanden.find((p) => p.payerId === t.payerId && p.payeeId === t.payeeId);
    if (!zahlung) return false;
    if (zahlung.status === "eingezogen" || zahlung.status === "ausgezahlt") return true;
    if (zahlung.status !== "autorisiert") return false;
    // Eine verfallene Reservierung zählt nicht, auch wenn das Ereignis von
    // Stripe noch nicht angekommen ist.
    return (authorizationExpiresAt(zahlung)?.getTime() ?? Infinity) >= Date.now();
  });
}

/**
 * Schiebt den Ring in die Treuhandphase, sobald alle Beträge reserviert sind.
 * Nur aus «angenommen» — ein abgebrochener Ring darf durch eine verspätet
 * eintreffende Zahlung nicht wiederbelebt werden. «treuhand» ist mit erlaubt,
 * damit ein zweites Ereignis nicht als Fehlschlag gilt.
 */
export async function advanceRingToEscrow(ringId: string): Promise<boolean> {
  const geladen = await loadRing(ringId);
  if (!geladen) return false;
  if (geladen.ring.status !== "angenommen" && geladen.ring.status !== "treuhand") return false;
  if (!(await allDepositsReserved(geladen.legs))) return geladen.ring.status === "treuhand";

  const moved = await db
    .update(ringSwaps)
    .set({ status: "treuhand", escrowAt: new Date(), updatedAt: new Date() })
    .where(and(eq(ringSwaps.id, ringId), inArray(ringSwaps.status, ["angenommen", "treuhand"])))
    .returning({ id: ringSwaps.id });
  return moved.length > 0;
}

/**
 * Nimmt den Ring aus der Treuhandphase zurück, wenn hinterlegtes Geld
 * verschwunden ist. Alle Übergabebestätigungen werden gelöscht, damit sich der
 * Ring nicht mit einem unvollständigen Topf abschliessen lässt.
 */
export async function reopenRingEscrow(ringId: string, reason: string): Promise<boolean> {
  const rows = await db
    .update(ringSwaps)
    .set({ status: "angenommen", escrowAt: null, updatedAt: new Date() })
    .where(and(eq(ringSwaps.id, ringId), eq(ringSwaps.status, "treuhand")))
    .returning({ id: ringSwaps.id, initiatorId: ringSwaps.initiatorId });
  if (!rows.length) return false;

  await db
    .update(ringLegs)
    .set({ confirmedAt: null, updatedAt: new Date() })
    .where(eq(ringLegs.ringId, ringId));

  await addRingSystemMessage(
    ringId,
    rows[0].initiatorId,
    `${reason} Der Ausgleich muss neu eingezahlt werden, bevor der Ring abgeschlossen werden kann.`,
  );
  return true;
}

/** Alle Beteiligten eines Rings — für Benachrichtigungen. */
export async function ringParticipantIds(ringId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: ringLegs.userId })
    .from(ringLegs)
    .where(eq(ringLegs.ringId, ringId));
  return rows.map((r) => r.userId);
}

/**
 * Gibt alle noch nicht weitergeleiteten Zahlungen eines Rings frei bzw.
 * erstattet sie. Liefert die IDs der Zahlungen, bei denen das nicht geklappt
 * hat — der Abbruch selbst gilt trotzdem, sonst bliebe der Ring mit gesperrten
 * Fahrzeugen stehen, weil Stripe gerade nicht erreichbar ist.
 */
export async function releaseRingPayments(ringId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.ringId, ringId), isNull(payments.stripeTransferId)));

  const fehler: string[] = [];
  for (const row of rows) {
    if (row.status !== "autorisiert" && row.status !== "eingezogen") continue;
    try {
      await releaseAuthorization(row);
    } catch (err) {
      console.error(`Freigabe der Ringzahlung ${row.id} fehlgeschlagen:`, err);
      await markPayment(row.id, row.status, `Freigabe nach Abbruch fehlgeschlagen: ${err}`);
      fehler.push(row.id);
    }
  }
  return fehler;
}

export type AcceptResult =
  | { ok: true; vollstaendig: boolean }
  | { ok: false; grund: "nicht offen" | "schon zugesagt" | "gesperrt" | "fehler" };

/**
 * Trägt die Zusage einer Person ein und macht den Ring verbindlich, sobald
 * alle drei zugesagt haben: Fahrzeuge sperren, Inserate aus dem Markt nehmen.
 *
 * Der Ring wird für die Dauer der Transaktion gesperrt (`select … for update`).
 * Ohne das könnten zwei gleichzeitige Zusagen beide nur zwei Zusagen sehen —
 * unter READ COMMITTED sieht keine der beiden die noch offene Änderung der
 * anderen — und keine würde den Ring binden. Er bliebe für immer im Vorschlag,
 * obwohl alle zugesagt haben.
 */
export async function acceptRingLeg(ringId: string, userId: string): Promise<AcceptResult> {
  try {
    return await db.transaction(async (tx) => {
      const [gesperrt] = await tx
        .select()
        .from(ringSwaps)
        .where(eq(ringSwaps.id, ringId))
        .for("update");
      if (!gesperrt || gesperrt.status !== "vorschlag") {
        return { ok: false, grund: "nicht offen" } as AcceptResult;
      }

      const zugesagt = await tx
        .update(ringLegs)
        .set({ acceptedAt: new Date(), updatedAt: new Date() })
        .where(
          and(eq(ringLegs.ringId, ringId), eq(ringLegs.userId, userId), isNull(ringLegs.acceptedAt)),
        )
        .returning({ id: ringLegs.id });
      if (!zugesagt.length) return { ok: false, grund: "schon zugesagt" } as AcceptResult;

      const alle = await tx
        .select()
        .from(ringLegs)
        .where(eq(ringLegs.ringId, ringId))
        .orderBy(asc(ringLegs.position));
      if (alle.some((l) => l.acceptedAt === null)) {
        return { ok: true, vollstaendig: false } as AcceptResult;
      }

      await tx
        .update(ringSwaps)
        .set({ status: "angenommen", acceptedAt: new Date(), updatedAt: new Date() })
        .where(eq(ringSwaps.id, ringId));

      // Fahrzeugsperre: der Primärschlüssel auf der Fahrzeug-ID lässt eine
      // zweite, gleichzeitige Zusage für dasselbe Auto auflaufen — egal ob sie
      // aus einem Zweiertausch oder einem anderen Ring kommt.
      const vehicleIds = alle.map((l) => l.vehicleId);
      await tx.insert(dealVehicleLocks).values(vehicleIds.map((vehicleId) => ({ vehicleId, ringId })));

      await tx
        .update(listings)
        .set({ status: "in verhandlung", updatedAt: new Date() })
        .where(
          and(
            inArray(listings.vehicleId, vehicleIds),
            inArray(listings.status, ["aktiv", "pausiert", "getauscht"]),
            isNull(listings.blockedAt),
          ),
        );

      return { ok: true, vollstaendig: true } as AcceptResult;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, grund: "gesperrt" };
    console.error("Zusage zum Ring fehlgeschlagen:", err);
    return { ok: false, grund: "fehler" };
  }
}

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
