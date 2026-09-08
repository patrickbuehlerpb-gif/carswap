import type { Metadata } from "next";
import Link from "next/link";
import { Card, SectionHead } from "@/components/ui";
import { IconAuto, IconTausch, IconWert } from "@/components/icons";
import { Wertkurve } from "@/components/wertkurve";
import { chf, group } from "@/lib/format";
import { MODELL, retention } from "@/lib/valuation";

export const metadata: Metadata = {
  title: "Wertverlust beim Auto — wie er verläuft und woran er hängt",
  description:
    "Der grösste Posten am Auto steht auf keiner Rechnung. Wie schnell ein Auto an Wert verliert, wann die Kurve flacher wird und woran es sonst noch hängt.",
  alternates: { canonical: "/wertverlust" },
};

/**
 * Eine Erklärseite, kein Werbetext.
 *
 * Jede Zahl hier kommt aus demselben Modell, mit dem der Wertrechner rechnet —
 * nachgeschriebene Zahlen wären nach der ersten Änderung falsch. Was wir nicht
 * wissen, steht als «wissen wir nicht» da: erfundene Reparaturkosten oder
 * behauptete Händlermargen würden die Seite bequemer machen und unbrauchbar.
 */

/** Ohne Markenfaktor — die Kurve soll das Segment zeigen, nicht ein Fabrikat. */
const NEUTRAL = "—";
const pct = (anteil: number) => `${Math.round(anteil * 100)} %`;
/** Für Werte unter einem Prozentpunkt, die gerundet verschwinden würden. */
const pctGenau = (anteil: number) =>
  `${String(Math.round(anteil * 1000) / 10).replace(".", ",")} %`;
/** Franken je Kilometer sind Rappenbeträge — als Franken gerundet stünde dort «CHF 0». */
const rappen = (franken: number) => String(Math.round(franken * 100 * 10) / 10).replace(".", ",");

const benzin1 = retention(1, "benzin", NEUTRAL);
const benzin3 = retention(3, "benzin", NEUTRAL);
const benzin4 = retention(4, "benzin", NEUTRAL);
const benzin12 = retention(12, "benzin", NEUTRAL);
const elektro3 = retention(3, "elektro", NEUTRAL);

/** Ein Auto zum Mitrechnen. Runde Zahl, damit die Rechnung im Kopf aufgeht. */
const BEISPIEL_NEUPREIS = 45_000;

const ABSCHNITTE = [
  {
    zeit: "Jahr 0 bis 3",
    titel: "Hier zahlt man den Neuwagen",
    text:
      "Ein Auto verliert am meisten Wert, während es am wenigsten kaputt ist. Wer neu kauft und " +
      "nach drei Jahren wechselt, hat kaum für Verschleiss bezahlt und fast alles für Wertverlust.",
  },
  {
    zeit: "Jahr 3 bis 8",
    titel: "Die günstigste Strecke",
    text:
      "Die Kurve wird flach. Das Auto ist technisch noch aktuell, der Wertverlust pro Jahr " +
      "kleiner als in jedem Jahr davor. Wer hier kauft und hier wieder abgibt, zahlt am " +
      "wenigsten pro gefahrenem Kilometer.",
  },
  {
    zeit: "Ab Jahr 8",
    titel: "Jetzt entscheidet die Werkstatt",
    text:
      "Vom Neupreis ist wenig übrig, und der Restwert fällt kaum noch. Was das Auto ab hier " +
      "kostet, hängt nicht mehr an der Kurve, sondern daran, was kaputtgeht — eine grössere " +
      "Reparatur kann mehr sein, als das Auto noch wert ist.",
  },
];

export default function WertverlustPage() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-8">
        <h1 className="text-2xl display text-ink sm:text-3xl">
          Was ein Auto an Wert verliert
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">
          Benzin, Versicherung und Service kann man nachzählen. Der grösste Posten steht auf
          keiner Rechnung: der Wert, der still verschwindet. Er fällt erst auf, wenn man verkauft
          — und dann auf einmal.
        </p>
      </header>

      {/* ---- Die Kurve ---- */}
      <Card className="p-5 sm:p-7">
        <h2 className="text-lg display text-ink">So verläuft es</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-3">
          Wie viel vom Neupreis nach wie vielen Jahren noch übrig ist.
        </p>
        <div className="mt-5">
          <Wertkurve />
        </div>
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Kennzahl
          wert={`−${pct(MODELL.zulassungsverlust)}`}
          titel="am ersten Tag"
          text="Sobald ein Auto eingelöst ist, ist es ein Gebrauchtwagen. Diesen Sprung macht es, bevor der erste Kilometer gefahren ist."
        />
        <Kennzahl
          wert={pct(benzin3)}
          titel="nach drei Jahren"
          text={`Rund die Hälfte, beim Benziner. Ein Elektroauto steht im Modell zur gleichen Zeit bei ${pct(elektro3)}.`}
        />
        <Kennzahl
          wert={pct(1 - benzin1)}
          titel="allein im ersten Jahr"
          text={`Mehr als die neun Jahre danach zusammen — von Jahr 4 bis Jahr 12 kommen nur noch ${pct(benzin4 - benzin12)} dazu.`}
        />
      </div>

      {/* ---- Die drei Abschnitte ---- */}
      <div className="mt-12">
        <SectionHead
          title="Drei Abschnitte, drei verschiedene Rechnungen"
          sub="Dieselbe Kurve, aber die Frage, die man sich stellen sollte, ändert sich unterwegs."
        />
        <div className="grid gap-4 sm:grid-cols-3">
          {ABSCHNITTE.map((a) => (
            <Card key={a.zeit} className="p-5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-akzent">
                {a.zeit}
              </p>
              <h3 className="mt-2 text-base font-semibold text-ink">{a.titel}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{a.text}</p>
            </Card>
          ))}
        </div>

        <Card className="mt-4 p-5">
          <p className="text-sm leading-relaxed text-ink-2">
            <span className="font-semibold text-ink">Was hier fehlt, und warum:</span> Zur
            Wertkurve gehört eigentlich eine zweite — die der Reparaturkosten, die mit dem Alter
            steigen. Wir zeichnen sie nicht. Belastbare Schweizer Zahlen dazu haben wir nicht, und
            eine erfundene Kurve sähe genauso überzeugend aus wie eine richtige. Wer eine sucht:
            der TCS veröffentlicht Kilometerkosten für viele Modelle.
          </p>
        </Card>
      </div>

      {/* ---- Beispiel ---- */}
      <div className="mt-12">
        <SectionHead
          title={`Ein Auto zu ${chf(BEISPIEL_NEUPREIS)}, durchgerechnet`}
          sub="Dieselbe Rechnung wie im Wertrechner, ohne Markenzuschlag und mit durchschnittlicher Laufleistung."
        />
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[440px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-3">
                  <th scope="col" className="px-4 py-3 font-medium">Alter</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Benziner</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Elektro</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Verlust im Jahr</th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3, 5, 8, 12].map((jahr) => {
                  const b = retention(jahr, "benzin", NEUTRAL);
                  const vorher = jahr === 0 ? 1 : retention(jahr - 1, "benzin", NEUTRAL);
                  return (
                    <tr key={jahr} className="border-b border-line last:border-0">
                      <th scope="row" className="px-4 py-2.5 text-left font-normal text-ink-2">
                        {jahr === 0 ? "fabrikneu" : jahr === 1 ? "1 Jahr" : `${jahr} Jahre`}
                      </th>
                      <td className="px-4 py-2.5 text-right tabular text-ink">
                        {chf(Math.round((jahr === 0 ? 1 : b) * BEISPIEL_NEUPREIS))}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular text-ink-2">
                        {chf(
                          Math.round(
                            (jahr === 0 ? 1 : retention(jahr, "elektro", NEUTRAL)) *
                              BEISPIEL_NEUPREIS,
                          ),
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular text-ink-3">
                        {jahr === 0
                          ? "—"
                          : `− ${chf(Math.round((vorher - b) * BEISPIEL_NEUPREIS))}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="mt-2 text-xs text-ink-3">
          Die letzte Spalte ist der Verlust im genannten Jahr allein — auch dort, wo die Zeilen
          mehrere Jahre überspringen.
        </p>
      </div>

      {/* ---- Woran es hängt ---- */}
      <div className="mt-12">
        <SectionHead
          title="Woran es sonst noch hängt"
          sub="Die Posten, mit denen unser Rechner arbeitet — und wie stark jeder zieht."
        />
        <Card className="divide-y divide-line">
          <Posten
            titel="Der Antrieb"
            wirkung="am stärksten nach dem Alter"
            text={`Im Modell verliert ein Elektroauto schneller als ein Benziner: nach drei Jahren ${pct(elektro3)} gegen ${pct(benzin3)}. Genannt werden dafür schnelle Modellwechsel, sinkende Neupreise und die Unsicherheit über die Batterie.`}
          />
          <Posten
            titel="Kilometer über dem Schnitt"
            wirkung={`${rappen(MODELL.kostenProMehrKm.diesel)} bis ${rappen(MODELL.kostenProMehrKm.elektro)} Rappen je Kilometer`}
            text={`Gemessen an ${group(MODELL.normKmProJahr)} km im Jahr. Wer weniger fährt, bekommt den Betrag gutgeschrieben — gedeckelt auf ${pct(MODELL.kmDeckel)} des Grundwerts. Sonst rechnete sich ein Auto mit 0 km reich.`}
          />
          <Posten
            titel="Serviceheft"
            wirkung={`+${pct(MODELL.serviceFaktor["lückenlos scheckheft"] - 1)} bis −${pct(1 - MODELL.serviceFaktor.keine)}`}
            text="Der billigste Posten auf dieser Liste. Belege sammeln kostet nichts und ist der einzige Punkt, an dem sich rückwirkend nichts mehr ändern lässt."
          />
          <Posten
            titel="Zustand"
            wirkung={`+${pct(MODELL.zustandFaktor.neuwertig - 1)} bis −${pct(1 - MODELL.zustandFaktor.gebraucht)}`}
            text="Selbsteinschätzung, und wir behandeln sie auch so. Beim Tausch sieht die Gegenseite das Auto ohnehin."
          />
          <Posten
            titel="Die Marke"
            wirkung={`bis rund ${Math.round((MODELL.markenSpanne.max - 1) * 100)} % schneller, bis rund ${Math.round((1 - MODELL.markenSpanne.min) * 100)} % langsamer`}
            text="Ein Zuschlag auf die Steilheit der Kurve, nicht auf den Preis. Es ist eine Annahme unseres Modells, keine Messung — wenn sie bei einer Marke danebenliegt, korrigieren wir sie."
          />
          <Posten
            titel="Unfallschaden"
            wirkung={`−${pct(MODELL.unfallMalus)}`}
            text="Der härteste Einzelabzug im Modell, und der einzige, der sich nicht wegpflegen lässt. Verschwiegen wird er beim Tausch spätestens beim Papier sichtbar."
          />
          <Posten
            titel="Zahl der Halter"
            wirkung={`−${pctGenau(MODELL.halterMalus)} je weiterem, höchstens −${pct(MODELL.halterMalusMax)}`}
            text="Viele Vorbesitzer in wenigen Jahren lassen an dem Auto zweifeln, nicht an den Menschen. Ab dem sechsten zählt es nicht weiter."
          />
          <Posten
            titel="Batteriezustand"
            wirkung="beim Stromer der wichtigste Einzelwert"
            text="Auslesbar und damit belegbar. Bei einem Verbrenner steht an dieser Stelle der Kilometerstand — beim Elektroauto sagt er weniger als die verbliebene Kapazität."
          />
        </Card>
      </div>

      {/* ---- Was das fürs Tauschen heisst ---- */}
      <div className="mt-12">
        <SectionHead
          title="Was das fürs Tauschen heisst"
          sub="Beide Autos stehen auf derselben Kurve — und genau das macht den Unterschied kleiner, als er aussieht."
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Merksatz
            Icon={IconWert}
            titel="Es zählt die Differenz"
            text="Nicht was dein Auto wert ist und nicht was seines wert ist, sondern der Abstand dazwischen. Der ist fast immer kleiner als beide Preise."
          />
          <Merksatz
            Icon={IconTausch}
            titel="Ein Geschäft statt zwei"
            text="Verkaufen und kaufen heisst zweimal verhandeln, zweimal warten, zweimal inserieren. Tauschen heisst einmal."
          />
          <Merksatz
            Icon={IconAuto}
            titel="Der Zeitpunkt liegt bei dir"
            text="Die Kurve läuft weiter, während ein Auto herumsteht und auf einen Käufer wartet. Jeder Monat Wartezeit kostet, was die Kurve in diesem Monat abgibt."
          />
        </div>
      </div>

      {/* ---- Ehrlichkeitskasten ---- */}
      <Card className="mt-8 p-5 sm:p-6">
        <h2 className="text-base font-semibold text-ink">Das ist ein Modell, kein Marktpreis</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">
          Gerechnet wird aus Neupreis, Alter, Antrieb, Kilometern, Zustand und Serviceheft. Was
          das Modell nicht kennt: dein konkretes Auto, seine Farbe, die Nachfrage nächste Woche
          und den Menschen, der es haben will. Es ersetzt keine Besichtigung und kein Gutachten.
          Wozu es taugt: als gemeinsamer Ausgangspunkt, über den zwei Leute reden können, statt
          über ein Bauchgefühl.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/wert"
            className="rounded-lg bg-marke px-4 py-2 text-sm font-medium text-onmarke transition-colors hover:bg-marke-hi"
          >
            Dein Auto durchrechnen
          </Link>
          <Link
            href="/so-funktionierts"
            className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:text-ink"
          >
            So funktioniert der Tausch
          </Link>
        </div>
      </Card>
    </div>
  );
}

function Kennzahl({ wert, titel, text }: { wert: string; titel: string; text: string }) {
  return (
    <Card className="p-5">
      <p className="text-2xl display tabular text-ink">{wert}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-ink-3">{titel}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{text}</p>
    </Card>
  );
}

function Posten({ titel, wirkung, text }: { titel: string; wirkung: string; text: string }) {
  return (
    <div className="grid gap-1 p-5 sm:grid-cols-[13rem_1fr] sm:gap-5">
      <div>
        <h3 className="text-sm font-semibold text-ink">{titel}</h3>
        <p className="mt-0.5 text-xs text-akzent">{wirkung}</p>
      </div>
      <p className="text-sm leading-relaxed text-ink-2">{text}</p>
    </div>
  );
}

function Merksatz({
  Icon,
  titel,
  text,
}: {
  Icon: (props: { className?: string }) => React.ReactElement;
  titel: string;
  text: string;
}) {
  return (
    <Card className="p-5">
      <span className="text-akzent">
        <Icon />
      </span>
      <h3 className="mt-3 text-base font-semibold text-ink">{titel}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{text}</p>
    </Card>
  );
}
