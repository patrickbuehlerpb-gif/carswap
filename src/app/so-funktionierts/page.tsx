import type { Metadata } from "next";
import Link from "next/link";
import { Card, SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "So funktioniert es" };

const STEPS = [
  {
    n: "01",
    t: "Auto einstellen",
    d: "Du trägst Eckdaten, Zustand und Ausstattung ein. Den Wert rechnen wir dabei sofort mit — und zeigen dir, woraus er entsteht.",
  },
  {
    n: "02",
    t: "Sagen, was du suchst",
    d: "Marken, Karosserieform, Antrieb, und wie viel du drauflegen würdest. Danach entscheidet sich, wem wir dein Auto zeigen.",
  },
  {
    n: "03",
    t: "Passenden Tausch finden",
    d: "Wir sortieren nach der Frage, die zählt: wollen beide? Wenn es zu zweit nicht aufgeht, suchen wir eine dritte Person, über die es doch geht.",
  },
  {
    n: "04",
    t: "Verhandeln",
    d: "Der gerechnete Ausgleich ist ein Vorschlag, kein Preis. Ihr könnt beide bieten, und beide sehen, wie weit ein Gebot davon abweicht.",
  },
  {
    n: "05",
    t: "Geld hinterlegen",
    d: "Wer draufzahlt, hinterlegt den Betrag nach der Zusage. Er wird nur reserviert, nicht abgebucht. So geht niemand in Vorleistung.",
  },
  {
    n: "06",
    t: "Übergeben",
    d: "Ihr geht die Checkliste durch und bestätigt beide. Dann zahlen wir das Geld aus, und die Autos wechseln in euren Garagen den Besitzer.",
  },
];

export default function SoFunktioniertsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      <SectionHead
        title="So funktioniert ein Tausch"
        sub="Sechs Schritte von der ersten Eingabe bis zum Halterwechsel. Ohne Händler dazwischen."
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
        <h2 className="text-base font-semibold text-ink">Was wir nicht machen</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-2">
          <li>· Wir prüfen die Autos nicht. Das müsst ihr selbst tun, vor der Übergabe.</li>
          <li>· Wir stehen nicht dafür ein, dass die Angaben stimmen. Der Wert ist nur so gut wie das, was jemand eingetragen hat.</li>
          <li>· Wir gehen nicht aufs Strassenverkehrsamt. Halterwechsel und Versicherung macht ihr selbst.</li>
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
