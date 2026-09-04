import "server-only";
import Stripe from "stripe";
import { desc, eq } from "drizzle-orm";
import { db } from "./db";
import { newId } from "./db/ids";
import { payments, users, type DealRow, type PaymentRow } from "./db/schema";
import { siteUrl } from "./mail";

/**
 * Zahlungsfluss: Der Zahlende bezahlt auf das Plattformkonto, der Betrag wird
 * dabei nur autorisiert (`capture_method: manual`). Erst wenn beide Parteien
 * die Übergabe bestätigt haben, wird eingezogen und über Stripe Connect an
 * die Gegenseite weitergeleitet ("separate charges and transfers").
 *
 * Beträge liegen in der Anwendung als ganze Franken vor und werden erst hier
 * in Rappen umgerechnet.
 */

export const CURRENCY = "chf";

/** Autorisierungen verfallen bei Stripe nach sieben Tagen. */
export const AUTHORIZATION_DAYS = 7;

let cached: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY ist nicht gesetzt — Zahlungen sind nicht verfügbar.");
  }
  cached ??= new Stripe(process.env.STRIPE_SECRET_KEY, {
    // Ohne Angabe nimmt das SDK die Version, gegen die es gebaut wurde.
    typescript: true,
    maxNetworkRetries: 2,
  });
  return cached;
}

export function toMinor(chf: number): number {
  return Math.round(chf * 100);
}

/** Wer zahlt an wen? Bei einem Ausgleich von null fliesst kein Geld. */
export function paymentParties(deal: Pick<DealRow, "cashDelta" | "initiatorId" | "counterpartyId">) {
  if (deal.cashDelta === 0) return null;
  return deal.cashDelta > 0
    ? { payerId: deal.initiatorId, payeeId: deal.counterpartyId, amount: deal.cashDelta }
    : { payerId: deal.counterpartyId, payeeId: deal.initiatorId, amount: -deal.cashDelta };
}

/* ------------------------------------------------------------------ */
/* Connect-Onboarding für Auszahlungen                                 */
/* ------------------------------------------------------------------ */

export async function ensureConnectAccount(userId: string, email: string): Promise<string> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) throw new Error("Konto nicht gefunden.");
  if (user.stripeAccountId) return user.stripeAccountId;

  const account = await stripe().accounts.create({
    type: "express",
    country: "CH",
    email,
    business_type: "individual",
    capabilities: { transfers: { requested: true } },
    metadata: { carswap_user_id: userId },
  });

  await db
    .update(users)
    .set({ stripeAccountId: account.id, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return account.id;
}

export async function connectOnboardingUrl(accountId: string): Promise<string> {
  const link = await stripe().accountLinks.create({
    account: accountId,
    refresh_url: `${siteUrl()}/konto?stripe=erneut`,
    return_url: `${siteUrl()}/konto?stripe=fertig`,
    type: "account_onboarding",
  });
  return link.url;
}

/** Fragt bei Stripe nach, ob Auszahlungen freigeschaltet sind. */
export async function refreshPayoutStatus(userId: string): Promise<boolean> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user?.stripeAccountId) return false;

  const account = await stripe().accounts.retrieve(user.stripeAccountId);
  const enabled = Boolean(account.payouts_enabled && account.charges_enabled);
  if (enabled !== user.stripePayoutsEnabled) {
    await db
      .update(users)
      .set({ stripePayoutsEnabled: enabled, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }
  return enabled;
}

/* ------------------------------------------------------------------ */
/* Treuhand                                                            */
/* ------------------------------------------------------------------ */

export interface EscrowCheckout {
  url: string;
  paymentId: string;
}

/**
 * Legt die Checkout-Session für die Ausgleichszahlung an. Der Betrag wird
 * reserviert, nicht eingezogen.
 */
export async function createEscrowCheckout(
  deal: DealRow,
  description: string,
): Promise<EscrowCheckout> {
  const parties = paymentParties(deal);
  if (!parties) throw new Error("Für diesen Tausch ist keine Ausgleichszahlung nötig.");

  const s = stripe();

  // Bereits angelegte Zahlungen zu diesem Tausch prüfen: eine noch offene
  // Session wird wiederverwendet, eine abgelaufene entwertet. Ohne das würde
  // der Idempotenzschlüssel unten eine tote Session zurückgeben.
  const existing = await db
    .select()
    .from(payments)
    .where(eq(payments.dealId, deal.id))
    .orderBy(desc(payments.createdAt));

  for (const row of existing) {
    if (row.status === "autorisiert" || row.status === "eingezogen" || row.status === "ausgezahlt") {
      throw new Error("Für diesen Tausch ist bereits ein Betrag hinterlegt.");
    }
    if (row.status === "erstellt" && row.stripeSessionId) {
      const session = await s.checkout.sessions.retrieve(row.stripeSessionId);
      if (session.status === "open" && session.url) {
        return { url: session.url, paymentId: row.id };
      }
      await markPayment(row.id, "storniert", "Checkout-Session nicht mehr offen");
    }
  }

  const paymentId = newId("pay");
  const amountMinor = toMinor(parties.amount);
  // Der Versuchszähler hält den Idempotenzschlüssel eindeutig, wenn ein
  // früherer Anlauf abgelaufen ist.
  const attempt = existing.length + 1;

  const session = await s.checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: deal.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: amountMinor,
            product_data: {
              name: "CarSwap Treuhand-Einzahlung",
              description,
            },
          },
        },
      ],
      payment_intent_data: {
        capture_method: "manual",
        transfer_group: deal.id,
        description: `CarSwap Tausch ${deal.id}`,
        metadata: { carswap_deal_id: deal.id, carswap_payment_id: paymentId },
      },
      metadata: { carswap_deal_id: deal.id, carswap_payment_id: paymentId },
      success_url: `${siteUrl()}/deals/${deal.id}?treuhand=ok`,
      cancel_url: `${siteUrl()}/deals/${deal.id}?treuhand=abgebrochen`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    },
    // Idempotenz: ein erneuter Klick erzeugt keine zweite Session
    { idempotencyKey: `escrow:${deal.id}:${deal.cashDelta}:${attempt}` },
  );

  await db.insert(payments).values({
    id: paymentId,
    dealId: deal.id,
    payerId: parties.payerId,
    payeeId: parties.payeeId,
    amountMinor,
    currency: CURRENCY,
    status: "erstellt",
    stripeSessionId: session.id,
  });

  if (!session.url) throw new Error("Stripe hat keine Checkout-URL geliefert.");
  return { url: session.url, paymentId };
}

/**
 * Zieht den reservierten Betrag ein und leitet ihn an die Gegenseite weiter.
 * Beide Schritte sind idempotent über den Zahlungsstatus abgesichert.
 */
export async function captureAndPayout(payment: PaymentRow): Promise<PaymentRow> {
  const s = stripe();

  if (payment.status === "ausgezahlt") return payment;
  if (!payment.stripePaymentIntentId) {
    throw new Error("Zu dieser Zahlung ist keine Stripe-Transaktion hinterlegt.");
  }

  // 1) Einziehen
  if (payment.status === "autorisiert") {
    const intent = await s.paymentIntents.capture(payment.stripePaymentIntentId);
    if (intent.status !== "succeeded") {
      await markPayment(payment.id, "fehlgeschlagen", `Capture-Status ${intent.status}`);
      throw new Error("Der Betrag konnte nicht eingezogen werden.");
    }
    payment = await markPayment(payment.id, "eingezogen");
  }

  // 2) Weiterleiten
  if (payment.status === "eingezogen") {
    const payeeRows = await db.select().from(users).where(eq(users.id, payment.payeeId)).limit(1);
    const payee = payeeRows[0];
    if (!payee?.stripeAccountId || !payee.stripePayoutsEnabled) {
      // Das Geld liegt sicher auf dem Plattformkonto — die Auszahlung folgt,
      // sobald die Gegenseite ihr Auszahlungskonto eingerichtet hat.
      return payment;
    }
    const transfer = await s.transfers.create(
      {
        amount: payment.amountMinor,
        currency: payment.currency,
        destination: payee.stripeAccountId,
        transfer_group: payment.dealId,
        metadata: { carswap_payment_id: payment.id, carswap_deal_id: payment.dealId },
      },
      { idempotencyKey: `payout:${payment.id}` },
    );
    payment = await markPayment(payment.id, "ausgezahlt", null, { stripeTransferId: transfer.id });
  }

  return payment;
}

/** Gibt eine reservierte, aber nicht eingezogene Zahlung wieder frei. */
export async function releaseAuthorization(payment: PaymentRow): Promise<void> {
  if (!payment.stripePaymentIntentId) return;
  if (payment.status === "autorisiert") {
    await stripe().paymentIntents.cancel(payment.stripePaymentIntentId);
    await markPayment(payment.id, "storniert");
  } else if (payment.status === "eingezogen") {
    await stripe().refunds.create(
      { payment_intent: payment.stripePaymentIntentId },
      { idempotencyKey: `refund:${payment.id}` },
    );
    await markPayment(payment.id, "erstattet");
  }
}

export async function markPayment(
  id: string,
  status: PaymentRow["status"],
  lastError: string | null = null,
  extra: Partial<PaymentRow> = {},
): Promise<PaymentRow> {
  const rows = await db
    .update(payments)
    .set({ status, lastError, updatedAt: new Date(), ...extra })
    .where(eq(payments.id, id))
    .returning();
  return rows[0];
}
