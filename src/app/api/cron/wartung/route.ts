import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { gibVerwaisteZahlungenFrei, haengendeGelder, raeumeAuf } from "@/lib/wartung";

export const dynamic = "force-dynamic";
/** Der Lauf kann bei vielen Zahlungen dauern — Stripe wird der Reihe nach gefragt. */
export const maxDuration = 60;

/**
 * Wartungslauf, gedacht für einen täglichen Cron (siehe vercel.json).
 *
 * Er gibt Zahlungen frei, die zu einem abgebrochenen Vorgang gehören, räumt
 * abgelaufene Sitzungen und Token weg und meldet, ob Geld auf dem
 * Plattformkonto liegt, das eigentlich jemand anderem gehört.
 *
 * Ohne gültiges Geheimnis passiert nichts. Ist keines gesetzt, läuft der
 * Endpunkt ausserhalb der Produktion trotzdem — sonst liesse er sich lokal
 * nicht ausprobieren.
 */
function darfLaufen(request: Request): boolean {
  const geheim = process.env.CRON_SECRET || process.env.HEALTH_TOKEN;
  if (!geheim) return process.env.NODE_ENV !== "production";

  const header = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!header) return false;

  // Zeitkonstant über die Hashes vergleichen: timingSafeEqual verlangt gleich
  // lange Puffer, und die Länge selbst wäre schon eine Auskunft.
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(geheim).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!darfLaufen(request)) {
    return NextResponse.json({ error: "Nicht berechtigt" }, { status: 401 });
  }

  const begonnen = Date.now();
  try {
    const zahlungen = await gibVerwaisteZahlungenFrei();
    const aufgeraeumt = await raeumeAuf();
    const liegengeblieben = await haengendeGelder();

    if (liegengeblieben.anzahl > 0) {
      console.warn(
        `Wartung: ${liegengeblieben.anzahl} eingezogene Zahlung(en) über ` +
          `${(liegengeblieben.summeMinor / 100).toFixed(2)} CHF sind noch nicht weitergeleitet.`,
      );
    }

    return NextResponse.json({
      status: "ok",
      zahlungen,
      aufgeraeumt,
      liegengeblieben,
      dauerMs: Date.now() - begonnen,
    });
  } catch (err) {
    console.error("Wartungslauf fehlgeschlagen:", err);
    return NextResponse.json({ status: "fehler" }, { status: 500 });
  }
}
