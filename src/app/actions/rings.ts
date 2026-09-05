"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, ne, or, sql as raw } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import {
  dealMessages,
  dealVehicleLocks,
  deals,
  listings,
  ringLegs,
  ringSwaps,
  users,
  vehicles,
  type RingLegRow,
  type RingSwapRow,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { suspendedNotice } from "@/lib/auth/guards";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { toVehicle } from "@/lib/queries";
import { ringCashSplit } from "@/lib/matching";
import { valueAt } from "@/lib/valuation";
import { ringBalanced, ringClosed } from "@/lib/rings";
import {
  acceptRingLeg,
  addRingSystemMessage,
  advanceRingToEscrow,
  loadRing,
  releaseRingPayments,
  reopenRingEscrow,
  transfersFor,
  type RingWithLegs,
} from "@/lib/rings-db";
import {
  captureAndPayout,
  createRingCheckout,
  currentRingPayments,
  payoutReady,
  stripeConfigured,
  authorizationExpiresAt,
  PaymentStateError,
  PayoutBlockedError,
} from "@/lib/payments";
import { mailConfigured, sendMail, siteUrl } from "@/lib/mail";

export interface RingActionResult {
  ok?: boolean;
  error?: string;
  /** Weiterleitung, die der Client selbst ausführt (z.B. zu Stripe) */
  redirectTo?: string;
  ringId?: string;
}

/** Der Ring hat den Zustand gewechselt, während die Aktion lief. */
class RingConflict extends Error {}

function braucheBestaetigteMail(me: { emailVerified?: boolean }): string | null {
  if (!mailConfigured()) return null;
  if (me.emailVerified) return null;
  return (
    "Bitte bestätige zuerst deine E-Mail-Adresse — den Link findest du in deinem Postfach, " +
    "erneut senden kannst du ihn unter «Konto»."
  );
}

const GEBUNDEN: RingSwapRow["status"][] = ["angenommen", "treuhand", "abwicklung"];

/** Lädt den Ring und stellt sicher, dass der Aufrufer eines der Beine hält. */
async function loadMyRing(
  ringId: string,
  userId: string,
): Promise<(RingWithLegs & { myLeg: RingLegRow }) | null> {
  const geladen = await loadRing(ringId);
  if (!geladen) return null;
  const myLeg = geladen.legs.find((l) => l.userId === userId);
  if (!myLeg) return null;
  return { ...geladen, myLeg };
}

async function notify(userIds: string[], subject: string, text: string): Promise<void> {
  if (!userIds.length) return;
  const rows = await db.select({ email: users.email }).from(users).where(inArray(users.id, userIds));
  for (const row of rows) {
    await sendMail({ to: row.email, subject, text });
  }
}

/** Alle ausser mir — für Benachrichtigungen. */
function andere(legs: RingLegRow[], meId: string): string[] {
  return legs.filter((l) => l.userId !== meId).map((l) => l.userId);
}

/* ------------------------------------------------------------------ */
/* Vorschlag anlegen                                                   */
/* ------------------------------------------------------------------ */

const proposeSchema = z.object({
  vehicleIds: z.array(z.string().min(1)).length(3),
});

/**
 * Legt einen Ringvorschlag an. Erwartet die drei Fahrzeuge in Ringreihenfolge,
 * beginnend beim eigenen: Position 0 gibt an Position 1, Position 1 an
 * Position 2, Position 2 zurück an Position 0.
 *
 * Alles andere — Besitzer, Werte, Ausgleichszahlungen — rechnet der Server
 * selbst. Vom Client kommen nur die Fahrzeug-IDs; die Beträge aus der
 * Übersichtsseite werden bewusst nicht übernommen.
 */
export async function proposeRingAction(input: {
  vehicleIds: string[];
}): Promise<RingActionResult> {
  const me = await requireUser();
  const stillgelegt = suspendedNotice(me);
  if (stillgelegt) return { error: stillgelegt };
  const unbestaetigt = braucheBestaetigteMail(me);
  if (unbestaetigt) return { error: unbestaetigt };

  const limit = await checkRateLimit(`ring:${me.id}`, 10, 60 * 60);
  if (!limit.ok) return { error: "Zu viele Ringvorschläge in kurzer Zeit. Bitte kurz warten." };

  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) return { error: "Ein Ring braucht genau drei Fahrzeuge." };
  const ids = parsed.data.vehicleIds;
  if (new Set(ids).size !== 3) return { error: "Ein Fahrzeug kann im Ring nicht zweimal stehen." };

  // Das erste Fahrzeug ist meines und braucht kein Inserat — genau wie beim
  // Zweiertausch, bei dem nur die Gegenseite inseriert haben muss.
  const [mine] = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, ids[0]), eq(vehicles.ownerId, me.id), isNull(vehicles.archivedAt)))
    .limit(1);
  if (!mine) return { error: "Das erste Fahrzeug im Ring muss dir gehören." };

  // Die beiden anderen müssen aktiv inseriert sein.
  const fremde = await db
    .select({ listing: listings, vehicle: vehicles })
    .from(listings)
    .innerJoin(vehicles, eq(vehicles.id, listings.vehicleId))
    .where(
      and(
        inArray(listings.vehicleId, [ids[1], ids[2]]),
        eq(listings.status, "aktiv"),
        isNull(listings.blockedAt),
        isNull(vehicles.archivedAt),
      ),
    );
  if (fremde.length !== 2) {
    return { error: "Mindestens ein Inserat im Ring ist nicht mehr verfügbar." };
  }

  const nachId = new Map(fremde.map((f) => [f.vehicle.id, f]));
  const eintragA = nachId.get(ids[1]);
  const eintragB = nachId.get(ids[2]);
  if (!eintragA || !eintragB) return { error: "Mindestens ein Inserat im Ring ist nicht mehr verfügbar." };

  const besitzer = [me.id, eintragA.vehicle.ownerId, eintragB.vehicle.ownerId];
  if (new Set(besitzer).size !== 3) {
    return { error: "Ein Ring braucht drei verschiedene Personen." };
  }
  if (besitzer.slice(1).some((id) => id === me.id)) {
    return { error: "Du kannst dir kein eigenes Fahrzeug vorschlagen." };
  }

  // Steckt eines der Fahrzeuge schon in einem verbindlichen Vorgang? Die
  // Sperrtabelle greift erst bei der letzten Zusage; hier ist der Hinweis
  // ehrlicher, als drei Leute zusagen zu lassen und dann zu scheitern.
  const gesperrt = await db
    .select({ vehicleId: dealVehicleLocks.vehicleId })
    .from(dealVehicleLocks)
    .where(inArray(dealVehicleLocks.vehicleId, ids));
  if (gesperrt.length) {
    return {
      error:
        "Eines der drei Autos steckt schon in einem zugesagten Tausch. Bis der fertig ist, " +
        "ist es gebunden.",
    };
  }

  // Kein zweiter offener Vorschlag für dieselbe Runde
  const schonOffen = await db
    .select({ ringId: ringLegs.ringId })
    .from(ringLegs)
    .innerJoin(ringSwaps, eq(ringSwaps.id, ringLegs.ringId))
    .where(
      and(
        eq(ringLegs.userId, me.id),
        eq(ringLegs.vehicleId, ids[0]),
        inArray(ringSwaps.status, ["vorschlag", ...GEBUNDEN]),
      ),
    );
  if (schonOffen.length) {
    const gleiche = await db
      .select({ ringId: ringLegs.ringId })
      .from(ringLegs)
      .where(
        and(
          inArray(
            ringLegs.ringId,
            schonOffen.map((r) => r.ringId),
          ),
          inArray(ringLegs.vehicleId, ids),
        ),
      );
    const proRing = new Map<string, number>();
    for (const row of gleiche) proRing.set(row.ringId, (proRing.get(row.ringId) ?? 0) + 1);
    const treffer = [...proRing.entries()].find(([, n]) => n === 3);
    if (treffer) {
      return { error: "Für diese Runde läuft bereits ein Ringvorschlag.", ringId: treffer[0] };
    }
  }

  // Werte wie auf der Übersichtsseite: das eigene Fahrzeug ohne Aufschlag,
  // die inserierten mit. Sonst stünden auf zwei Seiten zwei Beträge.
  const werte: [number, number, number] = [
    valueAt(toVehicle(mine)),
    valueAt(toVehicle(eintragA.vehicle)) + eintragA.listing.askPremium,
    valueAt(toVehicle(eintragB.vehicle)) + eintragB.listing.askPremium,
  ];
  const cash = ringCashSplit(werte);

  const beine = [
    { userId: me.id, vehicleId: ids[0], receiverId: eintragA.vehicle.ownerId, cash: cash[0] },
    {
      userId: eintragA.vehicle.ownerId,
      vehicleId: ids[1],
      receiverId: eintragB.vehicle.ownerId,
      cash: cash[1],
    },
    { userId: eintragB.vehicle.ownerId, vehicleId: ids[2], receiverId: me.id, cash: cash[2] },
  ];
  // Zwei Sicherungen gegen einen Rechenfehler: der Weg muss zum Anfang
  // zurückführen, und die Summe der Ausgleiche muss null sein — sonst fehlte
  // im Treuhandtopf Geld oder es bliebe welches liegen.
  if (!ringClosed(beine) || !ringBalanced(beine)) {
    return { error: "Dieser Ring geht nicht auf. Bitte einen anderen Vorschlag wählen." };
  }

  const ringId = newId("rng");
  const jetzt = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(ringSwaps).values({ id: ringId, initiatorId: me.id, status: "vorschlag" });
    await tx.insert(ringLegs).values(
      beine.map((b, i) => ({
        id: newId("leg"),
        ringId,
        position: i,
        userId: b.userId,
        vehicleId: b.vehicleId,
        receiverId: b.receiverId,
        cash: b.cash,
        // Wer vorschlägt, hat damit zugesagt.
        acceptedAt: i === 0 ? jetzt : null,
      })),
    );
    await tx.insert(dealMessages).values({
      id: newId("msg"),
      ringId,
      authorId: me.id,
      body: `${me.name} hat diesen Ringtausch vorgeschlagen und bereits zugesagt.`,
      system: true,
    });
  });

  await notify(
    [eintragA.vehicle.ownerId, eintragB.vehicle.ownerId],
    "quitt: Vorschlag für einen Ringtausch",
    `${me.name} schlägt einen Tausch über drei Parteien vor. Er kommt nur zustande, wenn alle ` +
      `drei zusagen.\n\n${siteUrl()}/ringe/${ringId}\n`,
  );

  revalidatePath("/deals");
  return { ok: true, ringId };
}

/* ------------------------------------------------------------------ */
/* Zusagen und ablehnen                                                */
/* ------------------------------------------------------------------ */

export async function acceptRingAction(ringId: string): Promise<RingActionResult> {
  const me = await requireUser();
  const stillgelegt = suspendedNotice(me);
  if (stillgelegt) return { error: stillgelegt };
  const unbestaetigt = braucheBestaetigteMail(me);
  if (unbestaetigt) return { error: unbestaetigt };

  const geladen = await loadMyRing(ringId, me.id);
  if (!geladen) return { error: "Ringtausch nicht gefunden." };
  if (geladen.ring.status !== "vorschlag") {
    return { error: "Dieser Ringvorschlag ist nicht mehr offen." };
  }
  if (geladen.myLeg.acceptedAt) return { error: "Du hast bereits zugesagt." };

  // Gehören die drei Fahrzeuge noch den Personen, über die hier verhandelt wird?
  const halter = await db
    .select({ id: vehicles.id, ownerId: vehicles.ownerId, archivedAt: vehicles.archivedAt })
    .from(vehicles)
    .where(
      inArray(
        vehicles.id,
        geladen.legs.map((l) => l.vehicleId),
      ),
    );
  for (const leg of geladen.legs) {
    const fahrzeug = halter.find((v) => v.id === leg.vehicleId);
    if (!fahrzeug || fahrzeug.archivedAt || fahrzeug.ownerId !== leg.userId) {
      return { error: "Eines der Fahrzeuge hat inzwischen den Besitzer gewechselt." };
    }
  }

  const vehicleIds = geladen.legs.map((l) => l.vehicleId);

  // Wie beim Zweiertausch: zusätzlich zu den Sperren auch ältere zugesagte
  // Tausche prüfen, die vor deren Einführung entstanden sind.
  const gebunden = await db
    .select({ id: deals.id })
    .from(deals)
    .where(
      and(
        inArray(deals.status, ["angenommen", "treuhand", "abwicklung"]),
        or(inArray(deals.fromVehicleId, vehicleIds), inArray(deals.toVehicleId, vehicleIds)),
      ),
    )
    .limit(1);
  if (gebunden.length) {
    return {
      error:
        "Eines der drei Autos steckt schon in einem anderen zugesagten Tausch. Der muss " +
        "zuerst fertig oder abgebrochen sein.",
    };
  }

  const zusage = await acceptRingLeg(ringId, me.id);
  if (!zusage.ok) {
    if (zusage.grund === "nicht offen") return { error: "Dieser Ringvorschlag ist nicht mehr offen." };
    if (zusage.grund === "schon zugesagt") return { error: "Du hast bereits zugesagt." };
    if (zusage.grund === "gesperrt") {
      return {
        error:
          "Eines der drei Autos steckt schon in einem anderen zugesagten Tausch. Der muss " +
          "zuerst fertig oder abgebrochen sein.",
      };
    }
    return { error: "Die Zusage hat nicht geklappt. Bitte die Seite neu laden und erneut versuchen." };
  }
  const vollstaendig = zusage.vollstaendig;

  await addRingSystemMessage(
    ringId,
    me.id,
    vollstaendig
      ? `${me.name} hat zugesagt — damit steht der Ring. Als Nächstes wird der Ausgleich hinterlegt.`
      : `${me.name} hat zugesagt.`,
  );

  await notify(
    andere(geladen.legs, me.id),
    vollstaendig ? "quitt: Ringtausch steht" : "quitt: Zusage zum Ringtausch",
    vollstaendig
      ? `Alle drei haben zugesagt. Als Nächstes wird der Ausgleich hinterlegt.\n\n${siteUrl()}/ringe/${ringId}\n`
      : `${me.name} hat dem Ringtausch zugesagt.\n\n${siteUrl()}/ringe/${ringId}\n`,
  );

  revalidatePath(`/ringe/${ringId}`);
  revalidatePath("/markt");
  return { ok: true };
}

export async function declineRingAction(ringId: string): Promise<RingActionResult> {
  const me = await requireUser();
  const geladen = await loadMyRing(ringId, me.id);
  if (!geladen) return { error: "Ringtausch nicht gefunden." };
  if (geladen.ring.status !== "vorschlag") {
    return { error: "Dieser Ringvorschlag ist nicht mehr offen." };
  }

  const abgelehnt = await db
    .update(ringSwaps)
    .set({ status: "abgelehnt", updatedAt: new Date() })
    .where(and(eq(ringSwaps.id, ringId), eq(ringSwaps.status, "vorschlag")))
    .returning({ id: ringSwaps.id });
  if (!abgelehnt.length) return { error: "Dieser Ringvorschlag ist nicht mehr offen." };

  await addRingSystemMessage(ringId, me.id, `${me.name} hat den Ring abgelehnt.`);
  await notify(
    andere(geladen.legs, me.id),
    "quitt: Ringtausch abgelehnt",
    `${me.name} hat den Ringtausch abgelehnt. Ohne alle drei Zusagen kommt er nicht zustande.\n\n${siteUrl()}/ringe/${ringId}\n`,
  );

  revalidatePath(`/ringe/${ringId}`);
  return { ok: true };
}

/**
 * Bricht einen bereits zugesagten Ring ab. Hinterlegte Zahlungen werden
 * freigegeben bzw. erstattet — es bewegt sich dann kein einziges Fahrzeug.
 */
export async function cancelRingAction(ringId: string): Promise<RingActionResult> {
  const me = await requireUser();
  const geladen = await loadMyRing(ringId, me.id);
  if (!geladen) return { error: "Ringtausch nicht gefunden." };
  if (geladen.ring.status === "abwicklung") {
    return {
      error: "Der Ausgleich wird gerade ausgezahlt — ein Abbruch ist jetzt nicht mehr möglich.",
    };
  }
  if (geladen.ring.status !== "angenommen" && geladen.ring.status !== "treuhand") {
    return { error: "In diesem Zustand ist kein Abbruch nötig." };
  }

  const vehicleIds = geladen.legs.map((l) => l.vehicleId);
  try {
    await db.transaction(async (tx) => {
      const abgebrochen = await tx
        .update(ringSwaps)
        .set({ status: "storniert", updatedAt: new Date() })
        .where(
          and(eq(ringSwaps.id, ringId), inArray(ringSwaps.status, ["angenommen", "treuhand"])),
        )
        .returning({ id: ringSwaps.id });
      if (!abgebrochen.length) {
        throw new RingConflict(
          "Der Ring lässt sich gerade nicht abbrechen. Bitte die Seite neu laden.",
        );
      }
      await tx.delete(dealVehicleLocks).where(eq(dealVehicleLocks.ringId, ringId));
      await tx
        .update(listings)
        .set({ status: "aktiv", updatedAt: new Date() })
        .where(and(inArray(listings.vehicleId, vehicleIds), eq(listings.status, "in verhandlung")));
    });
  } catch (err) {
    if (err instanceof RingConflict) return { error: err.message };
    throw err;
  }

  await addRingSystemMessage(ringId, me.id, `${me.name} hat den Ring abgebrochen.`);
  await notify(
    andere(geladen.legs, me.id),
    "quitt: Ringtausch abgebrochen",
    `${me.name} hat den Ringtausch abgebrochen. Hinterlegte Beträge werden freigegeben.\n\n${siteUrl()}/ringe/${ringId}\n`,
  );
  revalidatePath(`/ringe/${ringId}`);
  revalidatePath("/markt");

  if (stripeConfigured()) {
    const fehler = await releaseRingPayments(ringId);
    if (fehler.length) {
      return {
        error:
          "Der Ring ist abgebrochen. Mindestens einen hinterlegten Betrag konnten wir nicht " +
          "sofort freigeben. Eine Reservierung verfällt von selbst. Ist schon abgebucht " +
          "worden, meldet sich der Support.",
      };
    }
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Nachrichten                                                         */
/* ------------------------------------------------------------------ */

export async function sendRingMessageAction(
  ringId: string,
  text: string,
): Promise<RingActionResult> {
  const me = await requireUser();
  const geladen = await loadMyRing(ringId, me.id);
  if (!geladen) return { error: "Ringtausch nicht gefunden." };
  if (["abgelehnt", "storniert", "abgeschlossen"].includes(geladen.ring.status)) {
    return { error: "Dieser Vorgang ist abgeschlossen." };
  }

  const body = text.trim().slice(0, 4000);
  if (!body) return { error: "Die Nachricht ist leer." };

  const limit = await checkRateLimit(`msg:${me.id}`, 60, 60 * 60);
  if (!limit.ok) return { error: "Zu viele Nachrichten in kurzer Zeit." };

  await db.insert(dealMessages).values({ id: newId("msg"), ringId, authorId: me.id, body });
  await notify(
    andere(geladen.legs, me.id),
    "quitt: neue Nachricht im Ringtausch",
    `${me.name} hat euch geschrieben.\n\n${siteUrl()}/ringe/${ringId}\n`,
  );

  revalidatePath(`/ringe/${ringId}`);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Treuhand                                                            */
/* ------------------------------------------------------------------ */

/**
 * Startet die eigene Einzahlung. Im Ring kann eine Person zwei Beträge
 * schulden — an jede der beiden anderen einen —, deshalb liefert die Aktion
 * immer die nächste offene Einzahlung.
 */
export async function startRingEscrowAction(ringId: string): Promise<RingActionResult> {
  const me = await requireUser();
  const stillgelegt = suspendedNotice(me);
  if (stillgelegt) return { error: stillgelegt };
  const unbestaetigt = braucheBestaetigteMail(me);
  if (unbestaetigt) return { error: unbestaetigt };

  const geladen = await loadMyRing(ringId, me.id);
  if (!geladen) return { error: "Ringtausch nicht gefunden." };
  if (geladen.ring.status !== "angenommen") {
    return { error: "Die Einzahlung ist erst möglich, wenn alle drei zugesagt haben." };
  }

  const noetig = transfersFor(geladen.legs);

  // Ohne Wertdifferenzen gibt es nichts zu hinterlegen — dann geht es direkt
  // zur Übergabe.
  if (!noetig.length) {
    const weiter = await advanceRingToEscrow(ringId);
    if (!weiter) return { error: "Der Ring ist nicht mehr im Zustand «angenommen»." };
    await addRingSystemMessage(ringId, me.id, "Kein Ausgleich nötig — weiter zur Übergabe.");
    revalidatePath(`/ringe/${ringId}`);
    return { ok: true };
  }

  // Liegt inzwischen alles bereit, aber der Ring hängt noch in der Zusage?
  // Der Wechsel in die Treuhandphase hängt sonst allein am Stripe-Ereignis
  // der letzten Einzahlung. Bleibt das aus, käme der Ring nie weiter, obwohl
  // das Geld reserviert ist — dieser Anlauf holt das nach.
  if (await advanceRingToEscrow(ringId)) {
    revalidatePath(`/ringe/${ringId}`);
    return { ok: true };
  }

  const meine = noetig.filter((t) => t.payerId === me.id);
  if (!meine.length) {
    return { error: "Bei dir ist nichts einzuzahlen — der Ausgleich kommt von den anderen." };
  }

  const vorhanden = await currentRingPayments(ringId);
  const offen = meine.find((t) => {
    const zahlung = vorhanden.find((p) => p.payerId === t.payerId && p.payeeId === t.payeeId);
    if (!zahlung) return true;
    if (zahlung.status === "eingezogen" || zahlung.status === "ausgezahlt") return false;
    if (zahlung.status !== "autorisiert") return true;
    return (authorizationExpiresAt(zahlung)?.getTime() ?? Infinity) < Date.now();
  });
  if (!offen) {
    return { error: "Deine Einzahlungen liegen bereits vor. Es fehlt noch jemand anderes." };
  }

  if (!stripeConfigured()) {
    return {
      error:
        "Zahlungen sind auf dieser Installation noch nicht eingerichtet (STRIPE_SECRET_KEY fehlt).",
    };
  }

  // Der Empfänger muss das Geld annehmen können. Wird das erst beim Einzug
  // geprüft, liegt der Betrag hinterher auf dem Plattformkonto fest.
  if (!(await payoutReady(offen.payeeId))) {
    await notify(
      [offen.payeeId],
      "quitt: Auszahlungskonto einrichten",
      "Bei eurem Ringtausch wird als Nächstes der Ausgleich hinterlegt. Damit er bei dir " +
        `ankommt, richte bitte zuerst dein Auszahlungskonto ein.\n\n${siteUrl()}/konto\n`,
    );
    return {
      error:
        "Wer dein Geld bekommt, hat noch kein Auszahlungskonto. Wir haben ihm eben " +
        "geschrieben. Sobald das steht, kannst du einzahlen.",
    };
  }

  const namen = await fahrzeugNamen(geladen.legs);
  try {
    const checkout = await createRingCheckout(ringId, offen, `Ringtausch ${namen}`);
    return { ok: true, redirectTo: checkout.url };
  } catch (err) {
    console.error("Checkout für Ring konnte nicht angelegt werden:", err);
    return { error: "Die Zahlung konnte nicht vorbereitet werden. Bitte später erneut versuchen." };
  }
}

async function fahrzeugNamen(legs: RingLegRow[]): Promise<string> {
  const rows = await db
    .select({ id: vehicles.id, make: vehicles.make, model: vehicles.model })
    .from(vehicles)
    .where(
      inArray(
        vehicles.id,
        legs.map((l) => l.vehicleId),
      ),
    );
  const nachId = new Map(rows.map((r) => [r.id, `${r.make} ${r.model}`]));
  return legs.map((l) => nachId.get(l.vehicleId) ?? "Fahrzeug").join(" → ");
}

/* ------------------------------------------------------------------ */
/* Übergabe und Abschluss                                              */
/* ------------------------------------------------------------------ */

export async function confirmRingHandoverAction(ringId: string): Promise<RingActionResult> {
  const me = await requireUser();
  const geladen = await loadMyRing(ringId, me.id);
  if (!geladen) return { error: "Ringtausch nicht gefunden." };
  if (geladen.ring.status !== "treuhand" && geladen.ring.status !== "abwicklung") {
    return { error: "Die Übergabe kannst du erst bestätigen, wenn der Ausgleich hinterlegt ist." };
  }

  let alle = false;
  await db.transaction(async (tx) => {
    // Wie bei der Zusage: der Ring wird gesperrt, damit zwei gleichzeitige
    // Bestätigungen nicht beide „es fehlt noch jemand“ sehen.
    const [gesperrt] = await tx
      .select()
      .from(ringSwaps)
      .where(eq(ringSwaps.id, ringId))
      .for("update");
    if (!gesperrt || (gesperrt.status !== "treuhand" && gesperrt.status !== "abwicklung")) return;

    if (gesperrt.status === "treuhand") {
      await tx
        .update(ringLegs)
        .set({ confirmedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(ringLegs.ringId, ringId),
            eq(ringLegs.userId, me.id),
            isNull(ringLegs.confirmedAt),
          ),
        );
    }

    const offen = await tx
      .select({ id: ringLegs.id })
      .from(ringLegs)
      .where(and(eq(ringLegs.ringId, ringId), isNull(ringLegs.confirmedAt)));
    alle = offen.length === 0;
  });

  const frisch = await loadRing(ringId);
  if (!frisch) return { error: "Ringtausch nicht gefunden." };
  const meinBein = frisch.legs.find((l) => l.userId === me.id);
  if (meinBein?.confirmedAt && !geladen.myLeg.confirmedAt) {
    await addRingSystemMessage(ringId, me.id, `${me.name} hat die Übergabe bestätigt.`);
  }

  if (!alle) {
    await notify(
      andere(frisch.legs, me.id),
      "quitt: Übergabe bestätigt",
      `${me.name} hat die Übergabe bestätigt. Sobald alle drei bestätigt haben, wird der ` +
        `Ausgleich ausgezahlt und die Fahrzeuge werden umgeschrieben.\n\n${siteUrl()}/ringe/${ringId}\n`,
    );
    revalidatePath(`/ringe/${ringId}`);
    return { ok: true };
  }

  const ergebnis = await settleRing(frisch);
  revalidatePath(`/ringe/${ringId}`);
  revalidatePath("/garage");
  return ergebnis;
}

/**
 * Wickelt einen von allen bestätigten Ring ab: erst sämtliche Beträge
 * einziehen und weiterleiten, danach die drei Fahrzeuge umschreiben. Solange
 * nicht alles Geld angekommen ist, wechselt kein Fahrzeug den Besitzer.
 */
async function settleRing(geladen: RingWithLegs): Promise<RingActionResult> {
  const { ring, legs } = geladen;
  const noetig = transfersFor(legs);

  if (!noetig.length) {
    const claimed = await claimRingForSettlement(ring.id);
    if (!claimed) return { ok: true };
    try {
      await completeRing(claimed);
    } catch (err) {
      await releaseRingSettlement(ring.id);
      console.error(`Abschluss von Ring ${ring.id} fehlgeschlagen:`, err);
      return { error: "Der Abschluss hat nicht geklappt. Bitte die Seite neu laden." };
    }
    return { ok: true };
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
      if (ring.status !== "abwicklung") return { ok: true };
      console.error(`Ring ${ring.id} ist in Abwicklung, aber eine Zahlung ist nicht mehr gültig.`);
      return {
        error:
          "Beim Abschluss fehlt ein hinterlegter Betrag. Die Autos sind nicht umgeschrieben. " +
          "Bitte meldet euch beim Support: das müssen wir von Hand klären.",
      };
    }
    return {
      error:
        "Mindestens eine hinterlegte Zahlung ist nicht mehr gültig. Eine Reservierung verfällt " +
        "nach sieben Tagen. Der fehlende Betrag muss neu eingezahlt werden.",
    };
  }

  if (!stripeConfigured()) {
    return { error: "Zahlungen sind auf dieser Installation nicht eingerichtet." };
  }

  // Erst alle Empfängerkonten prüfen, dann erst einziehen. Sonst bliebe der
  // Ring auf halbem Weg stehen: das erste Geld wäre schon geflossen, das
  // zweite nicht überweisbar.
  for (const zahlung of zahlungen) {
    if (!(await payoutReady(zahlung!.payeeId))) {
      await notify(
        [zahlung!.payeeId],
        "quitt: Auszahlungskonto fehlt noch",
        "Euer Ringtausch ist übergeben und der Ausgleich liegt bereit. Sobald du dein " +
          `Auszahlungskonto eingerichtet hast, wird er ausgezahlt.\n\n${siteUrl()}/konto\n`,
      );
      return {
        error:
          "Wir können noch nicht auszahlen: bei einer Person fehlt das Auszahlungskonto. Wir " +
          "haben ihr geschrieben. Danach könnt ihr die Übergabe noch einmal bestätigen.",
      };
    }
  }

  const claimed = await claimRingForSettlement(ring.id);
  if (!claimed) return { ok: true };

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
        return {
          error:
            "Wir können noch nicht auszahlen: bei einer Person fehlt das Auszahlungskonto. Sobald " +
            "das steht, könnt ihr die Übergabe noch einmal bestätigen.",
        };
      }
      if (err instanceof PaymentStateError) {
        console.error(`Zahlung zu Ring ${ring.id} nicht abwickelbar:`, err);
        return { error: err.message + " Bitte den Ausgleich neu einzahlen." };
      }
      console.error(`Auszahlung im Ring ${ring.id} fehlgeschlagen:`, err);
      return {
        error: bereitsGeflossen
          ? "Ein Teil des Ausgleichs ist ausgezahlt, ein weiterer noch nicht. Die Fahrzeuge " +
            "sind noch nicht umgeschrieben — bitte in ein paar Minuten erneut bestätigen."
          : "Die Auszahlung ist fehlgeschlagen. Die Beträge sind sicher hinterlegt und die " +
            "Fahrzeuge sind noch nicht umgeschrieben — bitte in ein paar Minuten erneut bestätigen.",
      };
    }
  }

  try {
    await completeRing(claimed);
  } catch (err) {
    // Das Geld ist bereits bei den Empfängern. Der Ring bleibt in
    // «abwicklung» und lässt sich erneut anstossen — freigeben wäre falsch.
    console.error(`Abschluss von Ring ${ring.id} nach erfolgter Auszahlung fehlgeschlagen:`, err);
    return {
      error:
        "Der Ausgleich ist ausgezahlt, aber das Umschreiben der Autos hat nicht geklappt. " +
        "Bestätigt gleich noch einmal. Hilft das nicht, meldet sich der Support.",
    };
  }
  return { ok: true };
}

/** Übernimmt einen von allen bestätigten Ring exklusiv zur Abwicklung. */
async function claimRingForSettlement(ringId: string): Promise<RingWithLegs | null> {
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
async function releaseRingSettlement(ringId: string): Promise<void> {
  await db
    .update(ringSwaps)
    .set({ status: "treuhand", updatedAt: new Date() })
    .where(and(eq(ringSwaps.id, ringId), eq(ringSwaps.status, "abwicklung")));
}

/** Schliesst den Ring ab: Halterwechsel, Inserate, Zähler, Sperren lösen. */
async function completeRing(geladen: RingWithLegs): Promise<void> {
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
