import { NextResponse } from "next/server";
import { sql as raw } from "drizzle-orm";
import { db } from "@/lib/db";
import { stripeConfigured } from "@/lib/payments";
import { siteUrlConfigured } from "@/lib/mail";
import { operatorComplete } from "@/lib/operator";

export const dynamic = "force-dynamic";

/**
 * Betriebsprüfung für Monitoring und Deployment-Checks.
 *
 * Ohne Berechtigung gibt es nur «läuft» oder «läuft nicht». Welche Dienste
 * eingerichtet sind und woran die Datenbank scheitert, ist eine Auskunft über
 * das Innenleben — die bekommt nur, wer HEALTH_TOKEN kennt. Ist die Variable
 * nicht gesetzt, gibt es die Details ausschliesslich ausserhalb der Produktion.
 */
function darfDetails(request: Request): boolean {
  const token = process.env.HEALTH_TOKEN;
  if (!token) return process.env.NODE_ENV !== "production";
  const header = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const query = new URL(request.url).searchParams.get("token");
  return header === token || query === token;
}

export async function GET(request: Request) {
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
  checks.mailversand =
    process.env.RESEND_API_KEY && process.env.MAIL_FROM ? "konfiguriert" : "nicht konfiguriert";
  checks.basisadresse = siteUrlConfigured() ? "konfiguriert" : "nicht konfiguriert";
  checks.impressum = operatorComplete() ? "vollständig" : "unvollständig";

  const status = healthy ? 200 : 503;
  if (!darfDetails(request)) {
    return NextResponse.json({ status: healthy ? "ok" : "fehler" }, { status });
  }

  return NextResponse.json(
    { status: healthy ? "ok" : "fehler", checks, zeit: new Date().toISOString() },
    { status },
  );
}
