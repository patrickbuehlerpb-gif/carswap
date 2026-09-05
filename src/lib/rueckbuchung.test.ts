import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { dealMessages, deals, payments, users } from "@/lib/db/schema";
import { createUser, createVehicle, resetDatabase } from "@/test/fixtures";
import { offeneRueckbuchungen } from "@/lib/wartung";
import { betriebsbild } from "@/lib/betrieb";

const briefe: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/mail", () => ({
  sendMail: async (m: { to: string; subject: string; text: string }) => {
    briefe.push(m);
    return { delivered: true };
  },
  siteUrl: () => "https://autotauschen.test",
  siteUrlConfigured: () => true,
  mailConfigured: () => true,
}));

const { HANDLED, handleEvent } = await import("@/app/api/stripe/webhook/route");

/** Ein abgeschlossener Tausch, dessen Ausgleich längst beim Empfänger ist. */
async function abgeschlossen() {
  const a = await createUser("Anna");
  const b = await createUser("Bruno");
  const dealId = newId("dl");
  await db.insert(deals).values({
    id: dealId,
    fromVehicleId: await createVehicle(a),
    toVehicleId: await createVehicle(b),
    initiatorId: a,
    counterpartyId: b,
    cashDelta: 4_000,
    status: "abgeschlossen",
    completedAt: new Date(),
  });
  const paymentId = newId("pay");
  const intentId = `pi_${paymentId}`;
  await db.insert(payments).values({
    id: paymentId,
    dealId,
    payerId: a,
    payeeId: b,
    amountMinor: 400_000,
    feeMinor: 12_000,
    status: "ausgezahlt",
    stripePaymentIntentId: intentId,
    stripeTransferId: "tr_1",
  });
  return { a, b, dealId, paymentId, intentId };
}

function anfechtung(
  intentId: string,
  overrides: Partial<Stripe.Dispute> = {},
): Stripe.Dispute {
  return {
    id: newId("dp"),
    amount: 400_000,
    currency: "chf",
    created: Math.floor(Date.parse("2026-03-01T10:00:00Z") / 1000),
    payment_intent: intentId,
    reason: "fraudulent",
    status: "needs_response",
    evidence_details: { due_by: Math.floor(Date.parse("2026-03-15T00:00:00Z") / 1000) },
    ...overrides,
  } as unknown as Stripe.Dispute;
}

function ereignis(type: string, object: unknown): Stripe.Event {
  return { id: newId("evt"), type, data: { object } } as unknown as Stripe.Event;
}

async function zahlung(id: string) {
  const [row] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  return row;
}

beforeEach(async () => {
  await resetDatabase();
  briefe.length = 0;
  process.env.OPERATOR_EMAIL = "betrieb@autotauschen.test";
});

describe("Rückbuchung", () => {
  it("vermerkt sie, ohne den Abwicklungsstand zu überschreiben", async () => {
    const { paymentId, intentId } = await abgeschlossen();

    await handleEvent(ereignis("charge.dispute.created", anfechtung(intentId)));

    const p = await zahlung(paymentId);
    // Der Status bleibt «ausgezahlt» — sonst ginge verloren, dass das Geld
    // schon beim Empfänger war.
    expect(p.status).toBe("ausgezahlt");
    expect(p.stripeTransferId).toBe("tr_1");
    expect(p.disputedAt).not.toBeNull();
    expect(p.disputeStatus).toBe("needs_response");
    expect(p.disputeAmountMinor).toBe(400_000);
  });

  it("schreibt der Betreiberin mit Betrag, Grund und Frist", async () => {
    const { intentId } = await abgeschlossen();
    await handleEvent(ereignis("charge.dispute.created", anfechtung(intentId)));

    const anBetrieb = briefe.find((b) => b.to === "betrieb@autotauschen.test");
    expect(anBetrieb).toBeDefined();
    expect(anBetrieb!.subject).toBe("autotauschen: Rückbuchung über 4000.00 CHF");
    expect(anBetrieb!.text).toMatch(/fraudulent/);
    expect(anBetrieb!.text).toMatch(/2026-03-15/);
    expect(anBetrieb!.text).toMatch(/Plattformkonto/);
  });

  it("informiert beide Beteiligten und den Verlauf", async () => {
    const { a, b, dealId, intentId } = await abgeschlossen();
    await handleEvent(ereignis("charge.dispute.created", anfechtung(intentId)));

    const adressen = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, a));
    const [brunoZeile] = await db.select({ email: users.email }).from(users).where(eq(users.id, b));
    const anBeteiligte = briefe.filter((x) => x.subject === "autotauschen: Rückbuchung zu eurem Tausch");
    expect(anBeteiligte.map((x) => x.to).sort()).toEqual(
      [adressen[0].email, brunoZeile.email].sort(),
    );

    const [nachricht] = await db
      .select()
      .from(dealMessages)
      .where(eq(dealMessages.dealId, dealId));
    expect(nachricht.system).toBe(true);
    expect(nachricht.body).toMatch(/zurückgebucht/);
  });

  it("zählt eine offene Rückbuchung, eine entschiedene nicht mehr", async () => {
    const { intentId } = await abgeschlossen();
    await handleEvent(ereignis("charge.dispute.created", anfechtung(intentId)));

    expect(await offeneRueckbuchungen()).toEqual({ anzahl: 1, summeMinor: 400_000 });
    expect((await betriebsbild()).geld).toMatchObject({
      angefochtenAnzahl: 1,
      angefochtenMinor: 400_000,
    });

    await handleEvent(
      ereignis("charge.dispute.closed", anfechtung(intentId, { status: "won" })),
    );
    expect(await offeneRueckbuchungen()).toEqual({ anzahl: 0, summeMinor: 0 });
  });

  it("behält beim Abschluss den Zeitpunkt der Rückbuchung", async () => {
    const { paymentId, intentId } = await abgeschlossen();
    await handleEvent(ereignis("charge.dispute.created", anfechtung(intentId)));
    const zuerst = (await zahlung(paymentId)).disputedAt;

    await handleEvent(
      ereignis(
        "charge.dispute.closed",
        anfechtung(intentId, {
          status: "lost",
          created: Math.floor(Date.parse("2026-04-01T00:00:00Z") / 1000),
        }),
      ),
    );
    const danach = await zahlung(paymentId);
    expect(danach.disputedAt?.getTime()).toBe(zuerst?.getTime());
    expect(danach.disputeStatus).toBe("lost");
  });

  it("schreibt beim Abschluss keine zweite Runde Post", async () => {
    const { intentId } = await abgeschlossen();
    await handleEvent(ereignis("charge.dispute.created", anfechtung(intentId)));
    briefe.length = 0;

    await handleEvent(ereignis("charge.dispute.closed", anfechtung(intentId, { status: "won" })));
    expect(briefe).toEqual([]);
  });

  it("lässt eine Rückbuchung ohne bekannte Zahlung stillschweigend liegen", async () => {
    await handleEvent(ereignis("charge.dispute.created", anfechtung("pi_unbekannt")));
    expect(briefe).toEqual([]);
  });
});

/**
 * `handleEvent` lässt sich einzeln aufrufen und geht dabei an der Liste
 * vorbei, die der Webhook vorschaltet. Ohne diese Prüfung könnte ein Ereignis
 * sauber verarbeitet und trotzdem verworfen werden, ohne dass es auffällt.
 */
describe("Verarbeitete Ereignisarten", () => {
  it("hält genau die Arten fest, auf die die Anwendung reagiert", () => {
    expect([...HANDLED].sort()).toEqual([
      "account.updated",
      "charge.dispute.closed",
      "charge.dispute.created",
      "charge.refunded",
      "checkout.session.completed",
      "checkout.session.expired",
      "payment_intent.canceled",
      "payment_intent.payment_failed",
    ]);
  });
});
