import type { Metadata } from "next";
import Link from "next/link";
import { Card, SectionHead } from "@/components/ui";
import {
  IconAuto,
  IconGespraech,
  IconNicht,
  IconSchluessel,
  IconSuche,
  IconTausch,
  IconTreuhand,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "So funktioniert es",
  alternates: { canonical: "/so-funktionierts" },
};

const STEPS = [
  {
    n: "01",
    Icon: IconAuto,
    t: "Auto einstellen",
    d: "Du trägst Eckdaten, Zustand und Ausstattung ein. Den Wert rechnen wir dabei sofort mit — und zeigen dir, woraus er entsteht.",
  },
  {
    n: "02",
    Icon: IconSuche,
    t: "Sagen, was du suchst",
    d: "Marken, Karosserieform, Antrieb, und wie viel du drauflegen würdest. Danach entscheidet sich, wem wir dein Auto zeigen.",
  },
  {
    n: "03",
    Icon: IconTausch,
    t: "Passenden Tausch finden",
    d: "Wir sortieren nach der Frage, die zählt: wollen beide? Wenn es zu zweit nicht aufgeht, suchen wir eine dritte Person, über die es doch geht.",
  },
  {
    n: "04",
    Icon: IconGespraech,
    t: "Verhandeln",
    d: "Der gerechnete Ausgleich ist ein Vorschlag, kein Preis. Ihr könnt beide bieten, und beide sehen, wie weit ein Gebot davon abweicht.",
  },
  {
    n: "05",
    Icon: IconTreuhand,
    t: "Geld hinterlegen",
    d: "Wer draufzahlt, hinterlegt den Betrag nach der Zusage. Er wird nur reserviert, nicht abgebucht. So geht niemand in Vorleistung.",
  },
  {
    n: "06",
    Icon: IconSchluessel,
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
          <Card
            key={s.n}
            as="li"
            className="group relative overflow-hidden p-5 transition-colors hover:border-line-strong"
          >
            {/*
              Die Nummer war das einzige Farbige an der Karte und stand als
              kleine Ziffer über der Überschrift — sechs Karten sahen dadurch
              alle gleich aus. Jetzt trägt jeder Schritt sein eigenes Symbol
              im Kreis, mit der Nummer daneben: Man erkennt die Karte an der
              Form, bevor man die Zeile liest.
            */}
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-marke/10 text-marke transition-colors group-hover:bg-marke/15">
                <s.Icon />
              </span>
              <span className="text-xs font-semibold tabular text-akzent">{s.n}</span>
            </div>
            <h2 className="mt-3 text-base font-semibold text-ink">{s.t}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{s.d}</p>
          </Card>
        ))}
      </ol>

      <Card className="mt-8 p-6">
        <h2 className="text-base font-semibold text-ink">Was wir nicht machen</h2>
        <ul className="mt-4 space-y-3 text-sm text-ink-2">
          {[
            "Wir prüfen die Autos nicht. Das müsst ihr selbst tun, vor der Übergabe.",
            "Wir stehen nicht dafür ein, dass die Angaben stimmen. Der Wert ist nur so gut wie das, was jemand eingetragen hat.",
            "Wir gehen nicht aufs Strassenverkehrsamt. Halterwechsel und Versicherung macht ihr selbst.",
          ].map((zeile) => (
            <li key={zeile} className="flex gap-2.5">
              <IconNicht className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
              <span>{zeile}</span>
            </li>
          ))}
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
