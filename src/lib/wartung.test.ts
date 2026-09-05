import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import {
  authTokens,
  deals,
  payments,
  rateLimits,
  ringLegs,
  ringSwaps,
  sessions,
} from "@/lib/db/schema";
import { als, createUser, createVehicle, resetDatabase } from "@/test/fixtures";
import { gibVerwaisteZahlungenFrei, haengendeGelder, raeumeAuf } from "@/lib/wartung";

/** Stripe wird nicht angesprochen; die Freigabe wird nachgebildet. */
vi.mock("@/lib/payments", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/payments")>();
  return {
    ...original,
    stripeConfigured: () => true,
    releaseAuthorization: async (payment: typeof payments.$inferSelect) => {
      if (payment.id.endsWith("kaputt")) throw new Error("Stripe nicht erreichbar");
      await db
        .update(payments)
        .set({ status: payment.status === "eingezogen" ? "erstattet" : "storniert" })
        .where(eq(payments.id, payment.id));
    },
  };
});

async function tausch(status: (typeof deals.$inferSelect)["status"]) {
  const a = await createUser("Anna");
  const b = await createUser("Bruno");
  const vA = await createVehicle(a);
  const vB = await createVehicle(b);
  const id = newId("dl");
  await db.insert(deals).values({
    id,
    fromVehicleId: vA,
    toVehicleId: vB,
    initiatorId: a,
    counterpartyId: b,
    cashDelta: 2_000,
    status,
  });
  return { id, a, b };
}

async function zahlung(
  bezug: { dealId?: string; ringId?: string },
  payerId: string,
  payeeId: string,
  status: (typeof payments.$inferSelect)["status"],
  extra: Partial<typeof payments.$inferInsert> = {},
) {
  const id = extra.id ?? newId("pay");
  await db.insert(payments).values({
    id,
    ...bezug,
    payerId,
    payeeId,
    amountMinor: 200_000,
    status,
    stripePaymentIntentId: `pi_${id}`,
    ...extra,
  });
  return id;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  als(null);
});

describe("Verwaiste Zahlungen freigeben", () => {
  it("gibt eine Reservierung frei, die zu einem abgebrochenen Tausch gehört", async () => {
    const t = await tausch("storniert");
    const p = await zahlung({ dealId: t.id }, t.a, t.b, "autorisiert");

    const ergebnis = await gibVerwaisteZahlungenFrei();
    expect(ergebnis).toEqual({ freigegeben: 1, fehler: 0 });

    const [row] = await db.select().from(payments).where(eq(payments.id, p));
    expect(row.status).toBe("storniert");
  });

  it("erstattet einen bereits eingezogenen Betrag", async () => {
    const t = await tausch("abgelehnt");
    const p = await zahlung({ dealId: t.id }, t.a, t.b, "eingezogen");

    await gibVerwaisteZahlungenFrei();
    const [row] = await db.select().from(payments).where(eq(payments.id, p));
    expect(row.status).toBe("erstattet");
  });

  it("lässt Zahlungen zu laufenden Tauschen unangetastet", async () => {
    const t = await tausch("treuhand");
    const p = await zahlung({ dealId: t.id }, t.a, t.b, "autorisiert");

    const ergebnis = await gibVerwaisteZahlungenFrei();
    expect(ergebnis.freigegeben).toBe(0);
    const [row] = await db.select().from(payments).where(eq(payments.id, p));
    expect(row.status).toBe("autorisiert");
  });

  it("lässt abgeschlossene Zahlungen unangetastet", async () => {
    const t = await tausch("storniert");
    const p = await zahlung({ dealId: t.id }, t.a, t.b, "ausgezahlt");

    const ergebnis = await gibVerwaisteZahlungenFrei();
    expect(ergebnis.freigegeben).toBe(0);
    const [row] = await db.select().from(payments).where(eq(payments.id, p));
    expect(row.status).toBe("ausgezahlt");
  });

  it("greift auch bei einem abgebrochenen Ring", async () => {
    const a = await createUser("Anna");
    const b = await createUser("Bruno");
    const c = await createUser("Clara");
    const ringId = newId("rng");
    await db.insert(ringSwaps).values({ id: ringId, initiatorId: a, status: "storniert" });
    const fahrzeuge = [await createVehicle(a), await createVehicle(b), await createVehicle(c)];
    const wer = [a, b, c];
    await db.insert(ringLegs).values(
      wer.map((userId, i) => ({
        id: newId("leg"),
        ringId,
        position: i,
        userId,
        vehicleId: fahrzeuge[i],
        receiverId: wer[(i + 1) % 3],
        cash: 0,
      })),
    );
    const p = await zahlung({ ringId }, a, b, "autorisiert");

    await gibVerwaisteZahlungenFrei();
    const [row] = await db.select().from(payments).where(eq(payments.id, p));
    expect(row.status).toBe("storniert");
  });

  it("vermerkt einen Fehlschlag, statt ihn zu verschlucken", async () => {
    const t = await tausch("storniert");
    const p = await zahlung({ dealId: t.id }, t.a, t.b, "autorisiert", {
      id: `pay_kaputt`,
    });

    const ergebnis = await gibVerwaisteZahlungenFrei();
    expect(ergebnis).toEqual({ freigegeben: 0, fehler: 1 });

    const [row] = await db.select().from(payments).where(eq(payments.id, p));
    // Der Zustand bleibt, damit der nächste Lauf es erneut versucht.
    expect(row.status).toBe("autorisiert");
    expect(row.lastError).toMatch(/Wartungslauf/);
  });

  it("schliesst eine Zahlung ohne Stripe-Transaktion einfach ab", async () => {
    const t = await tausch("storniert");
    const p = await zahlung({ dealId: t.id }, t.a, t.b, "erstellt", {
      stripePaymentIntentId: null,
    });

    const ergebnis = await gibVerwaisteZahlungenFrei();
    expect(ergebnis.freigegeben).toBe(1);
    const [row] = await db.select().from(payments).where(eq(payments.id, p));
    expect(row.status).toBe("storniert");
  });
});

describe("Aufräumen", () => {
  it("löscht abgelaufene Sitzungen, alte Token und alte Zählerstände", async () => {
    const u = await createUser("Anna");
    const gestern = new Date(Date.now() - 48 * 60 * 60 * 1000);

    await db.insert(sessions).values([
      { id: newId("ses"), userId: u, tokenHash: "abgelaufen", expiresAt: gestern },
      { id: newId("ses"), userId: u, tokenHash: "gueltig", expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    await db.insert(authTokens).values([
      { id: newId("tok"), userId: u, purpose: "verify_email", tokenHash: "alt", expiresAt: gestern },
      { id: newId("tok"), userId: u, purpose: "verify_email", tokenHash: "verbraucht", expiresAt: new Date(Date.now() + 86_400_000), usedAt: gestern },
      { id: newId("tok"), userId: u, purpose: "reset_password", tokenHash: "frisch", expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    await db.insert(rateLimits).values([
      { key: "alt", count: 3, windowStart: gestern },
      { key: "frisch", count: 1, windowStart: new Date() },
    ]);

    const ergebnis = await raeumeAuf();
    expect(ergebnis).toEqual({ sitzungen: 1, token: 2, zaehler: 1, mailfehler: 0 });

    expect(await db.select().from(sessions)).toHaveLength(1);
    expect(await db.select().from(authTokens)).toHaveLength(1);
    expect(await db.select().from(rateLimits)).toHaveLength(1);
  });

  it("lässt ein gerade verbrauchtes Token stehen", async () => {
    const u = await createUser("Anna");
    await db.insert(authTokens).values({
      id: newId("tok"),
      userId: u,
      purpose: "verify_email",
      tokenHash: "eben verbraucht",
      expiresAt: new Date(Date.now() + 86_400_000),
      usedAt: new Date(),
    });

    // Wer zweimal auf denselben Link klickt, soll «bereits verwendet» lesen
    // und nicht «unbekannter Link».
    expect((await raeumeAuf()).token).toBe(0);
  });
});

describe("Liegengebliebenes Geld", () => {
  it("zählt eingezogene Beträge, die noch nicht weitergeleitet sind", async () => {
    const t = await tausch("abwicklung");
    await zahlung({ dealId: t.id }, t.a, t.b, "eingezogen");
    await zahlung({ dealId: t.id }, t.b, t.a, "ausgezahlt", { stripeTransferId: "tr_1" });

    expect(await haengendeGelder()).toEqual({ anzahl: 1, summeMinor: 200_000 });
  });

  it("meldet nichts, wenn alles weitergeleitet ist", async () => {
    const t = await tausch("abgeschlossen");
    await zahlung({ dealId: t.id }, t.a, t.b, "ausgezahlt", { stripeTransferId: "tr_1" });

    expect(await haengendeGelder()).toEqual({ anzahl: 0, summeMinor: 0 });
  });
});
