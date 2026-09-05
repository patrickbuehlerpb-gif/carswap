import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { deals, listings, payments, ringLegs, ringSwaps, users, vehicles } from "@/lib/db/schema";
import { ringTransfers } from "@/lib/rings";
import { als, createUser, createVehicle, resetDatabase } from "@/test/fixtures";

/**
 * Stripe wird nicht angesprochen. Der Einzug wird nachgebildet — und zwar so,
 * dass er nur klappt, wenn das Auszahlungskonto freigeschaltet ist: genau
 * daran scheitert er in der Wirklichkeit.
 */
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
      const rows = await db.select().from(users).where(eq(users.id, payment.payeeId)).limit(1);
      if (!rows[0]?.stripePayoutsEnabled) throw new original.PayoutBlockedError(payment.payeeId);
      const [updated] = await db
        .update(payments)
        .set({ status: "ausgezahlt", stripeTransferId: `tr_${payment.id}`, updatedAt: new Date() })
        .where(eq(payments.id, payment.id))
        .returning();
      return updated;
    },
  };
});

const briefe: { to: string; subject: string; text?: string }[] = [];
vi.mock("@/lib/mail", () => ({
  sendMail: async (m: { to: string; subject: string; text: string }) => {
    briefe.push(m);
    return { delivered: true };
  },
  siteUrl: () => "https://quitt.test",
  siteUrlConfigured: () => true,
  mailConfigured: () => true,
}));

const { holeAbschluesseNach } = await import("@/lib/wartung");

beforeEach(async () => {
  await resetDatabase();
  als(null);
  briefe.length = 0;
});

/**
 * Genau die Lage, die entsteht, wenn die Weiterleitung nach dem Einzug
 * scheitert: beide haben bestätigt, das Geld ist eingezogen, aber nicht
 * überwiesen — und niemand kommt zurück.
 */
async function steckengeblieben(opts: { payoutsEnabled?: boolean } = {}) {
  const payouts = opts.payoutsEnabled ?? true;
  const a = await createUser("Anna", { stripeAccountId: "acct_a", stripePayoutsEnabled: true });
  const b = await createUser("Bruno", { stripeAccountId: "acct_b", stripePayoutsEnabled: payouts });
  const va = await createVehicle(a, { make: "Polestar", model: "4" });
  const vb = await createVehicle(b, { make: "Zeekr", model: "7X" });

  const dealId = newId("dl");
  await db.insert(deals).values({
    id: dealId,
    fromVehicleId: va,
    toVehicleId: vb,
    initiatorId: a,
    counterpartyId: b,
    // Anna zahlt drauf, Bruno bekommt.
    cashDelta: 4_000,
    status: "treuhand",
    escrowAt: new Date(),
    initiatorConfirmed: true,
    counterpartyConfirmed: true,
  });
  const payId = newId("pay");
  await db.insert(payments).values({
    id: payId,
    dealId,
    payerId: a,
    payeeId: b,
    amountMinor: 400_000,
    feeMinor: 0,
    status: "eingezogen",
    stripePaymentIntentId: `pi_${payId}`,
    authorizedAt: new Date(),
  });
  return { a, b, va, vb, dealId, payId };
}

async function halter(vehicleId: string): Promise<string> {
  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  return row.ownerId;
}

describe("Steckengebliebene Abschlüsse nachholen", () => {
  it("leitet das eingezogene Geld weiter und schreibt die Autos um", async () => {
    const { a, b, va, vb, dealId, payId } = await steckengeblieben();

    const lauf = await holeAbschluesseNach();
    expect(lauf).toMatchObject({ geprueft: 1, abgeschlossen: 1, festgefahren: 0 });

    const [zahlung] = await db.select().from(payments).where(eq(payments.id, payId));
    expect(zahlung.status).toBe("ausgezahlt");
    expect(zahlung.stripeTransferId).not.toBeNull();

    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(deal.status).toBe("abgeschlossen");
    expect(await halter(va)).toBe(b);
    expect(await halter(vb)).toBe(a);
  });

  it("schreibt kein Auto um, solange das Auszahlungskonto fehlt", async () => {
    const { a, va, vb, dealId, payId } = await steckengeblieben({ payoutsEnabled: false });

    const lauf = await holeAbschluesseNach();
    expect(lauf).toMatchObject({ geprueft: 1, abgeschlossen: 0, wartetAufKonto: 1 });

    const [zahlung] = await db.select().from(payments).where(eq(payments.id, payId));
    expect(zahlung.status).toBe("eingezogen");
    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(deal.status).toBe("treuhand");
    expect(await halter(va)).toBe(a);
    expect(await halter(vb)).not.toBe(a);
  });

  it("erinnert die Person, an der es hängt", async () => {
    const { b } = await steckengeblieben({ payoutsEnabled: false });
    await holeAbschluesseNach();

    const [bruno] = await db.select().from(users).where(eq(users.id, b));
    expect(briefe.map((b) => ({ to: b.to, subject: b.subject }))).toEqual([
      { to: bruno.email, subject: "quitt: Auszahlungskonto fehlt noch" },
    ]);
  });

  it("holt es nach, sobald das Konto da ist", async () => {
    const { b, dealId } = await steckengeblieben({ payoutsEnabled: false });
    await holeAbschluesseNach();

    await db.update(users).set({ stripePayoutsEnabled: true }).where(eq(users.id, b));
    const zweiter = await holeAbschluesseNach();

    expect(zweiter).toMatchObject({ abgeschlossen: 1 });
    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(deal.status).toBe("abgeschlossen");
  });

  it("lässt einen zweiten Lauf am fertigen Tausch nichts mehr tun", async () => {
    await steckengeblieben();
    await holeAbschluesseNach();
    expect(await holeAbschluesseNach()).toEqual({
      geprueft: 0,
      abgeschlossen: 0,
      wartetAufKonto: 0,
      festgefahren: 0,
    });
  });

  it("fasst einen Tausch nicht an, bei dem erst eine Seite bestätigt hat", async () => {
    const { dealId } = await steckengeblieben();
    await db.update(deals).set({ counterpartyConfirmed: false }).where(eq(deals.id, dealId));

    expect(await holeAbschluesseNach()).toMatchObject({ geprueft: 0, abgeschlossen: 0 });
    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(deal.status).toBe("treuhand");
  });

  it("fasst einen abgebrochenen Tausch nicht an", async () => {
    const { dealId, va } = await steckengeblieben();
    await db.update(deals).set({ status: "storniert" }).where(eq(deals.id, dealId));

    expect(await holeAbschluesseNach()).toMatchObject({ geprueft: 0 });
    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(deal.status).toBe("storniert");
    // Das Auto bleibt, wo es ist.
    const [fahrzeug] = await db.select().from(vehicles).where(eq(vehicles.id, va));
    expect(fahrzeug.ownerId).toBe(deal.initiatorId);
  });

  it("setzt einen Tausch mit verfallener Reservierung zurück, statt ihn abzuschliessen", async () => {
    const { dealId, payId, va, a } = await steckengeblieben();
    await db.update(payments).set({ status: "storniert" }).where(eq(payments.id, payId));

    const lauf = await holeAbschluesseNach();
    expect(lauf).toMatchObject({ geprueft: 1, abgeschlossen: 0, festgefahren: 0 });

    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(deal.status).toBe("angenommen");
    expect(deal.initiatorConfirmed).toBe(false);
    expect(deal.counterpartyConfirmed).toBe(false);
    expect(await halter(va)).toBe(a);
  });

  it("kommt ohne offene Abschlüsse zurecht", async () => {
    expect(await holeAbschluesseNach()).toEqual({
      geprueft: 0,
      abgeschlossen: 0,
      wartetAufKonto: 0,
      festgefahren: 0,
    });
  });
});

/**
 * Dasselbe für den Ring: alle drei haben bestätigt, alle nötigen Beträge sind
 * eingezogen, die Weiterleitung ist aber nie durchgelaufen.
 */
async function ringSteckengeblieben(opts: { payoutsEnabled?: boolean } = {}) {
  const payouts = opts.payoutsEnabled ?? true;
  const ids: string[] = [];
  const autos: string[] = [];
  for (const [i, name] of ["Anna", "Bruno", "Clara"].entries()) {
    const id = await createUser(name, {
      stripeAccountId: `acct_${i}`,
      // Nur die dritte Person hat gegebenenfalls kein Konto.
      stripePayoutsEnabled: i === 2 ? payouts : true,
    });
    ids.push(id);
    autos.push(await createVehicle(id));
  }
  // Ein Aufschlag auf dem dritten Auto erzeugt einen echten Geldfluss.
  await db.update(listings).set({ askPremium: 5_000 }).where(eq(listings.vehicleId, autos[2]));

  const ringId = newId("ring");
  await db.insert(ringSwaps).values({
    id: ringId,
    initiatorId: ids[0],
    status: "treuhand",
    acceptedAt: new Date(),
    escrowAt: new Date(),
  });
  // Anna zahlt, Clara bekommt — ein Weg, ein Betrag.
  const cash = [4_000, 0, -4_000];
  for (const [i, userId] of ids.entries()) {
    await db.insert(ringLegs).values({
      id: newId("leg"),
      ringId,
      position: i,
      userId,
      vehicleId: autos[i],
      receiverId: ids[(i + 1) % 3],
      cash: cash[i],
      acceptedAt: new Date(),
      confirmedAt: new Date(),
    });
  }

  const wege = ringTransfers(ids.map((userId, i) => ({ userId, cash: cash[i] })));
  const zahlungen: string[] = [];
  for (const t of wege) {
    const id = newId("pay");
    await db.insert(payments).values({
      id,
      ringId,
      payerId: t.payerId,
      payeeId: t.payeeId,
      amountMinor: t.amount * 100,
      feeMinor: 0,
      status: "eingezogen",
      stripePaymentIntentId: `pi_${id}`,
      authorizedAt: new Date(),
    });
    zahlungen.push(id);
  }
  return { ids, autos, ringId, zahlungen };
}

describe("Steckengebliebene Ringabschlüsse nachholen", () => {
  it("leitet weiter und schiebt die drei Autos einen Platz weiter", async () => {
    const { ids, autos, ringId, zahlungen } = await ringSteckengeblieben();

    const lauf = await holeAbschluesseNach();
    expect(lauf).toMatchObject({ geprueft: 1, abgeschlossen: 1, festgefahren: 0 });

    const [ring] = await db.select().from(ringSwaps).where(eq(ringSwaps.id, ringId));
    expect(ring.status).toBe("abgeschlossen");
    for (const id of zahlungen) {
      const [z] = await db.select().from(payments).where(eq(payments.id, id));
      expect(z.status).toBe("ausgezahlt");
    }
    // Jedes Auto gehört jetzt der nächsten Person im Ring.
    for (const [i, auto] of autos.entries()) {
      expect(await halter(auto)).toBe(ids[(i + 1) % 3]);
    }
  });

  it("rührt keinen Ring an, solange ein Auszahlungskonto fehlt", async () => {
    const { ids, autos, ringId } = await ringSteckengeblieben({ payoutsEnabled: false });

    const lauf = await holeAbschluesseNach();
    expect(lauf).toMatchObject({ abgeschlossen: 0, wartetAufKonto: 1 });

    const [ring] = await db.select().from(ringSwaps).where(eq(ringSwaps.id, ringId));
    expect(ring.status).toBe("treuhand");
    for (const [i, auto] of autos.entries()) {
      expect(await halter(auto)).toBe(ids[i]);
    }
  });

  it("fasst einen Ring nicht an, bei dem eine Bestätigung fehlt", async () => {
    const { ringId, ids } = await ringSteckengeblieben();
    await db
      .update(ringLegs)
      .set({ confirmedAt: null })
      .where(and(eq(ringLegs.ringId, ringId), eq(ringLegs.userId, ids[1])));

    expect(await holeAbschluesseNach()).toMatchObject({ geprueft: 0, abgeschlossen: 0 });
    const [ring] = await db.select().from(ringSwaps).where(eq(ringSwaps.id, ringId));
    expect(ring.status).toBe("treuhand");
  });
});
