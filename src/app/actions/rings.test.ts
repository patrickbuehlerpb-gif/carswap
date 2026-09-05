import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import {
  dealVehicleLocks,
  deals,
  listings,
  payments,
  reviews,
  ringLegs,
  ringSwaps,
  users,
  vehicles,
} from "@/lib/db/schema";
import { als, createUser, createVehicle, resetDatabase } from "@/test/fixtures";
import { deleteAccountAction } from "@/app/actions/account";
import { submitRingReviewAction } from "@/app/actions/reviews";
import {
  acceptRingAction,
  cancelRingAction,
  confirmRingHandoverAction,
  declineRingAction,
  proposeRingAction,
  startRingEscrowAction,
} from "@/app/actions/rings";
import { acceptRingLeg, advanceRingToEscrow } from "@/lib/rings-db";
import { ringTransfers } from "@/lib/rings";

/** Stripe wird nicht angesprochen; Einzug und Freigabe werden nachgebildet. */
vi.mock("@/lib/payments", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/payments")>();
  return {
    ...original,
    stripeConfigured: () => true,
    payoutReady: async (userId: string) => {
      const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return Boolean(rows[0]?.stripePayoutsEnabled);
    },
    captureAndPayout: async (payment: typeof payments.$inferSelect) => {
      if (payment.status === "ausgezahlt") return payment;
      if (payment.status !== "autorisiert" && payment.status !== "eingezogen") {
        throw new original.PaymentStateError(payment.status);
      }
      const rows = await db.select().from(users).where(eq(users.id, payment.payeeId)).limit(1);
      if (!rows[0]?.stripePayoutsEnabled) throw new original.PayoutBlockedError(payment.payeeId);
      const updated = await db
        .update(payments)
        .set({ status: "ausgezahlt", updatedAt: new Date() })
        .where(eq(payments.id, payment.id))
        .returning();
      return updated[0];
    },
    releaseAuthorization: async (payment: typeof payments.$inferSelect) => {
      await db
        .update(payments)
        .set({ status: payment.status === "eingezogen" ? "erstattet" : "storniert" })
        .where(eq(payments.id, payment.id));
    },
  };
});

/**
 * Drei Konten, drei gleichwertige Fahrzeuge. Über `premium` lässt sich der
 * geforderte Aufschlag der beiden inserierten Fahrzeuge steuern und damit,
 * wer im Ring wie viel zahlt.
 */
async function baueRunde(premium: { b?: number; c?: number } = {}) {
  const a = await createUser("Anna", { stripeAccountId: "acct_a", stripePayoutsEnabled: true });
  const b = await createUser("Bruno", { stripeAccountId: "acct_b", stripePayoutsEnabled: true });
  const c = await createUser("Clara", { stripeAccountId: "acct_c", stripePayoutsEnabled: true });

  const vA = await createVehicle(a);
  const vB = await createVehicle(b);
  const vC = await createVehicle(c);

  if (premium.b) {
    await db.update(listings).set({ askPremium: premium.b }).where(eq(listings.vehicleId, vB));
  }
  if (premium.c) {
    await db.update(listings).set({ askPremium: premium.c }).where(eq(listings.vehicleId, vC));
  }
  return { a, b, c, vA, vB, vC };
}

async function legeRingAn(premium: { b?: number; c?: number } = {}) {
  const runde = await baueRunde(premium);
  als(runde.a);
  const res = await proposeRingAction({ vehicleIds: [runde.vA, runde.vB, runde.vC] });
  expect(res.error).toBeUndefined();
  return { ...runde, ringId: res.ringId! };
}

async function zusagenAlle(ringId: string, b: string, c: string) {
  als(b);
  expect((await acceptRingAction(ringId)).error).toBeUndefined();
  als(c);
  expect((await acceptRingAction(ringId)).error).toBeUndefined();
}

async function beine(ringId: string) {
  return await db
    .select()
    .from(ringLegs)
    .where(eq(ringLegs.ringId, ringId))
    .orderBy(ringLegs.position);
}

/** Die Zahlungen, die dieser Ring braucht — aus den gespeicherten Beinen. */
async function noetigeZahlungen(ringId: string) {
  const legs = await beine(ringId);
  return ringTransfers(legs.map((l) => ({ userId: l.userId, cash: l.cash })));
}

/** Legt eine hinterlegte Zahlung an, wie sie der Webhook erzeugen würde. */
async function hinterlege(
  ringId: string,
  payerId: string,
  payeeId: string,
  amount: number,
  authorizedAt: Date = new Date(),
) {
  const id = newId("pay");
  await db.insert(payments).values({
    id,
    ringId,
    payerId,
    payeeId,
    amountMinor: amount * 100,
    feeMinor: 0,
    status: "autorisiert",
    stripePaymentIntentId: `pi_${id}`,
    authorizedAt,
  });
  return id;
}

/** Hinterlegt jeden nötigen Betrag des Rings. */
async function hinterlegeAlle(ringId: string) {
  const transfers = await noetigeZahlungen(ringId);
  for (const t of transfers) {
    await hinterlege(ringId, t.payerId, t.payeeId, t.amount);
  }
  return transfers;
}

/**
 * Setzt alle Ausgleiche auf null. Zwei „gleiche“ Fahrzeuge haben nie exakt
 * denselben Wert — die Bewertung streut bewusst pro Fahrzeug. Für die Prüfung
 * der Zustandsmaschine ohne Geldfluss wird der Ausgleich deshalb direkt
 * genullt, statt drei Fahrzeuge auf denselben Rappen zu konstruieren.
 */
async function ohneAusgleich(ringId: string) {
  await db.update(ringLegs).set({ cash: 0 }).where(eq(ringLegs.ringId, ringId));
}

async function ringStatus(ringId: string) {
  const [row] = await db.select().from(ringSwaps).where(eq(ringSwaps.id, ringId)).limit(1);
  return row?.status;
}

async function halter(vehicleId: string) {
  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  return row?.ownerId;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  als(null);
});

describe("Ring vorschlagen", () => {
  it("legt drei Beine an, deren Ausgleiche sich zu null summieren", async () => {
    const { ringId, a, b, c, vA, vB, vC } = await legeRingAn({ b: 20_000, c: 50_000 });

    const legs = await db
      .select()
      .from(ringLegs)
      .where(eq(ringLegs.ringId, ringId))
      .orderBy(ringLegs.position);
    expect(legs).toHaveLength(3);
    expect(legs.map((l) => l.userId)).toEqual([a, b, c]);
    expect(legs.map((l) => l.vehicleId)).toEqual([vA, vB, vC]);
    // Jeder gibt an den Nächsten, der Letzte zurück an den Ersten.
    expect(legs.map((l) => l.receiverId)).toEqual([b, c, a]);
    expect(legs.reduce((s, l) => s + l.cash, 0)).toBe(0);
    // Anna zahlt für Claras Aufschlag, Bruno und Clara bekommen ihren. Die
    // Beträge liegen nahe an den Aufschlägen, aber nicht exakt darauf: die
    // Bewertung streut pro Fahrzeug.
    expect(legs[0].cash).toBeGreaterThan(45_000);
    expect(legs[1].cash).toBeLessThan(-15_000);
    expect(legs[2].cash).toBeLessThan(-25_000);
  });

  it("sagt für die vorschlagende Person sofort zu, für die anderen nicht", async () => {
    const { ringId, a } = await legeRingAn();
    const legs = await db.select().from(ringLegs).where(eq(ringLegs.ringId, ringId));
    expect(legs.find((l) => l.userId === a)!.acceptedAt).not.toBeNull();
    expect(legs.filter((l) => l.userId !== a).every((l) => l.acceptedAt === null)).toBe(true);
    expect(await ringStatus(ringId)).toBe("vorschlag");
  });

  it("bindet vor der letzten Zusage kein einziges Fahrzeug", async () => {
    const { ringId } = await legeRingAn();
    const sperren = await db.select().from(dealVehicleLocks);
    expect(sperren).toHaveLength(0);
    const inserate = await db.select().from(listings);
    expect(inserate.every((l) => l.status === "aktiv")).toBe(true);
    expect(await ringStatus(ringId)).toBe("vorschlag");
  });

  it("weist ein fremdes Fahrzeug an erster Stelle zurück", async () => {
    const { a, b, c, vA, vB, vC } = await baueRunde();
    als(b);
    const res = await proposeRingAction({ vehicleIds: [vA, vB, vC] });
    expect(res.error).toMatch(/muss dir gehören/);
    void a;
    void c;
  });

  it("weist ein doppelt genanntes Fahrzeug zurück", async () => {
    const { a, vA, vB } = await baueRunde();
    als(a);
    const res = await proposeRingAction({ vehicleIds: [vA, vB, vB] });
    expect(res.error).toMatch(/nicht zweimal/);
  });

  it("weist einen Ring zurück, dessen Inserat pausiert ist", async () => {
    const { a, vA, vB, vC } = await baueRunde();
    await db.update(listings).set({ status: "pausiert" }).where(eq(listings.vehicleId, vC));
    als(a);
    const res = await proposeRingAction({ vehicleIds: [vA, vB, vC] });
    expect(res.error).toMatch(/nicht mehr verfügbar/);
  });

  it("weist einen Ring zurück, in dem ein Fahrzeug bereits gebunden ist", async () => {
    const { a, b, c, vA, vB, vC } = await baueRunde();
    // Ein Zweiertausch hat vB schon gesperrt.
    const dealId = newId("dl");
    await db.insert(deals).values({
      id: dealId,
      fromVehicleId: vB,
      toVehicleId: vC,
      initiatorId: b,
      counterpartyId: c,
      status: "angenommen",
    });
    await db.insert(dealVehicleLocks).values({ vehicleId: vB, dealId });

    als(a);
    const res = await proposeRingAction({ vehicleIds: [vA, vB, vC] });
    expect(res.error).toMatch(/schon in einem zugesagten Tausch/);
  });

  it("legt für dieselbe Runde keinen zweiten Vorschlag an", async () => {
    const { ringId, a, vA, vB, vC } = await legeRingAn();
    als(a);
    const res = await proposeRingAction({ vehicleIds: [vA, vB, vC] });
    expect(res.error).toMatch(/läuft bereits/);
    expect(res.ringId).toBe(ringId);
  });
});

describe("Zusage", () => {
  it("bindet die Fahrzeuge erst mit der dritten Zusage", async () => {
    const { ringId, b, c, vA, vB, vC } = await legeRingAn();

    als(b);
    expect((await acceptRingAction(ringId)).error).toBeUndefined();
    expect(await ringStatus(ringId)).toBe("vorschlag");
    expect(await db.select().from(dealVehicleLocks)).toHaveLength(0);

    als(c);
    expect((await acceptRingAction(ringId)).error).toBeUndefined();
    expect(await ringStatus(ringId)).toBe("angenommen");

    const sperren = await db.select().from(dealVehicleLocks);
    expect(sperren.map((s) => s.vehicleId).sort()).toEqual([vA, vB, vC].sort());
    expect(sperren.every((s) => s.ringId === ringId && s.dealId === null)).toBe(true);

    const inserate = await db.select().from(listings);
    expect(inserate.every((l) => l.status === "in verhandlung")).toBe(true);
  });

  it("lässt niemanden zweimal zusagen", async () => {
    const { ringId, b } = await legeRingAn();
    als(b);
    expect((await acceptRingAction(ringId)).error).toBeUndefined();
    expect((await acceptRingAction(ringId)).error).toMatch(/bereits zugesagt/);
  });

  it("lässt Unbeteiligte nicht zusagen", async () => {
    const { ringId } = await legeRingAn();
    const fremd = await createUser("Fremd");
    als(fremd);
    expect((await acceptRingAction(ringId)).error).toMatch(/nicht gefunden/);
  });

  it("scheitert, wenn ein Fahrzeug inzwischen den Besitzer gewechselt hat", async () => {
    const { ringId, b, c, vC } = await legeRingAn();
    als(b);
    await acceptRingAction(ringId);
    await db.update(vehicles).set({ ownerId: b }).where(eq(vehicles.id, vC));
    als(c);
    expect((await acceptRingAction(ringId)).error).toMatch(/Besitzer gewechselt/);
    expect(await ringStatus(ringId)).toBe("vorschlag");
  });

  it("scheitert, wenn ein Fahrzeug zwischenzeitlich anderweitig gesperrt wurde", async () => {
    const { ringId, b, c, vB, vC } = await legeRingAn();
    als(b);
    await acceptRingAction(ringId);

    const dealId = newId("dl");
    await db.insert(deals).values({
      id: dealId,
      fromVehicleId: vB,
      toVehicleId: vC,
      initiatorId: b,
      counterpartyId: c,
      status: "angenommen",
    });
    await db.insert(dealVehicleLocks).values({ vehicleId: vB, dealId });

    als(c);
    const res = await acceptRingAction(ringId);
    expect(res.error).toMatch(/anderen zugesagten Tausch/);
    expect(await ringStatus(ringId)).toBe("vorschlag");
    // Die eigene Zusage darf dabei nicht stehen bleiben.
    const [meinBein] = await db
      .select()
      .from(ringLegs)
      .where(and(eq(ringLegs.ringId, ringId), eq(ringLegs.userId, c)));
    expect(meinBein.acceptedAt).toBeNull();
  });

  it("beendet den Ring, sobald eine Partei ablehnt", async () => {
    const { ringId, c } = await legeRingAn();
    als(c);
    expect((await declineRingAction(ringId)).error).toBeUndefined();
    expect(await ringStatus(ringId)).toBe("abgelehnt");
    expect(await db.select().from(dealVehicleLocks)).toHaveLength(0);
  });
});

describe("Treuhand und Abschluss ohne Ausgleich", () => {
  it("führt den Ring bis zum Halterwechsel", async () => {
    const { ringId, a, b, c, vA, vB, vC } = await legeRingAn();
    await ohneAusgleich(ringId);
    await zusagenAlle(ringId, b, c);

    als(a);
    expect((await startRingEscrowAction(ringId)).error).toBeUndefined();
    expect(await ringStatus(ringId)).toBe("treuhand");

    als(a);
    expect((await confirmRingHandoverAction(ringId)).error).toBeUndefined();
    als(b);
    expect((await confirmRingHandoverAction(ringId)).error).toBeUndefined();
    expect(await ringStatus(ringId)).toBe("treuhand");
    als(c);
    expect((await confirmRingHandoverAction(ringId)).error).toBeUndefined();

    expect(await ringStatus(ringId)).toBe("abgeschlossen");
    // Die Fahrzeuge sind einen Platz weitergerückt.
    expect(await halter(vA)).toBe(b);
    expect(await halter(vB)).toBe(c);
    expect(await halter(vC)).toBe(a);

    const inserate = await db.select().from(listings);
    expect(inserate.every((l) => l.status === "getauscht")).toBe(true);
    expect(inserate.find((l) => l.vehicleId === vA)!.ownerId).toBe(b);

    expect(await db.select().from(dealVehicleLocks)).toHaveLength(0);

    const konten = await db.select().from(users);
    expect(konten.every((u) => u.swapsCompleted === 1)).toBe(true);
  });

  it("bricht ab und gibt alles frei", async () => {
    const { ringId, a, b, c, vA } = await legeRingAn();
    await ohneAusgleich(ringId);
    await zusagenAlle(ringId, b, c);
    als(b);
    expect((await cancelRingAction(ringId)).error).toBeUndefined();
    expect(await ringStatus(ringId)).toBe("storniert");
    expect(await db.select().from(dealVehicleLocks)).toHaveLength(0);
    const inserate = await db.select().from(listings);
    expect(inserate.every((l) => l.status === "aktiv")).toBe(true);
    // Kein Fahrzeug hat sich bewegt.
    expect(await halter(vA)).toBe(a);
  });
});

describe("Treuhand und Abschluss mit Ausgleich", () => {
  it("zahlt erst aus, wenn alle Beträge hinterlegt und alle Übergaben bestätigt sind", async () => {
    // Anna zahlt 5'000: 2'000 an Bruno, 3'000 an Clara.
    const { ringId, a, b, c, vA, vB, vC } = await legeRingAn({ b: 20_000, c: 50_000 });
    await zusagenAlle(ringId, b, c);

    // Solange nichts hinterlegt ist, bleibt der Ring in der Zusage.
    expect(await advanceRingToEscrow(ringId)).toBe(false);
    expect(await ringStatus(ringId)).toBe("angenommen");

    // Eine Übergabe lässt sich in diesem Zustand nicht bestätigen.
    als(a);
    expect((await confirmRingHandoverAction(ringId)).error).toMatch(/wenn der Ausgleich hinterlegt ist/);

    const transfers = await noetigeZahlungen(ringId);
    expect(transfers).toHaveLength(2);
    expect(transfers.every((t) => t.payerId === a)).toBe(true);

    await hinterlege(ringId, transfers[0].payerId, transfers[0].payeeId, transfers[0].amount);
    expect(await advanceRingToEscrow(ringId)).toBe(false);
    await hinterlege(ringId, transfers[1].payerId, transfers[1].payeeId, transfers[1].amount);
    expect(await advanceRingToEscrow(ringId)).toBe(true);
    expect(await ringStatus(ringId)).toBe("treuhand");

    als(a);
    await confirmRingHandoverAction(ringId);
    als(b);
    await confirmRingHandoverAction(ringId);
    als(c);
    expect((await confirmRingHandoverAction(ringId)).error).toBeUndefined();

    expect(await ringStatus(ringId)).toBe("abgeschlossen");
    const zahlungen = await db.select().from(payments).where(eq(payments.ringId, ringId));
    expect(zahlungen).toHaveLength(2);
    expect(zahlungen.every((z) => z.status === "ausgezahlt")).toBe(true);
    expect(await halter(vA)).toBe(b);
    expect(await halter(vB)).toBe(c);
    expect(await halter(vC)).toBe(a);
  });

  it("schreibt kein Fahrzeug um, wenn ein Auszahlungskonto fehlt", async () => {
    const { ringId, a, b, c, vA } = await legeRingAn({ b: 20_000, c: 50_000 });
    await zusagenAlle(ringId, b, c);
    await hinterlegeAlle(ringId);
    await advanceRingToEscrow(ringId);
    await db.update(users).set({ stripePayoutsEnabled: false }).where(eq(users.id, c));

    als(a);
    await confirmRingHandoverAction(ringId);
    als(b);
    await confirmRingHandoverAction(ringId);
    als(c);
    const res = await confirmRingHandoverAction(ringId);

    expect(res.error).toMatch(/Auszahlungskonto/);
    expect(await ringStatus(ringId)).toBe("treuhand");
    expect(await halter(vA)).toBe(a);
    const zahlungen = await db.select().from(payments).where(eq(payments.ringId, ringId));
    expect(zahlungen.every((z) => z.status === "autorisiert")).toBe(true);
  });

  it("nimmt den Ring zurück, wenn eine Reservierung verfallen ist", async () => {
    const { ringId, a, b, c } = await legeRingAn({ b: 20_000, c: 50_000 });
    await zusagenAlle(ringId, b, c);
    await hinterlegeAlle(ringId);
    await advanceRingToEscrow(ringId);

    als(a);
    await confirmRingHandoverAction(ringId);
    als(b);
    await confirmRingHandoverAction(ringId);

    // Eine Reservierung verfällt nach sieben Tagen.
    await db
      .update(payments)
      .set({ authorizedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })
      .where(and(eq(payments.ringId, ringId), eq(payments.payeeId, c)));

    als(c);
    const res = await confirmRingHandoverAction(ringId);
    expect(res.error).toMatch(/nicht mehr gültig/);
    expect(await ringStatus(ringId)).toBe("angenommen");
    // Alle Bestätigungen sind zurückgesetzt.
    const legs = await db.select().from(ringLegs).where(eq(ringLegs.ringId, ringId));
    expect(legs.every((l) => l.confirmedAt === null)).toBe(true);
  });

  it("gibt beim Abbruch alle hinterlegten Beträge frei", async () => {
    const { ringId, a, b, c } = await legeRingAn({ b: 20_000, c: 50_000 });
    await zusagenAlle(ringId, b, c);
    await hinterlegeAlle(ringId);
    await advanceRingToEscrow(ringId);

    als(c);
    expect((await cancelRingAction(ringId)).error).toBeUndefined();
    expect(await ringStatus(ringId)).toBe("storniert");
    const zahlungen = await db.select().from(payments).where(eq(payments.ringId, ringId));
    expect(zahlungen.every((z) => z.status === "storniert")).toBe(true);
  });

  it("lässt sich in der Abwicklung nicht mehr abbrechen", async () => {
    const { ringId, b, c } = await legeRingAn();
    await ohneAusgleich(ringId);
    await zusagenAlle(ringId, b, c);
    als(b);
    await startRingEscrowAction(ringId);
    await db.update(ringSwaps).set({ status: "abwicklung" }).where(eq(ringSwaps.id, ringId));
    als(c);
    expect((await cancelRingAction(ringId)).error).toMatch(/nicht mehr möglich/);
  });

  it("verlangt die Einzahlung nur von den Zahlenden", async () => {
    const { ringId, b, c } = await legeRingAn({ b: 20_000, c: 50_000 });
    await zusagenAlle(ringId, b, c);
    als(b);
    const res = await startRingEscrowAction(ringId);
    expect(res.error).toMatch(/nichts einzuzahlen/);
  });

  it("verweigert die Einzahlung, solange das Empfängerkonto fehlt", async () => {
    const { ringId, a, b, c } = await legeRingAn({ b: 20_000, c: 50_000 });
    await zusagenAlle(ringId, b, c);
    await db.update(users).set({ stripePayoutsEnabled: false }).where(eq(users.id, b));
    als(a);
    const res = await startRingEscrowAction(ringId);
    expect(res.error).toMatch(/Auszahlungskonto/);
  });
});

describe("Ring und Zweiertausch teilen sich die Fahrzeugsperre", () => {
  it("verhindert, dass ein gebundenes Fahrzeug in einen zweiten Ring kommt", async () => {
    const { ringId, a, b, c, vA, vB, vC } = await legeRingAn();
    await zusagenAlle(ringId, b, c);

    // Ein vierter legt einen zweiten Ring mit demselben Fahrzeug an.
    const d = await createUser("Dora");
    const vD = await createVehicle(d);
    // Inserate der gebundenen Fahrzeuge wieder aktiv setzen, damit allein die
    // Sperre die zweite Zusage aufhält.
    await db.update(listings).set({ status: "aktiv" }).where(eq(listings.vehicleId, vB));
    await db.update(listings).set({ status: "aktiv" }).where(eq(listings.vehicleId, vC));

    als(d);
    const zweiter = await proposeRingAction({ vehicleIds: [vD, vB, vC] });
    expect(zweiter.error).toMatch(/schon in einem zugesagten Tausch/);
    void a;
    void vA;
  });
});

describe("Gleichzeitige Zusagen", () => {
  it("bindet den Ring auch dann, wenn die letzten beiden Zusagen zusammenfallen", async () => {
    // Zehn Durchläufe: die Verschränkung zweier gleichzeitiger Transaktionen
    // ist nicht deterministisch, ein einzelner Versuch kann das Problem
    // zufällig verfehlen.
    for (let i = 0; i < 10; i++) {
      const { ringId, b, c, vA, vB, vC } = await legeRingAn();

      // Beide Zusagen laufen wirklich parallel — ohne die Sperre auf dem Ring
      // sähe unter READ COMMITTED keine der beiden die Änderung der anderen,
      // und der Ring bliebe im Vorschlag stehen, obwohl alle drei zugesagt
      // haben. Die drei Fahrzeuge wären dann für immer unerreichbar gebunden.
      const ergebnisse = await Promise.all([acceptRingLeg(ringId, b), acceptRingLeg(ringId, c)]);
      expect(ergebnisse.every((r) => r.ok)).toBe(true);
      expect(ergebnisse.filter((r) => r.ok && r.vollstaendig)).toHaveLength(1);

      expect(await ringStatus(ringId)).toBe("angenommen");
      const sperren = await db.select().from(dealVehicleLocks);
      expect(sperren.map((s) => s.vehicleId).sort()).toEqual([vA, vB, vC].sort());
      await resetDatabase();
    }
  });

  it("lässt dieselbe Person nicht zweimal parallel zusagen", async () => {
    const { ringId, b } = await legeRingAn();
    const ergebnisse = await Promise.all([acceptRingLeg(ringId, b), acceptRingLeg(ringId, b)]);
    expect(ergebnisse.filter((r) => r.ok)).toHaveLength(1);
    const legs = await beine(ringId);
    expect(legs.filter((l) => l.acceptedAt !== null)).toHaveLength(2);
  });

  it("hält den zweiten Ring an der Fahrzeugsperre auf", async () => {
    // Zwei Ringe werden vorgeschlagen, bevor einer verbindlich ist — sie
    // teilen sich zwei Fahrzeuge. Kein Zweiertausch ist im Spiel, es hält
    // also allein der Primärschlüssel der Sperrtabelle.
    const { ringId, a, b, c, vA, vB, vC } = await legeRingAn();
    const d = await createUser("Dora");
    const vD = await createVehicle(d);

    als(d);
    const zweiter = await proposeRingAction({ vehicleIds: [vD, vB, vC] });
    expect(zweiter.error).toBeUndefined();

    await zusagenAlle(ringId, b, c);
    expect(await ringStatus(ringId)).toBe("angenommen");

    als(b);
    expect((await acceptRingAction(zweiter.ringId!)).error).toBeUndefined();
    als(c);
    const res = await acceptRingAction(zweiter.ringId!);
    expect(res.error).toMatch(/anderen zugesagten Tausch/);
    expect(await ringStatus(zweiter.ringId!)).toBe("vorschlag");

    // Die Sperren des ersten Rings sind unangetastet.
    const sperren = await db.select().from(dealVehicleLocks);
    expect(sperren).toHaveLength(3);
    expect(sperren.every((s) => s.ringId === ringId)).toBe(true);
    void a;
    void vA;
  });
});

describe("Kontolöschung und Ringe", () => {
  it("hält die Löschung auf, solange ein Ring verbindlich läuft", async () => {
    const { ringId, b, c } = await legeRingAn();
    await ohneAusgleich(ringId);
    await zusagenAlle(ringId, b, c);
    als(b);
    const res = await deleteAccountAction("LÖSCHEN");
    expect(res.error).toMatch(/Ringtausch/);
  });

  it("zieht offene Ringvorschläge zurück", async () => {
    const { ringId, b } = await legeRingAn();
    als(b);
    const res = await deleteAccountAction("LÖSCHEN");
    expect(res.error).toBeUndefined();
    expect(await ringStatus(ringId)).toBe("storniert");
  });
});

describe("Nachholen, wenn ein Stripe-Ereignis ausbleibt", () => {
  it("bringt den Ring in die Treuhandphase, sobald jemand die Einzahlung erneut anstösst", async () => {
    const { ringId, a, b, c } = await legeRingAn({ b: 20_000, c: 50_000 });
    await zusagenAlle(ringId, b, c);
    // Beide Beträge liegen bereit, der Ring hängt aber noch in der Zusage —
    // so sieht es aus, wenn das letzte Stripe-Ereignis nicht ankommt.
    await hinterlegeAlle(ringId);
    expect(await ringStatus(ringId)).toBe("angenommen");

    als(a);
    expect((await startRingEscrowAction(ringId)).error).toBeUndefined();
    expect(await ringStatus(ringId)).toBe("treuhand");
  });

  it("holt das auch für jemanden nach, der selbst nichts einzahlt", async () => {
    const { ringId, b, c } = await legeRingAn({ b: 20_000, c: 50_000 });
    await zusagenAlle(ringId, b, c);
    await hinterlegeAlle(ringId);

    als(b);
    expect((await startRingEscrowAction(ringId)).error).toBeUndefined();
    expect(await ringStatus(ringId)).toBe("treuhand");
  });
});

describe("Vorschlag zurückziehen", () => {
  it("lässt die vorschlagende Person den Ring wieder auflösen", async () => {
    const { ringId, a, b } = await legeRingAn();
    als(b);
    await acceptRingAction(ringId);
    als(a);
    expect((await declineRingAction(ringId)).error).toBeUndefined();
    expect(await ringStatus(ringId)).toBe("abgelehnt");
  });
});

describe("Bewertungen nach einem Ring", () => {
  /** Führt einen ausgleichslosen Ring bis zum Abschluss. */
  async function abgeschlossenerRing() {
    const runde = await legeRingAn();
    await ohneAusgleich(runde.ringId);
    await zusagenAlle(runde.ringId, runde.b, runde.c);
    als(runde.a);
    await startRingEscrowAction(runde.ringId);
    for (const wer of [runde.a, runde.b, runde.c]) {
      als(wer);
      await confirmRingHandoverAction(runde.ringId);
    }
    expect(await ringStatus(runde.ringId)).toBe("abgeschlossen");
    return runde;
  }

  it("lässt jede Person die beiden anderen einzeln bewerten", async () => {
    const { ringId, a, b, c } = await abgeschlossenerRing();
    als(a);
    expect((await submitRingReviewAction(ringId, b, 5, "Alles bestens")).error).toBeUndefined();
    expect((await submitRingReviewAction(ringId, c, 4, "")).error).toBeUndefined();

    const bewertungen = await db.select().from(reviews).where(eq(reviews.ringId, ringId));
    expect(bewertungen).toHaveLength(2);

    const [bruno] = await db.select().from(users).where(eq(users.id, b));
    expect(bruno.ratingCount).toBe(1);
    expect(bruno.ratingSum).toBe(50);
    const [clara] = await db.select().from(users).where(eq(users.id, c));
    expect(clara.ratingSum).toBe(40);
  });

  it("lässt dieselbe Bewertung nicht zweimal zu", async () => {
    const { ringId, a, b } = await abgeschlossenerRing();
    als(a);
    await submitRingReviewAction(ringId, b, 5, "");
    const res = await submitRingReviewAction(ringId, b, 1, "");
    expect(res.error).toMatch(/bereits bewertet/);
    const [bruno] = await db.select().from(users).where(eq(users.id, b));
    expect(bruno.ratingCount).toBe(1);
  });

  it("verweigert die Bewertung vor dem Abschluss", async () => {
    const { ringId, a, b, c } = await legeRingAn();
    await zusagenAlle(ringId, b, c);
    als(a);
    const res = await submitRingReviewAction(ringId, b, 5, "");
    expect(res.error).toMatch(/abgeschlossener Tausch/);
  });

  it("verweigert Selbstbewertung und Fremde", async () => {
    const { ringId, a } = await abgeschlossenerRing();
    const fremd = await createUser("Fremd");
    als(a);
    expect((await submitRingReviewAction(ringId, a, 5, "")).error).toMatch(/Sich selbst/);
    expect((await submitRingReviewAction(ringId, fremd, 5, "")).error).toMatch(/gehört nicht/);
    als(fremd);
    expect((await submitRingReviewAction(ringId, a, 5, "")).error).toMatch(/nicht gefunden/);
  });
});
