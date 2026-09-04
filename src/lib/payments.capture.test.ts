import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { deals, payments, users, vehicles } from "@/lib/db/schema";
import { createUser, createVehicle, resetDatabase } from "@/test/fixtures";

/**
 * Hier läuft die echte captureAndPayout — nur das Stripe-SDK ist ersetzt.
 * Das ist der Unterschied zu deals.test.ts, wo das ganze Zahlungsmodul
 * nachgebaut ist und der Statuswächter deshalb nicht mitgeprüft würde.
 */
const stripeCalls: { capture: unknown[][]; transfer: unknown[][] } = { capture: [], transfer: [] };
let captureStatus = "succeeded";
let transferFehler: Error | null = null;
let payoutsEnabled = true;

vi.mock("stripe", () => {
  class FakeStripe {
    paymentIntents = {
      capture: async (...args: unknown[]) => {
        stripeCalls.capture.push(args);
        return { id: args[0], status: captureStatus };
      },
    };
    transfers = {
      create: async (...args: unknown[]) => {
        stripeCalls.transfer.push(args);
        if (transferFehler) throw transferFehler;
        return { id: `tr_${stripeCalls.transfer.length}` };
      },
    };
    accounts = {
      retrieve: async () => ({ payouts_enabled: payoutsEnabled, charges_enabled: payoutsEnabled }),
    };
  }
  return { default: FakeStripe };
});

const { captureAndPayout, PaymentStateError, PayoutBlockedError } = await import("@/lib/payments");

/** Ein Tausch mit hinterlegter Zahlung im gewünschten Zustand. */
async function aufbau(status: (typeof payments.$inferSelect)["status"], konto = true) {
  const a = await createUser("Anna");
  const b = await createUser("Bruno", {
    stripeAccountId: konto ? "acct_bruno" : undefined,
    stripePayoutsEnabled: false, // wird über die Stripe-Abfrage nachgezogen
  });
  const va = await createVehicle(a);
  const vb = await createVehicle(b);
  const dealId = newId("dl");
  await db.insert(deals).values({
    id: dealId,
    fromVehicleId: va,
    toVehicleId: vb,
    initiatorId: a,
    counterpartyId: b,
    cashDelta: 4000,
    status: "treuhand",
  });
  const paymentId = newId("pay");
  await db.insert(payments).values({
    id: paymentId,
    dealId,
    payerId: a,
    payeeId: b,
    amountMinor: 400_000,
    feeMinor: 12_000,
    status,
    stripePaymentIntentId: `pi_${paymentId}`,
    authorizedAt: new Date(),
  });
  const [row] = await db.select().from(payments).where(eq(payments.id, paymentId));
  return { a, b, va, vb, dealId, payment: row };
}

beforeEach(async () => {
  process.env.STRIPE_SECRET_KEY ??= "sk_test_attrappe";
  await resetDatabase();
  stripeCalls.capture = [];
  stripeCalls.transfer = [];
  captureStatus = "succeeded";
  transferFehler = null;
  payoutsEnabled = true;
});

afterEach(async () => {
  await resetDatabase();
});

describe("captureAndPayout", () => {
  it("zieht ein und überweist den Nettobetrag ohne Gebühr", async () => {
    const { payment, b } = await aufbau("autorisiert");
    const result = await captureAndPayout(payment);

    expect(result.status).toBe("ausgezahlt");
    expect(stripeCalls.capture).toHaveLength(1);
    expect(stripeCalls.transfer).toHaveLength(1);
    const transfer = stripeCalls.transfer[0][0] as { amount: number; destination: string };
    // Überwiesen wird der Betrag für den Empfänger, nicht der belastete Betrag.
    expect(transfer.amount).toBe(400_000);
    expect(transfer.destination).toBe("acct_bruno");
    void b;
  });

  it("wirft bei einer stornierten Zahlung, statt still zurückzukehren", async () => {
    const { payment } = await aufbau("storniert");
    await expect(captureAndPayout(payment)).rejects.toBeInstanceOf(PaymentStateError);
    expect(stripeCalls.capture).toHaveLength(0);
    expect(stripeCalls.transfer).toHaveLength(0);
  });

  it("wirft bei einer erstatteten und bei einer nie bezahlten Zahlung", async () => {
    for (const status of ["erstattet", "fehlgeschlagen", "erstellt"] as const) {
      const { payment } = await aufbau(status);
      await expect(captureAndPayout(payment)).rejects.toBeInstanceOf(PaymentStateError);
      await resetDatabase();
    }
    expect(stripeCalls.capture).toHaveLength(0);
  });

  it("zieht nichts ein, solange das Auszahlungskonto fehlt", async () => {
    payoutsEnabled = false;
    const { payment } = await aufbau("autorisiert");
    await expect(captureAndPayout(payment)).rejects.toBeInstanceOf(PayoutBlockedError);
    // Entscheidend: die Reservierung bleibt stehen und verfällt von selbst,
    // statt dass Geld eingezogen wird, das niemand weiterleiten kann.
    expect(stripeCalls.capture).toHaveLength(0);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("autorisiert");
  });

  it("lässt die Zahlung nach einem gescheiterten Transfer auf «eingezogen» stehen", async () => {
    transferFehler = new Error("Stripe ist gerade nicht erreichbar");
    const { payment } = await aufbau("autorisiert");
    await expect(captureAndPayout(payment)).rejects.toThrow(/nicht erreichbar/);

    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("eingezogen");

    // Der zweite Anlauf darf nicht erneut einziehen, nur noch überweisen.
    transferFehler = null;
    const result = await captureAndPayout(row);
    expect(result.status).toBe("ausgezahlt");
    expect(stripeCalls.capture).toHaveLength(1);
    expect(stripeCalls.transfer).toHaveLength(2);
  });

  it("markiert die Zahlung als fehlgeschlagen, wenn der Einzug nicht greift", async () => {
    captureStatus = "requires_payment_method";
    const { payment } = await aufbau("autorisiert");
    await expect(captureAndPayout(payment)).rejects.toThrow(/nicht eingezogen/);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("fehlgeschlagen");
  });

  it("tut nichts, wenn bereits ausgezahlt wurde", async () => {
    const { payment } = await aufbau("ausgezahlt");
    const result = await captureAndPayout(payment);
    expect(result.status).toBe("ausgezahlt");
    expect(stripeCalls.capture).toHaveLength(0);
    expect(stripeCalls.transfer).toHaveLength(0);
  });

  it("gibt dem Einzug einen Idempotenzschlüssel mit", async () => {
    const { payment } = await aufbau("autorisiert");
    await captureAndPayout(payment);
    expect(stripeCalls.capture[0][2]).toEqual({ idempotencyKey: `capture:${payment.id}` });
    expect(stripeCalls.transfer[0][1]).toEqual({ idempotencyKey: `payout:${payment.id}` });
  });
});

void users;
void vehicles;
