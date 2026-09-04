import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { dealMessages, deals, payments, users, webhookEvents } from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";
import { markPayment, markPaymentIfIn, stripe, stripeConfigured } from "@/lib/payments";
import { sendMail, siteUrl } from "@/lib/mail";

/** Der Rohtext wird für die Signaturprüfung gebraucht, also kein Body-Parsing. */
export const dynamic = "force-dynamic";

/** Ereignisarten, auf die diese Anwendung reagiert. */
const HANDLED = new Set<string>([
  "checkout.session.completed",
  "checkout.session.expired",
  "payment_intent.canceled",
  "payment_intent.payment_failed",
  "charge.refunded",
  "account.updated",
]);

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

  // Nicht behandelte Ereignisarten sofort quittieren, ohne sie zu vermerken.
  // Sonst füllt ein zu breit abonniertes Ziel die Tabelle mit Einträgen, die
  // nie jemand liest.
  if (!HANDLED.has(event.type)) {
    return NextResponse.json({ received: true, ignored: event.type });
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

/** Exportiert, damit die Ereignisbehandlung ohne Signaturprüfung testbar ist. */
export async function handleEvent(event: Stripe.Event): Promise<void> {
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
        authorizedAt: new Date(),
      });

      // Der Betrag ist reserviert — der Tausch geht in die Treuhandphase.
      // Nur aus «angenommen»: wurde zwischenzeitlich abgebrochen, darf die
      // Zahlung den Vorgang nicht wiederbeleben. «treuhand» ist mit erlaubt,
      // damit ein erneut zugestelltes Ereignis nicht als Fehlschlag gilt.
      const moved = await db
        .update(deals)
        .set({ status: "treuhand", escrowAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(deals.id, dealId),
            or(eq(deals.status, "angenommen"), eq(deals.status, "treuhand")),
          ),
        )
        .returning({ id: deals.id });

      if (!moved.length && intentId) {
        // Der Tausch existiert nicht mehr im passenden Zustand — Geld sofort
        // wieder freigeben, statt es hängen zu lassen.
        console.warn(`Zahlung ${paymentId} ohne passenden Tausch — Autorisierung wird storniert.`);
        try {
          await stripe().paymentIntents.cancel(intentId);
          await markPayment(paymentId, "storniert", "Tausch war nicht mehr im Zustand angenommen");
        } catch (err) {
          console.error("Stornierung fehlgeschlagen:", err);
        }
      }
      break;
    }

    case "checkout.session.expired": {
      const paymentId = event.data.object.metadata?.carswap_payment_id;
      if (paymentId) {
        await markPaymentIfIn(paymentId, ["erstellt"], "storniert", "Checkout abgelaufen");
      }
      break;
    }

    case "payment_intent.canceled": {
      const intent = event.data.object;
      const paymentId = intent.metadata?.carswap_payment_id;
      const dealId = intent.metadata?.carswap_deal_id;
      if (paymentId) {
        await markPaymentIfIn(paymentId, ["erstellt", "autorisiert"], "storniert");
      }
      // Eine Reservierung verfällt nach sieben Tagen. Ohne hinterlegtes Geld
      // darf der Tausch nicht in der Treuhandphase stehen bleiben, sonst
      // führt ein späteres Bestätigen der Übergabe ins Leere.
      if (dealId) await reopenEscrow(dealId, "Die Reservierung des Ausgleichs ist verfallen.");
      break;
    }

    case "payment_intent.payment_failed": {
      const intent = event.data.object;
      const paymentId = intent.metadata?.carswap_payment_id;
      if (paymentId) {
        // Nur aus «erstellt»: ein nachgereichtes Fehlschlag-Ereignis darf eine
        // bereits reservierte oder eingezogene Zahlung nicht entwerten.
        await markPaymentIfIn(
          paymentId,
          ["erstellt"],
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
      if (!rows[0]) break;
      // Teilerstattungen ändern den Zustand nicht — nur eine vollständige
      // Rückabwicklung entwertet die Zahlung.
      const voll = charge.amount_refunded >= charge.amount;
      if (!voll) {
        await markPayment(rows[0].id, rows[0].status, `Teilerstattung über ${charge.amount_refunded}`);
        break;
      }
      await markPayment(rows[0].id, "erstattet");
      const zurueck = await reopenEscrow(
        rows[0].dealId,
        "Der hinterlegte Ausgleich wurde erstattet.",
      );
      if (!zurueck) {
        // Der Tausch ist nicht mehr in der Treuhandphase — bei einem bereits
        // abgeschlossenen Tausch ist das Geld zurück, die Fahrzeuge aber
        // umgeschrieben. Das braucht einen Menschen.
        await flagRefundAfterCompletion(rows[0].dealId, rows[0].id);
      }
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
      // Kann nicht eintreten, solange HANDLED und dieses switch übereinstimmen.
      break;
  }
}

/**
 * Nimmt einen Tausch aus der Treuhandphase zurück, wenn das hinterlegte Geld
 * verschwunden ist. Die Bestätigungen werden zurückgesetzt, damit die Übergabe
 * nicht mit einer toten Zahlung abgeschlossen werden kann.
 */
async function reopenEscrow(dealId: string, reason: string): Promise<boolean> {
  const rows = await db
    .update(deals)
    .set({
      status: "angenommen",
      escrowAt: null,
      initiatorConfirmed: false,
      counterpartyConfirmed: false,
      updatedAt: new Date(),
    })
    .where(and(eq(deals.id, dealId), eq(deals.status, "treuhand")))
    .returning({ id: deals.id, initiatorId: deals.initiatorId });
  if (!rows.length) return false;

  await db.insert(dealMessages).values({
    id: newId("msg"),
    dealId,
    authorId: rows[0].initiatorId,
    body: `${reason} Der Ausgleich muss neu eingezahlt werden.`,
    system: true,
  });
  return true;
}

/**
 * Eine Erstattung zu einem Tausch, der die Treuhandphase schon verlassen hat.
 * Das lässt sich nicht automatisch heilen: die Fahrzeuge sind unter Umständen
 * bereits umgeschrieben. Beide Seiten werden informiert, der Vorgang bleibt im
 * Verlauf sichtbar und im Log als Warnung stehen.
 */
async function flagRefundAfterCompletion(dealId: string, paymentId: string): Promise<void> {
  const [row] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!row) return;

  console.warn(
    `Erstattung zu Zahlung ${paymentId} betrifft Tausch ${dealId} im Zustand ${row.status} — Handeingriff nötig.`,
  );
  await db.insert(dealMessages).values({
    id: newId("msg"),
    dealId,
    authorId: row.initiatorId,
    body:
      "Der Ausgleich wurde zurückerstattet, obwohl der Tausch die Treuhandphase bereits " +
      "verlassen hat. Bitte meldet euch beim Support — das muss von Hand geklärt werden.",
    system: true,
  });

  const empfaenger = await db
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.id, [row.initiatorId, row.counterpartyId]));
  for (const person of empfaenger) {
    await sendMail({
      to: person.email,
      subject: "CarSwap: Rückerstattung zu einem abgeschlossenen Tausch",
      text:
        "Zu eurem Tausch wurde der Ausgleich zurückerstattet, obwohl der Vorgang bereits " +
        `abgeschlossen war. Bitte meldet euch beim Support.\n\n${siteUrl()}/deals/${dealId}\n`,
    });
  }
}
