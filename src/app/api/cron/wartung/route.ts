import { NextResponse } from "next/server";
import { darfLaufen } from "@/lib/cron-auth";
import {
  gibVerwaisteZahlungenFrei,
  haengendeGelder,
  holeAbschluesseNach,
  raeumeAuf,
} from "@/lib/wartung";
import { erstelleLagebericht } from "@/lib/lagebericht";

export const dynamic = "force-dynamic";
/** Der Lauf kann bei vielen Zahlungen dauern — Stripe wird der Reihe nach gefragt. */
export const maxDuration = 60;

/**
 * Wartungslauf, gedacht für einen täglichen Cron (siehe vercel.json).
 *
 * Er holt steckengebliebene Abschlüsse nach, gibt Zahlungen frei, die zu einem
 * abgebrochenen Vorgang gehören, räumt abgelaufene Sitzungen und Token weg,
 * meldet, ob danach noch Geld auf dem Plattformkonto liegt, das eigentlich
 * jemand anderem gehört — und schickt der Betreiberin einen Lagebericht, falls
 * etwas zu tun ist.
 *
 * Wer ihn auslösen darf, entscheidet lib/cron-auth.
 */

export async function GET(request: Request) {
  if (!darfLaufen(request)) {
    return NextResponse.json({ error: "Nicht berechtigt" }, { status: 401 });
  }

  const begonnen = Date.now();
  try {
    // Zuerst nachholen, dann messen: sonst meldet der Lauf Geld als
    // liegengeblieben, das er gerade selbst weitergeleitet hat.
    const abschluesse = await holeAbschluesseNach();
    const zahlungen = await gibVerwaisteZahlungenFrei();
    const aufgeraeumt = await raeumeAuf();
    const liegengeblieben = await haengendeGelder();

    // Ganz zum Schluss, damit der Bericht den Stand nach dem Aufräumen zeigt
    // und nicht den davor. Verschickt wird nur, wenn etwas zu tun ist.
    const lagebericht = await erstelleLagebericht(abschluesse);

    if (liegengeblieben.anzahl > 0) {
      console.warn(
        `Wartung: ${liegengeblieben.anzahl} eingezogene Zahlung(en) über ` +
          `${(liegengeblieben.summeMinor / 100).toFixed(2)} CHF sind noch nicht weitergeleitet.`,
      );
    }

    return NextResponse.json({
      status: "ok",
      abschluesse,
      zahlungen,
      aufgeraeumt,
      liegengeblieben,
      lagebericht: {
        punkte: lagebericht.punkte.map((p) => p.kurz),
        verschickt: lagebericht.verschickt,
        grund: lagebericht.grund,
      },
      dauerMs: Date.now() - begonnen,
    });
  } catch (err) {
    console.error("Wartungslauf fehlgeschlagen:", err);
    return NextResponse.json({ status: "fehler" }, { status: 500 });
  }
}
