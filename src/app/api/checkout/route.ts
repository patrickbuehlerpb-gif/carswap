import { NextResponse } from "next/server";

/**
 * Legt eine Stripe-Checkout-Session für die Treuhand-Einzahlung an.
 *
 * Ohne konfigurierten `STRIPE_SECRET_KEY` antwortet die Route im Demo-Modus:
 * Der Client simuliert die Einzahlung dann lokal, damit der Ablauf auch ohne
 * Stripe-Konto vollständig durchgespielt werden kann.
 */
export async function POST(request: Request) {
  let body: { dealId?: string; amount?: number; label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger Request-Body" }, { status: 400 });
  }

  const { dealId, amount, label } = body;
  if (!dealId || typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "dealId und ein positiver amount sind erforderlich" },
      { status: 400 },
    );
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json({
      mode: "demo",
      message: "Kein STRIPE_SECRET_KEY gesetzt — Treuhand wird lokal simuliert.",
    });
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    request.headers.get("origin") ??
    new URL(request.url).origin;

  // Beträge gehen in der kleinsten Währungseinheit an Stripe.
  const params = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "chf",
    "line_items[0][price_data][unit_amount]": String(Math.round(amount * 100)),
    "line_items[0][price_data][product_data][name]": label ?? "CarSwap Treuhand-Einzahlung",
    "line_items[0][price_data][product_data][description]":
      "Ausgleichszahlung, wird nach beidseitiger Übergabebestätigung freigegeben.",
    "metadata[deal_id]": dealId,
    // Die Einzahlung wird manuell freigegeben — das ist die Treuhandfunktion.
    "payment_intent_data[capture_method]": "manual",
    success_url: `${origin}/deals/${dealId}?escrow=ok`,
    cancel_url: `${origin}/deals/${dealId}?escrow=abgebrochen`,
  });

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("Stripe-Fehler:", detail);
    return NextResponse.json(
      { error: "Stripe hat die Session abgelehnt." },
      { status: 502 },
    );
  }

  const session = (await res.json()) as { url?: string; id?: string };
  return NextResponse.json({ mode: "live", url: session.url, sessionId: session.id });
}
