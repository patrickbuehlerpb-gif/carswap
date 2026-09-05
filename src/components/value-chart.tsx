"use client";

import { useId, useMemo, useRef, useState } from "react";
import { chf, group } from "@/lib/format";
import type { HistoryPoint } from "@/lib/types";
import { monthLabel } from "@/lib/valuation";

/**
 * Zeichenfläche in SVG-Einheiten. Die Achsenbeschriftungen liegen bewusst als
 * HTML darüber: ein mitskaliertes SVG-Textelement wird in schmalen Spalten
 * unlesbar klein und in breiten unangenehm gross.
 */
const W = 840;
const H = 260;
const PAD = { top: 16, right: 14, bottom: 12, left: 46 };

export function ValueChart({
  points,
  accent = "#0e4c46",
  compareLabel,
  comparePoints,
}: {
  points: HistoryPoint[];
  accent?: string;
  /** Optionale zweite Kurve zum Vergleich, z.B. ein Wunschfahrzeug */
  compareLabel?: string;
  comparePoints?: HistoryPoint[];
}) {
  const uid = useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  // Die Vergleichskurve wird über den Monat zugeordnet, nicht über den Index —
  // sonst wird eine kürzere Historie über die ganze Breite gestreckt.
  const compareByMonth = useMemo(
    () => new Map((comparePoints ?? []).map((p) => [p.month, p.value])),
    [comparePoints],
  );

  const geom = useMemo(() => {
    // Ohne Datenpunkte gibt es nichts zu zeichnen. Ohne diese Schranke
    // greift die Zeichenroutine weiter unten auf points[splitIdx] zu und
    // die ganze Seite stürzt ab — etwa wenn im Wertrechner das Feld für
    // die Erstzulassung leer steht.
    if (!points.length) return null;

    const all: number[] = [];
    for (const p of points) {
      all.push(p.value);
      if (p.low !== undefined) all.push(p.low);
      if (p.high !== undefined) all.push(p.high);
      const c = compareByMonth.get(p.month);
      if (c !== undefined) all.push(c);
    }

    const rawMin = Math.min(...all);
    const rawMax = Math.max(...all);
    const span = Math.max(1, rawMax - rawMin);
    const min = Math.max(0, rawMin - span * 0.16);
    const max = rawMax + span * 0.1;

    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (i / Math.max(1, points.length - 1)) * innerW;
    const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min)) * innerH;

    const todayIdx = points.findIndex((p) => p.forecast);
    const splitIdx = todayIdx === -1 ? points.length - 1 : todayIdx - 1;

    const step = niceStep((max - min) / 5);
    const ticks: number[] = [];
    for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);

    return { x, y, splitIdx, ticks };
  }, [points, compareByMonth]);

  // Hooks müssen vor jedem frühen Ausstieg laufen — deshalb wird hier nur
  // auf unschädliche Ersatzwerte ausgewichen und erst nach allen Hooks
  // die Ersatzdarstellung zurückgegeben.
  const { x, y, splitIdx, ticks } = geom ?? {
    x: () => 0,
    y: () => 0,
    splitIdx: 0,
    ticks: [] as number[],
  };

  const pastPath = linePath(points.slice(0, splitIdx + 1).map((p, i) => [x(i), y(p.value)]));
  const futurePath = linePath(points.slice(splitIdx).map((p, i) => [x(splitIdx + i), y(p.value)]));
  const areaPath =
    pastPath && `${pastPath} L ${x(splitIdx)} ${H - PAD.bottom} L ${x(0)} ${H - PAD.bottom} Z`;

  const bandPath = useMemo(() => {
    const fc = points.map((p, i) => ({ p, i })).filter(({ p }) => p.forecast);
    if (fc.length < 2) return "";
    const anchor = points[splitIdx];
    const top: Array<[number, number]> = [
      [x(splitIdx), y(anchor.value)],
      ...fc.map(({ p, i }) => [x(i), y(p.high ?? p.value)] as [number, number]),
    ];
    const bottom: Array<[number, number]> = [
      ...fc.map(({ p, i }) => [x(i), y(p.low ?? p.value)] as [number, number]).reverse(),
      [x(splitIdx), y(anchor.value)],
    ];
    return `${linePath(top)} L ${bottom.map((c) => c.join(" ")).join(" L ")} Z`;
  }, [points, splitIdx, x, y]);

  const comparePath = useMemo(() => {
    if (!compareByMonth.size) return "";
    const coords: Array<[number, number]> = [];
    points.forEach((p, i) => {
      const v = compareByMonth.get(p.month);
      if (v !== undefined) coords.push([x(i), y(v)]);
    });
    return linePath(coords);
  }, [points, compareByMonth, x, y]);

  const active = hover !== null ? points[hover] : null;
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (rel - PAD.left) / (W - PAD.left - PAD.right);
    const idx = Math.round(frac * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, idx)));
  }

  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  if (!geom) {
    return (
      <div className="grid h-40 w-full place-items-center rounded-lg border border-dashed border-line-strong text-sm text-ink-3">
        Für den Verlauf fehlen noch Angaben — bitte Erstzulassung und Neupreis ausfüllen.
      </div>
    );
  }

  return (
    <div className="w-full select-none">
      <div
        ref={wrapRef}
        className="relative w-full touch-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
          aria-label="Wertverlauf des Fahrzeugs mit Prognoseband">
          <defs>
            <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity="0.18" />
              <stop offset="100%" stopColor={accent} stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((t) => (
            <line
              key={t}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="#e6e9e0"
              strokeWidth="1"
            />
          ))}

          {bandPath && <path d={bandPath} fill={accent} fillOpacity="0.1" />}
          {areaPath && <path d={areaPath} fill={`url(#fill-${uid})`} />}

          {comparePath && (
            <path
              d={comparePath}
              fill="none"
              stroke="#b0730f"
              strokeWidth="2"
              strokeOpacity="0.85"
              strokeDasharray="1 5"
              strokeLinecap="round"
            />
          )}

          <path d={pastPath} fill="none" stroke={accent} strokeWidth="2.4" strokeLinejoin="round" />
          <path
            d={futurePath}
            fill="none"
            stroke={accent}
            strokeWidth="2.4"
            strokeDasharray="6 5"
            strokeOpacity="0.75"
            strokeLinejoin="round"
          />

          <line
            x1={x(splitIdx)}
            x2={x(splitIdx)}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="#b9c0ad"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
          <circle cx={x(splitIdx)} cy={y(points[splitIdx].value)} r="4.5" fill={accent} />

          {active && hover !== null && (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke="#656f78"
                strokeWidth="1"
              />
              <circle
                cx={x(hover)}
                cy={y(active.value)}
                r="5"
                fill="#ffffff"
                stroke={accent}
                strokeWidth="2.5"
              />
            </g>
          )}
        </svg>

        {/* Y-Achse als HTML, damit die Schriftgrösse nicht mitskaliert */}
        <span className="absolute left-0 top-0 text-[10px] uppercase tracking-wider text-ink-3">
          CHF
        </span>
        {ticks.map((t) => (
          <span
            key={t}
            className="pointer-events-none absolute -translate-y-1/2 text-[11px] tabular text-ink-3"
            style={{ left: 0, top: pct(y(t), H) }}
          >
            {shortAmount(t)}
          </span>
        ))}

        <span
          className="pointer-events-none absolute -translate-x-1/2 text-[10px] text-ink-3"
          style={{ left: pct(x(splitIdx), W), top: 0 }}
        >
          heute
        </span>

        {active && hover !== null && (
          <div
            className="pointer-events-none absolute top-4 z-10 min-w-[150px] rounded-lg border border-line-strong bg-surface/95 p-2.5 shadow-xl backdrop-blur-sm"
            style={{
              left: `calc(${pct(x(hover), W)} + ${hover > points.length / 2 ? -166 : 12}px)`,
            }}
          >
            <p className="text-[11px] uppercase tracking-wider text-ink-3">
              {monthLabel(active.month)} {active.forecast && "· Prognose"}
            </p>
            <p className="mt-0.5 text-base font-semibold tabular text-ink">
              {chf(active.value)}
            </p>
            {active.forecast && active.low !== undefined && (
              <p className="mt-0.5 text-[11px] tabular text-ink-3">
                Band {chf(active.low, { compact: true })} – {chf(active.high!, { compact: true })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* X-Achse in fester Höhe unter der Zeichenfläche */}
      <div className="relative mt-1 h-4">
        {points.map((p, i) => {
          const isLast = i === points.length - 1;
          const show = (i % labelEvery === 0 && points.length - 1 - i >= labelEvery * 0.7) || isLast;
          if (!show) return null;
          return (
            <span
              key={p.month}
              className="absolute -translate-x-1/2 whitespace-nowrap text-[11px] text-ink-3"
              style={{ left: pct(x(i), W) }}
            >
              {monthLabel(p.month)}
            </span>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-ink-3">
        <Legend color={accent} label="Wertverlauf" />
        <Legend color={accent} dashed label="Prognose" />
        <Legend color={accent} band label="Unsicherheitsband" />
        {compareLabel && <Legend color="#b0730f" dotted label={compareLabel} />}
      </div>
    </div>
  );
}

function Legend({
  color,
  label,
  dashed,
  dotted,
  band,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  dotted?: boolean;
  band?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {band ? (
        <span className="h-2.5 w-5 rounded-[2px]" style={{ background: color, opacity: 0.18 }} />
      ) : (
        <span
          className="h-0.5 w-5 rounded-full"
          style={{
            background: dashed
              ? `repeating-linear-gradient(90deg, ${color} 0 5px, transparent 5px 9px)`
              : dotted
                ? `repeating-linear-gradient(90deg, ${color} 0 2px, transparent 2px 6px)`
                : color,
          }}
        />
      )}
      {label}
    </span>
  );
}

function linePath(coords: Array<[number, number]>): string {
  if (!coords.length) return "";
  return coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c[0].toFixed(1)} ${c[1].toFixed(1)}`)
    .join(" ");
}

/** Kurzform für die Y-Achse: 46'800 wird zu 47k. */
function shortAmount(n: number): string {
  if (Math.abs(n) >= 1000) return `${Math.round(n / 1000)}k`;
  return group(n);
}

/** Rundet einen Achsenabstand auf 1 / 2 / 2.5 / 5 / 10 × 10^n. */
function niceStep(raw: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}
