import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { sql as raw } from "drizzle-orm";
import { db } from "@/lib/db";
import { stripeConfigured } from "@/lib/payments";
import { siteUrlConfigured } from "@/lib/mail";
import { missingOperatorFields } from "@/lib/operator";
import { haengendeGelder, mailFehler, offeneRueckbuchungen } from "@/lib/wartung";

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

  // Nur über den Header: ein Geheimnis in der Adresszeile landet in
  // Zugriffsprotokollen, in der Browser-Historie und im Referrer.
  const header = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!header) return false;

  // Zeitkonstant vergleichen. Über die Hashes, weil timingSafeEqual gleich
  // lange Puffer verlangt und die Länge sonst selbst etwas verriete.
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
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
  const fehlendeAngaben = missingOperatorFields();
  checks.impressum = fehlendeAngaben.length
    ? `unvollständig (${fehlendeAngaben.join(", ")})`
    : "vollständig";
  // Ein Geheimnis für beide täglichen Läufe — Wartung und Treffermeldungen.
  checks.hintergrundlaeufe = process.env.CRON_SECRET || process.env.HEALTH_TOKEN
    ? "konfiguriert"
    : "nicht konfiguriert";

  // Eingezogenes Geld, das noch nicht beim Empfänger ist, liegt auf dem
  // Plattformkonto und gehört jemand anderem. Das muss die Betreiberin sehen,
  // ohne in die Datenbank zu schauen.
  try {
    const liegengeblieben = await haengendeGelder();
    checks.liegengebliebenesGeld = liegengeblieben.anzahl
      ? `${liegengeblieben.anzahl} Zahlung(en) über ${(liegengeblieben.summeMinor / 100).toFixed(2)} CHF`
      : "keines";
  } catch {
    checks.liegengebliebenesGeld = "nicht ermittelbar";
  }

  // Konfiguriert heisst nicht zugestellt. Ein zurückgezogener Schlüssel oder
  // eine nicht mehr verifizierte Absenderdomain bricht die Registrierung nicht
  // sichtbar ab — es kommt bloss nie eine Bestätigung an. Deshalb steht hier
  // nicht nur, ob der Versand eingerichtet ist, sondern ob er funktioniert.
  //
  // Auf «fehler» geht die Prüfung erst bei einem Muster: drei Fehlversuche
  // innerhalb einer Stunde. Ein einzelner kann eine falsch getippte Adresse
  // sein, und dafür soll niemand um drei Uhr nachts geweckt werden. Gemeldet
  // wird trotzdem jeder — nur eben als Angabe, nicht als Alarm.
  try {
    const fehler = await mailFehler(24);
    if (fehler.anzahl > 0) {
      checks.mailversand =
        `${checks.mailversand}, aber ${fehler.anzahl} Fehlversuch(e) in 24 h ` +
        `(zuletzt: ${fehler.letzterGrund}; ${fehler.domains.join(", ")})`;
      if (fehler.letzteStunde >= 3) healthy = false;
    }
  } catch {
    checks.mailfehler = "nicht ermittelbar";
  }

  // Eine offene Rückbuchung hat Stripe bereits vom Plattformkonto abgezogen.
  // Ohne fristgerechte Stellungnahme bleibt der Betrag weg — das muss die
  // Betreiberin sehen, ohne auf eine Mail zu warten.
  try {
    const angefochten = await offeneRueckbuchungen();
    checks.rueckbuchungen = angefochten.anzahl
      ? `${angefochten.anzahl} offen über ${(angefochten.summeMinor / 100).toFixed(2)} CHF`
      : "keine";
  } catch {
    checks.rueckbuchungen = "nicht ermittelbar";
  }

  const status = healthy ? 200 : 503;
  if (!darfDetails(request)) {
    return NextResponse.json({ status: healthy ? "ok" : "fehler" }, { status });
  }

  return NextResponse.json(
    { status: healthy ? "ok" : "fehler", checks, zeit: new Date().toISOString() },
    { status },
  );
}
