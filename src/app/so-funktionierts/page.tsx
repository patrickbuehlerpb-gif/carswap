import type { Metadata } from "next";
import Link from "next/link";
import { Card, SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "So funktioniert es" };

const STEPS = [
  {
    n: "01",
    t: "Fahrzeug einstellen",
    d: "Eckdaten, Zustand und Ausstattung eintragen. Die Bewertung entsteht live aus Restwertkurve, Laufleistung, Zustand und Marktlage — du siehst sofort, worauf sie beruht.",
  },
  {
    n: "02",
    t: "Wunschliste definieren",
    d: "Marken, Karosserieform, Antrieb und dein finanzieller Rahmen. Daran entscheidet sich, wem wir dein Fahrzeug zeigen.",
  },
  {
    n: "03",
    t: "Match finden",
    d: "Wir sortieren nach der Frage, die zählt: Wollen beide? Passt es direkt nicht, suchen wir Dreiertausche, bei denen sich die Wünsche über eine dritte Partei auflösen.",
  },
  {
    n: "04",
    t: "Verhandeln",
    d: "Der berechnete Ausgleich ist der Startpunkt, nicht das Ergebnis. Beide Seiten sehen, um wie viel ein Angebot davon abweicht.",
  },
  {
    n: "05",
    t: "Treuhand",
    d: "Nach der Zusage wird der Ausgleich über Stripe reserviert — belastet wird erst nach der Übergabe. Damit geht niemand in Vorleistung.",
  },
  {
    n: "06",
    t: "Übergabe",
    d: "Checkliste abarbeiten, beide bestätigen. Danach wird der Betrag ausgezahlt und die Fahrzeuge wechseln in euren Garagen den Besitzer.",
  },
];

export default function SoFunktioniertsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      <SectionHead
        title="So funktioniert ein Tausch"
        sub="Von der ersten Eingabe bis zum Halterwechsel — sechs Schritte, keine Händlermarge."
      />
      <ol className="grid gap-4 sm:grid-cols-2">
        {STEPS.map((s) => (
          <Card key={s.n} as="li" className="p-5">
            <span className="text-xs font-semibold tabular text-marke">{s.n}</span>
            <h2 className="mt-2 text-base font-semibold text-ink">{s.t}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-3">{s.d}</p>
          </Card>
        ))}
      </ol>

      <Card className="mt-8 p-6">
        <h2 className="text-base font-semibold text-ink">Was CarSwap nicht macht</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-2">
          <li>· Fahrzeuge prüfen oder begutachten — das bleibt Sache der beiden Parteien.</li>
          <li>· Für die Richtigkeit der Angaben einstehen. Die Bewertung ist nur so gut wie das, was eingetragen wurde.</li>
          <li>· Behördengänge übernehmen. Halterwechsel und Versicherung erledigt ihr selbst.</li>
        </ul>
        <Link
          href="/konto/registrieren"
          className="mt-5 inline-block rounded-lg bg-marke px-5 py-2.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
        >
          Konto erstellen
        </Link>
      </Card>
    </div>
  );
}
