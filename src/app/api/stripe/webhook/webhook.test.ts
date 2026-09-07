import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { dealMessages, deals, payments } from "@/lib/db/schema";
import { createUser, createVehicle, resetDatabase } from "@/test/fixtures";
import { handleEvent } from "./route";

/** Ein Tausch in der Treuhandphase mit reservierter Zahlung. */
async function aufbau(dealStatus: (typeof deals.$inferSelect)["status"] = "treuhand") {
  const a = await createUser("Anna");
  const b = await createUser("Bruno");
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
    status: dealStatus,
    escrowAt: new Date(),
    initiatorConfirmed: true,
    counterpartyConfirmed: true,
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
    status: "autorisiert",
    stripePaymentIntentId: intentId,
    authorizedAt: new Date(),
  });
  return { a, b, dealId, paymentId, intentId };
}

function ereignis(type: string, object: unknown): Stripe.Event {
  return { id: newId("evt"), type, data: { object } } as unknown as Stripe.Event;
}

async function dealRow(id: string) {
  const [row] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  return row;
}

async function paymentRow(id: string) {
  const [row] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  return row;
}

beforeEach(async () => {
  await resetDatabase();
});

describe("checkout.session.completed", () => {
  it("belebt eine stornierte Zahlung nicht wieder", async () => {
    const { dealId, paymentId, intentId } = await aufbau("angenommen");
    await db.update(payments).set({ status: "storniert" }).where(eq(payments.id, paymentId));

    // Spät zugestellt oder erneut versucht: Die Zahlung ist inzwischen tot,
    // und der Tausch darf nicht in die Treuhandphase rutschen.
    await handleEvent(
      ereignis("checkout.session.completed", {
        id: "cs_1",
        payment_intent: intentId,
        metadata: { carswap_payment_id: paymentId, carswap_deal_id: dealId },
      }),
    );

    expect((await paymentRow(paymentId)).status).toBe("storniert");
    expect((await dealRow(dealId)).status).toBe("angenommen");
  });

  it("storniert keine Autorisierung, während der Tausch abgewickelt wird", async () => {
    const { dealId, paymentId, intentId } = await aufbau("abwicklung");
    await db.update(payments).set({ status: "erstellt" }).where(eq(payments.id, paymentId));

    // Ein erneut zugestelltes Ereignis darf dem laufenden Abschluss nicht das
    // Geld unter den Händen wegnehmen.
    await handleEvent(
      ereignis("checkout.session.completed", {
        id: "cs_2",
        payment_intent: intentId,
        metadata: { carswap_payment_id: paymentId, carswap_deal_id: dealId },
      }),
    );

    expect((await paymentRow(paymentId)).status).toBe("autorisiert");
    expect((await dealRow(dealId)).status).toBe("abwicklung");
  });
});

describe("payment_intent.canceled", () => {
  it("nimmt den Tausch aus der Treuhandphase zurück und löscht die Bestätigungen", async () => {
    const { dealId, paymentId, intentId } = await aufbau();
    await handleEvent(
      ereignis("payment_intent.canceled", {
        id: intentId,
        metadata: { carswap_payment_id: paymentId, carswap_deal_id: dealId },
      }),
    );

    const deal = await dealRow(dealId);
    expect(deal.status).toBe("angenommen");
    expect(deal.escrowAt).toBeNull();
    expect(deal.initiatorConfirmed).toBe(false);
    expect(deal.counterpartyConfirmed).toBe(false);
    expect((await paymentRow(paymentId)).status).toBe("storniert");

    const nachrichten = await db
      .select()
      .from(dealMessages)
      .where(eq(dealMessages.dealId, dealId));
    expect(nachrichten.some((m) => m.body.includes("neu eingezahlt"))).toBe(true);
  });

  it("lässt einen Tausch in Abwicklung unangetastet", async () => {
    const { dealId, paymentId, intentId } = await aufbau("abwicklung");
    await handleEvent(
      ereignis("payment_intent.canceled", {
        id: intentId,
        metadata: { carswap_payment_id: paymentId, carswap_deal_id: dealId },
      }),
    );

    const deal = await dealRow(dealId);
    expect(deal.status).toBe("abwicklung");
    expect(deal.initiatorConfirmed).toBe(true);
  });
});

describe("payment_intent.payment_failed", () => {
  it("entwertet eine bereits reservierte Zahlung nicht", async () => {
    const { dealId, paymentId, intentId } = await aufbau();
    await handleEvent(
      ereignis("payment_intent.payment_failed", {
        id: intentId,
        metadata: { carswap_payment_id: paymentId, carswap_deal_id: dealId },
        last_payment_error: { message: "verspätet" },
      }),
    );

    // Die Zahlung steht auf «autorisiert» — ein nachgereichtes Fehlschlag-
    // Ereignis darf daran nichts ändern.
    expect((await paymentRow(paymentId)).status).toBe("autorisiert");
    expect((await dealRow(dealId)).status).toBe("treuhand");
  });
});

describe("charge.refunded", () => {
  it("behandelt eine Teilerstattung nicht als Entwertung", async () => {
    const { dealId, paymentId, intentId } = await aufbau();
    await handleEvent(
      ereignis("charge.refunded", {
        payment_intent: intentId,
        amount: 412_000,
        amount_refunded: 50_000,
      }),
    );

    expect((await paymentRow(paymentId)).status).toBe("autorisiert");
    expect((await dealRow(dealId)).status).toBe("treuhand");
  });

  it("nimmt bei voller Erstattung die Treuhandphase zurück", async () => {
    const { dealId, paymentId, intentId } = await aufbau();
    await handleEvent(
      ereignis("charge.refunded", {
        payment_intent: intentId,
        amount: 412_000,
        amount_refunded: 412_000,
      }),
    );

    expect((await paymentRow(paymentId)).status).toBe("erstattet");
    expect((await dealRow(dealId)).status).toBe("angenommen");
  });

  it("meldet eine Erstattung zu einem abgeschlossenen Tausch als Fall für den Support", async () => {
    const { dealId, paymentId, intentId } = await aufbau("abgeschlossen");
    await handleEvent(
      ereignis("charge.refunded", {
        payment_intent: intentId,
        amount: 412_000,
        amount_refunded: 412_000,
      }),
    );

    expect((await dealRow(dealId)).status).toBe("abgeschlossen");
    const nachrichten = await db
      .select()
      .from(dealMessages)
      .where(eq(dealMessages.dealId, dealId));
    expect(nachrichten.some((m) => m.body.includes("Support"))).toBe(true);
  });

  it("schlägt bei einer Erstattung nach einem Abbruch keinen Alarm", async () => {
    // Genau der erwartete Ablauf: Abbrechen gibt die Reservierung frei, Stripe
    // meldet die Erstattung. Dafür beide Seiten an den Support zu schicken,
    // wäre eine erfundene Katastrophe.
    const { dealId, paymentId, intentId } = await aufbau("storniert");
    await handleEvent(
      ereignis("charge.refunded", {
        payment_intent: intentId,
        amount: 412_000,
        amount_refunded: 412_000,
      }),
    );

    expect((await paymentRow(paymentId)).status).toBe("erstattet");
    const nachrichten = await db
      .select()
      .from(dealMessages)
      .where(eq(dealMessages.dealId, dealId));
    expect(nachrichten.some((m) => m.body.includes("Support"))).toBe(false);
  });

  it("überschreibt eine bereits ausgezahlte Zahlung nicht mit «erstattet»", async () => {
    // Sonst stünde in der Zeile nichts mehr davon, dass das Geld beim
    // Empfänger angekommen war — und beim Abgleich des Plattformkontos wäre
    // eine Erstattung davor von einer danach nicht zu unterscheiden.
    const { paymentId, intentId } = await aufbau("abgeschlossen");
    await db
      .update(payments)
      .set({ status: "ausgezahlt", stripeTransferId: "tr_1" })
      .where(eq(payments.id, paymentId));

    await handleEvent(
      ereignis("charge.refunded", {
        payment_intent: intentId,
        amount: 412_000,
        amount_refunded: 412_000,
      }),
    );

    const zeile = await paymentRow(paymentId);
    expect(zeile.status).toBe("ausgezahlt");
    expect(zeile.lastError).toContain("Erstattung");
  });
});
