import { retention } from "@/lib/valuation";
import type { Fuel } from "@/lib/types";

/**
 * Die Restwertkurve als Bild — für die Erklärseite, nicht für ein einzelnes
 * Auto.
 *
 * Gezeichnet wird mit derselben Funktion, die auch der Wertrechner benutzt.
 * Eine für die Erklärung nachgebaute Kurve wäre nach der ersten Änderung am
 * Modell falsch, und die Seite erklärte dann etwas, das gar nicht passiert.
 *
 * Kein «use client»: Hier wird nichts angeklickt. Die Seite kommt fertig
 * gezeichnet aus dem Server, ohne ein Byte JavaScript für das Diagramm.
 */

const W = 720;
const H = 320;
const PAD = { top: 18, right: 16, bottom: 34, left: 40 };
const JAHRE = 12;

/** Marke ohne eigenen Faktor: die Kurve soll das Segment zeigen, nicht ein Fabrikat. */
const NEUTRAL = "—";

const KURVEN: { fuel: Fuel; label: string; farbe: string; strich?: string; dick?: boolean }[] = [
  { fuel: "benzin", label: "Benzin", farbe: "var(--color-chart-1)", dick: true },
  { fuel: "elektro", label: "Elektro", farbe: "var(--color-chart-2)", dick: true },
  { fuel: "diesel", label: "Diesel", farbe: "var(--color-ink-3)", strich: "7 4" },
  { fuel: "hybrid", label: "Hybrid", farbe: "var(--color-ink-3)", strich: "2 3" },
];

/**
 * Die drei Abschnitte, über die der Text spricht. Sie stehen als Flächen im
 * Diagramm, damit man beim Lesen nicht zwischen Text und Bild übersetzen muss.
 */
const ABSCHNITTE = [
  { von: 0, bis: 3, name: "steilster Verlust" },
  { von: 3, bis: 8, name: "flache Strecke" },
  { von: 8, bis: JAHRE, name: "wenig Restwert" },
];

const innerW = W - PAD.left - PAD.right;
const innerH = H - PAD.top - PAD.bottom;
const x = (jahr: number) => PAD.left + (jahr / JAHRE) * innerW;
const y = (quote: number) => PAD.top + innerH - quote * innerH;

function pfad(fuel: Fuel): string {
  const schritte = JAHRE * 4;
  return Array.from({ length: schritte + 1 }, (_, i) => {
    const t = (i / schritte) * JAHRE;
    return `${i === 0 ? "M" : "L"}${x(t).toFixed(1)} ${y(retention(t, fuel, NEUTRAL)).toFixed(1)}`;
  }).join(" ");
}

export function Wertkurve() {
  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[520px]"
          role="img"
          aria-label={
            "Restwertkurve über zwölf Jahre. Ein Benziner steht nach einem Jahr bei " +
            `${pct(retention(1, "benzin", NEUTRAL))}, nach drei Jahren bei ` +
            `${pct(retention(3, "benzin", NEUTRAL))}, nach acht Jahren bei ` +
            `${pct(retention(8, "benzin", NEUTRAL))} des Neupreises. Ein Elektroauto liegt ` +
            "durchgehend darunter, nach drei Jahren bei " +
            `${pct(retention(3, "elektro", NEUTRAL))}.`
          }
        >
          {ABSCHNITTE.map((a, i) => (
            <g key={a.name}>
              <rect
                x={x(a.von)}
                y={PAD.top}
                width={x(a.bis) - x(a.von)}
                height={innerH}
                fill="var(--color-surface-2)"
                opacity={i === 1 ? 0.9 : 0.45}
              />
              <text
                x={(x(a.von) + x(a.bis)) / 2}
                y={PAD.top + 13}
                textAnchor="middle"
                fontSize={10.5}
                fill="var(--color-ink-3)"
              >
                {a.name}
              </text>
            </g>
          ))}

          {[0, 0.25, 0.5, 0.75, 1].map((q) => (
            <g key={q}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(q)}
                y2={y(q)}
                stroke="var(--color-chart-grid)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(q) + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--color-ink-3)"
              >
                {Math.round(q * 100)}%
              </text>
            </g>
          ))}

          {Array.from({ length: JAHRE / 2 + 1 }, (_, i) => i * 2).map((jahr) => (
            <text
              key={jahr}
              x={x(jahr)}
              y={H - 12}
              textAnchor="middle"
              fontSize={11}
              fill="var(--color-ink-3)"
            >
              {jahr === 0 ? "neu" : `${jahr} J.`}
            </text>
          ))}

          {KURVEN.map((k) => (
            <path
              key={k.fuel}
              d={pfad(k.fuel)}
              fill="none"
              stroke={k.farbe}
              strokeWidth={k.dick ? 2.4 : 1.5}
              strokeDasharray={k.strich}
              strokeLinecap="round"
            />
          ))}

          {/* Der Sprung, den die Zulassung selbst kostet. */}
          <line
            x1={x(0)}
            x2={x(0)}
            y1={y(1)}
            y2={y(0.88)}
            stroke="var(--color-ink-3)"
            strokeWidth={1.4}
            strokeDasharray="3 3"
          />
          <circle cx={x(0)} cy={y(1)} r={3} fill="var(--color-ink-3)" />
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-2">
        {KURVEN.map((k) => (
          <span key={k.fuel} className="inline-flex items-center gap-2">
            <svg width="22" height="8" aria-hidden className="shrink-0">
              <line
                x1="1"
                x2="21"
                y1="4"
                y2="4"
                stroke={k.farbe}
                strokeWidth={k.dick ? 2.4 : 1.5}
                strokeDasharray={k.strich}
                strokeLinecap="round"
              />
            </svg>
            {k.label}
          </span>
        ))}
      </div>

      <figcaption className="mt-3 text-xs text-ink-3">
        Restwert in Prozent des Neupreises, gerechnet mit demselben Modell wie im Wertrechner.
        Ohne Markenzuschlag, mit durchschnittlicher Laufleistung. Die hinterlegten Flächen sind
        die drei Abschnitte, über die der Text spricht.
      </figcaption>
    </figure>
  );
}

function pct(anteil: number): string {
  return `${Math.round(anteil * 100)} Prozent`;
}
