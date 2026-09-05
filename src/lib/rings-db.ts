import "server-only";
import { and, asc, eq, inArray, isNull, ne, or, sql as raw } from "drizzle-orm";
import { db } from "./db";
import { newId } from "./db/ids";
import {
  dealMessages,
  dealVehicleLocks,
  deals,
  listings,
  payments,
  ringLegs,
  ringSwaps,
  users,
  vehicles,
  type RingLegRow,
  type RingSwapRow,
} from "./db/schema";
import { revalidatePath } from "next/cache";
import { sendMail, siteUrl } from "./mail";
import { ringTransfers, type RingTransfer } from "./rings";
import {
  authorizationExpiresAt,
  captureAndPayout,
  currentRingPayments,
  markPayment,
  payoutReady,
  releaseAuthorization,
  stripeConfigured,
  PaymentStateError,
  PayoutBlockedError,
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

/** Übernimmt einen von allen bestätigten Ring exklusiv zur Abwicklung. */
export async function claimRingForSettlement(ringId: string): Promise<RingWithLegs | null> {
  const rows = await db
    .update(ringSwaps)
    .set({ status: "abwicklung", updatedAt: new Date() })
    .where(
      and(
        eq(ringSwaps.id, ringId),
        inArray(ringSwaps.status, ["treuhand", "abwicklung"]),
        raw`(select count(*) from ${ringLegs} where ${ringLegs.ringId} = ${ringId} and ${ringLegs.confirmedAt} is not null) = 3`,
      ),
    )
    .returning({ id: ringSwaps.id });
  if (!rows.length) return null;
  return await loadRing(ringId);
}

/** Gibt einen zur Abwicklung übernommenen Ring wieder frei. */
export async function releaseRingSettlement(ringId: string): Promise<void> {
  await db
    .update(ringSwaps)
    .set({ status: "treuhand", updatedAt: new Date() })
    .where(and(eq(ringSwaps.id, ringId), eq(ringSwaps.status, "abwicklung")));
}

/** Schliesst den Ring ab: Halterwechsel, Inserate, Zähler, Sperren lösen. */
export async function completeRing(geladen: RingWithLegs): Promise<void> {
  const { ring, legs } = geladen;
  const vehicleIds = legs.map((l) => l.vehicleId);
  const verworfeneDeals: { id: string; initiatorId: string }[] = [];
  const verworfeneRinge: { id: string; initiatorId: string }[] = [];

  await db.transaction(async (tx) => {
    const fertig = await tx
      .update(ringSwaps)
      .set({ status: "abgeschlossen", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(ringSwaps.id, ring.id), eq(ringSwaps.status, "abwicklung")))
      .returning({ id: ringSwaps.id });
    if (!fertig.length) return;

    // Die drei Fahrzeuge rücken einen Platz weiter — jedes aber nur, wenn es
    // noch der Person gehört, die es im Ring abgibt.
    for (const leg of legs) {
      const bewegt = await tx
        .update(vehicles)
        .set({ ownerId: leg.receiverId, updatedAt: new Date() })
        .where(and(eq(vehicles.id, leg.vehicleId), eq(vehicles.ownerId, leg.userId)))
        .returning({ id: vehicles.id });
      if (!bewegt.length) {
        throw new Error(
          `Halterwechsel für Ring ${ring.id} abgebrochen: Fahrzeug ${leg.vehicleId} gehört nicht mehr der erwarteten Person.`,
        );
      }
      // Das Inserat wandert mit. Ohne das könnte der neue Halter sein Fahrzeug
      // nie wieder einstellen — auf listings.vehicle_id liegt ein Unique-Index.
      await tx
        .update(listings)
        .set({ ownerId: leg.receiverId, status: "getauscht", updatedAt: new Date() })
        .where(eq(listings.vehicleId, leg.vehicleId));
    }

    // Offene Zweiertausche zu denselben Fahrzeugen sind hinfällig
    const deals2 = await tx
      .update(deals)
      .set({ status: "storniert", updatedAt: new Date() })
      .where(
        and(
          inArray(deals.status, ["vorschlag", "verhandlung"]),
          or(inArray(deals.fromVehicleId, vehicleIds), inArray(deals.toVehicleId, vehicleIds)),
        ),
      )
      .returning({ id: deals.id, initiatorId: deals.initiatorId });
    verworfeneDeals.push(...deals2);

    // …und offene Ringvorschläge ebenso
    const betroffen = await tx
      .selectDistinct({ ringId: ringLegs.ringId })
      .from(ringLegs)
      .where(and(inArray(ringLegs.vehicleId, vehicleIds), ne(ringLegs.ringId, ring.id)));
    if (betroffen.length) {
      const ringe = await tx
        .update(ringSwaps)
        .set({ status: "storniert", updatedAt: new Date() })
        .where(
          and(
            inArray(
              ringSwaps.id,
              betroffen.map((r) => r.ringId),
            ),
            eq(ringSwaps.status, "vorschlag"),
          ),
        )
        .returning({ id: ringSwaps.id, initiatorId: ringSwaps.initiatorId });
      verworfeneRinge.push(...ringe);
    }

    await tx.delete(dealVehicleLocks).where(eq(dealVehicleLocks.ringId, ring.id));

    for (const leg of legs) {
      await tx
        .update(users)
        .set({ swapsCompleted: raw`${users.swapsCompleted} + 1`, updatedAt: new Date() })
        .where(eq(users.id, leg.userId));
    }
  });

  for (const other of verworfeneDeals) {
    await db.insert(dealMessages).values({
      id: newId("msg"),
      dealId: other.id,
      authorId: other.initiatorId,
      body: "Eines der Fahrzeuge wurde inzwischen in einem Ring getauscht — dieser Vorschlag ist hinfällig.",
      system: true,
    });
  }
  for (const other of verworfeneRinge) {
    await addRingSystemMessage(
      other.id,
      other.initiatorId,
      "Eines der Fahrzeuge wurde inzwischen anders getauscht — dieser Ring ist hinfällig.",
    );
  }
  if (verworfeneDeals.length || verworfeneRinge.length) revalidatePath("/deals");
}

/**
 * Ergebnis eines Ringabschlusses — dieselbe Überlegung wie beim Zweiertausch
 * (siehe lib/abschluss): fertige Sätze gehören in die Aktion, nicht hierher.
 */
export type RingErgebnis =
  | { art: "fertig" }
  | { art: "belegt" }
  | { art: "zahlungen-aus" }
  | { art: "zahlung-ungueltig" }
  /** Der Ring steht schon in der Abwicklung und trotzdem fehlt Geld. */
  | { art: "geld-fehlt-mitten-im-abschluss" }
  | { art: "kein-auszahlungskonto"; payeeId: string }
  | { art: "zahlung-nicht-abwickelbar"; grund: string }
  | { art: "auszahlung-gescheitert"; teilweiseGeflossen: boolean }
  | { art: "abschluss-gescheitert" }
  | { art: "umschreiben-gescheitert" };

/** Schreibt allen Genannten dieselbe Nachricht. */
async function benachrichtigeRing(
  userIds: string[],
  subject: string,
  text: string,
): Promise<void> {
  if (!userIds.length) return;
  const rows = await db.select({ email: users.email }).from(users).where(inArray(users.id, userIds));
  for (const row of rows) await sendMail({ to: row.email, subject, text });
}

/**
 * Wickelt einen von allen bestätigten Ring ab: erst sämtliche Beträge
 * einziehen und weiterleiten, danach die drei Fahrzeuge umschreiben. Solange
 * nicht alles Geld angekommen ist, wechselt kein Fahrzeug den Besitzer.
 */
export async function schliesseRingAb(geladen: RingWithLegs): Promise<RingErgebnis> {
  const { ring, legs } = geladen;
  const noetig = transfersFor(legs);

  if (!noetig.length) {
    const claimed = await claimRingForSettlement(ring.id);
    if (!claimed) return { art: "belegt" };
    try {
      await completeRing(claimed);
    } catch (err) {
      await releaseRingSettlement(ring.id);
      console.error(`Abschluss von Ring ${ring.id} fehlgeschlagen:`, err);
      return { art: "abschluss-gescheitert" };
    }
    return { art: "fertig" };
  }

  const vorhanden = await currentRingPayments(ring.id);
  const zahlungen = noetig.map((t) =>
    vorhanden.find((p) => p.payerId === t.payerId && p.payeeId === t.payeeId),
  );

  const brauchbar = zahlungen.every((zahlung) => {
    if (!zahlung) return false;
    if (zahlung.status === "eingezogen" || zahlung.status === "ausgezahlt") return true;
    if (zahlung.status !== "autorisiert") return false;
    return (authorizationExpiresAt(zahlung)?.getTime() ?? Infinity) >= Date.now();
  });

  if (!brauchbar) {
    // Mindestens ein Betrag fehlt oder ist verfallen: zurück in die Zusage,
    // damit neu eingezahlt werden kann. Auf keinen Fall die Fahrzeuge
    // umschreiben.
    const zurueck = await reopenRingEscrow(
      ring.id,
      "Mindestens eine hinterlegte Zahlung ist nicht mehr gültig.",
    );
    if (!zurueck) {
      // Entweder war jemand anders schneller — dann ist hier nichts zu melden.
      // Steht der Ring aber schon in der Abwicklung, fehlt Geld mitten im
      // Abschluss, und das muss ein Mensch ansehen.
      if (ring.status !== "abwicklung") return { art: "belegt" };
      console.error(`Ring ${ring.id} ist in Abwicklung, aber eine Zahlung ist nicht mehr gültig.`);
      return { art: "geld-fehlt-mitten-im-abschluss" };
    }
    return { art: "zahlung-ungueltig" };
  }

  if (!stripeConfigured()) return { art: "zahlungen-aus" };

  // Erst alle Empfängerkonten prüfen, dann erst einziehen. Sonst bliebe der
  // Ring auf halbem Weg stehen: das erste Geld wäre schon geflossen, das
  // zweite nicht überweisbar.
  for (const zahlung of zahlungen) {
    if (!(await payoutReady(zahlung!.payeeId))) {
      await benachrichtigeRing(
        [zahlung!.payeeId],
        "autotauschen: Auszahlungskonto fehlt noch",
        "Euer Ringtausch ist übergeben und der Ausgleich liegt bereit. Sobald du dein " +
          `Auszahlungskonto eingerichtet hast, wird er ausgezahlt.\n\n${siteUrl()}/konto\n`,
      );
      return { art: "kein-auszahlungskonto", payeeId: zahlung!.payeeId };
    }
  }

  const claimed = await claimRingForSettlement(ring.id);
  if (!claimed) return { art: "belegt" };

  let bereitsGeflossen = false;
  for (const zahlung of zahlungen) {
    if (zahlung!.status === "ausgezahlt") {
      bereitsGeflossen = true;
      continue;
    }
    try {
      const erledigt = await captureAndPayout(zahlung!);
      if (erledigt.status !== "ausgezahlt") throw new Error("Auszahlung unvollständig");
      bereitsGeflossen = true;
    } catch (err) {
      // Solange nichts geflossen ist, darf der Ring zurück in die Treuhand —
      // danach nicht mehr, sonst liesse er sich abbrechen, obwohl schon Geld
      // beim Empfänger liegt.
      if (!bereitsGeflossen) await releaseRingSettlement(ring.id);
      if (err instanceof PayoutBlockedError) {
        return { art: "kein-auszahlungskonto", payeeId: zahlung!.payeeId };
      }
      if (err instanceof PaymentStateError) {
        console.error(`Zahlung zu Ring ${ring.id} nicht abwickelbar:`, err);
        return { art: "zahlung-nicht-abwickelbar", grund: err.message };
      }
      console.error(`Auszahlung im Ring ${ring.id} fehlgeschlagen:`, err);
      return { art: "auszahlung-gescheitert", teilweiseGeflossen: bereitsGeflossen };
    }
  }

  try {
    await completeRing(claimed);
  } catch (err) {
    // Das Geld ist bereits bei den Empfängern. Der Ring bleibt in
    // «abwicklung» und lässt sich erneut anstossen — freigeben wäre falsch.
    console.error(`Abschluss von Ring ${ring.id} nach erfolgter Auszahlung fehlgeschlagen:`, err);
    return { art: "umschreiben-gescheitert" };
  }
  return { art: "fertig" };
}
