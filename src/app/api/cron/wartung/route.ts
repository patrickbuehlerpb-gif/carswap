import { NextResponse } from "next/server";
import { darfLaufen } from "@/lib/cron-auth";
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
 * Wer ihn auslösen darf, entscheidet lib/cron-auth.
 */

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
