import { NextResponse } from "next/server";
import { sql as raw } from "drizzle-orm";
import { db } from "@/lib/db";
import { stripeConfigured } from "@/lib/payments";

export const dynamic = "force-dynamic";

/** Betriebsprüfung für Monitoring und Deployment-Checks. */
export async function GET() {
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    await db.execute(raw`select 1`);
    checks.datenbank = "ok";
  } catch (err) {
    healthy = false;
    checks.datenbank = err instanceof Error ? err.message.slice(0, 200) : "Fehler";
  }

  checks.zahlungen = stripeConfigured() ? "konfiguriert" : "nicht konfiguriert";
  checks.webhook = process.env.STRIPE_WEBHOOK_SECRET ? "konfiguriert" : "nicht konfiguriert";
  checks.fotospeicher = process.env.BLOB_READ_WRITE_TOKEN ? "konfiguriert" : "nicht konfiguriert";
  checks.mailversand = process.env.RESEND_API_KEY ? "konfiguriert" : "nicht konfiguriert";

  return NextResponse.json(
    { status: healthy ? "ok" : "fehler", checks, zeit: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
