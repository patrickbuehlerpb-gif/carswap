import { NextResponse } from "next/server";
import { darfLaufen } from "@/lib/cron-auth";
import { verschickeTreffermeldungen } from "@/lib/treffer";

export const dynamic = "force-dynamic";
/** Je Person eine Mail — bei vielen Konten dauert das. */
export const maxDuration = 60;

/**
 * Täglicher Lauf, der neue beidseitige Treffer per Mail meldet (siehe
 * vercel.json). Ohne ihn läuft das Matching nur, solange jemand die
 * Treffer-Seite offen hat — und ein Autotausch ist nichts, wofür man täglich
 * eine Seite aufruft.
 */
export async function GET(request: Request) {
  if (!darfLaufen(request)) {
    return NextResponse.json({ error: "Nicht berechtigt" }, { status: 401 });
  }

  const begonnen = Date.now();
  try {
    const lauf = await verschickeTreffermeldungen();
    return NextResponse.json({ status: "ok", ...lauf, dauerMs: Date.now() - begonnen });
  } catch (err) {
    console.error("Treffermeldungen fehlgeschlagen:", err);
    return NextResponse.json({ status: "fehler" }, { status: 500 });
  }
}
