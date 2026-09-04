import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deals, payments, users, webhookEvents } from "@/lib/db/schema";
import { markPayment, stripe, stripeConfigured } from "@/lib/payments";

/** Der Rohtext wird für die Signaturprüfung gebraucht, also kein Body-Parsing. */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!stripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Webhook nicht konfiguriert" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Signatur fehlt" }, { status: 400 });
  }

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook-Signatur ungültig:", err);
    return NextResponse.json({ error: "Signatur ungültig" }, { status: 400 });
  }

  // Stripe liefert Ereignisse mindestens einmal — Duplikate hier abfangen.
  const inserted = await db
    .insert(webhookEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (!inserted.length) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    console.error(`Webhook ${event.type} fehlgeschlagen:`, err);
    // Eintrag wieder entfernen, damit Stripe den erneuten Versuch verarbeiten kann
    await db.delete(webhookEvents).where(eq(webhookEvents.id, event.id));
    return NextResponse.json({ error: "Verarbeitung fehlgeschlagen" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const paymentId = session.metadata?.carswap_payment_id;
      const dealId = session.metadata?.carswap_deal_id;
      if (!paymentId || !dealId) return;

      const intentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;

      await markPayment(paymentId, "autorisiert", null, {
        stripePaymentIntentId: intentId ?? null,
      });

      // Der Betrag ist reserviert — der Tausch geht in die Treuhandphase.
      await db
        .update(deals)
        .set({ status: "treuhand", escrowAt: new Date(), updatedAt: new Date() })
        .where(eq(deals.id, dealId));
      break;
    }

    case "checkout.session.expired": {
      const paymentId = event.data.object.metadata?.carswap_payment_id;
      if (paymentId) await markPayment(paymentId, "storniert", "Checkout abgelaufen");
      break;
    }

    case "payment_intent.canceled": {
      const intent = event.data.object;
      const paymentId = intent.metadata?.carswap_payment_id;
      if (paymentId) await markPayment(paymentId, "storniert");
      break;
    }

    case "payment_intent.payment_failed": {
      const intent = event.data.object;
      const paymentId = intent.metadata?.carswap_payment_id;
      if (paymentId) {
        await markPayment(
          paymentId,
          "fehlgeschlagen",
          intent.last_payment_error?.message ?? "Zahlung fehlgeschlagen",
        );
      }
      break;
    }

    case "charge.refunded": {
      const charge = event.data.object;
      const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
      if (!intentId) return;
      const rows = await db
        .select()
        .from(payments)
        .where(eq(payments.stripePaymentIntentId, intentId))
        .limit(1);
      if (rows[0]) await markPayment(rows[0].id, "erstattet");
      break;
    }

    /** Auszahlungsfreigabe der Gegenseite hat sich geändert. */
    case "account.updated": {
      const account = event.data.object;
      const userId = account.metadata?.carswap_user_id;
      if (!userId) return;
      await db
        .update(users)
        .set({
          stripePayoutsEnabled: Boolean(account.payouts_enabled && account.charges_enabled),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      break;
    }

    default:
      // Alles andere interessiert uns nicht — trotzdem mit 200 quittieren.
      break;
  }
}
