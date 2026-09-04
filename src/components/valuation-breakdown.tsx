import { Badge } from "@/components/ui";
import { chf, pct } from "@/lib/format";
import type { Valuation, Vehicle } from "@/lib/types";

/**
 * Zeigt, wie sich der Schätzwert zusammensetzt — vom Neupreis über
 * Alterung und Zu-/Abschläge bis zum Endwert.
 */
export function ValuationBreakdown({
  vehicle,
  valuation,
}: {
  vehicle: Vehicle;
  valuation: Valuation;
}) {
  const maxAbs = Math.max(...valuation.breakdown.map((f) => Math.abs(f.amount)), 1);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 border-b border-ink-800 pb-3">
        <span className="text-sm text-mist-400">Listenpreis fabrikneu</span>
        <span className="text-sm font-semibold tabular text-mist-200">
          {chf(vehicle.listPriceNew)}
        </span>
      </div>

      <ul className="divide-y divide-ink-800">
        {valuation.breakdown.map((f) => (
          <li key={f.label} className="py-3">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm text-mist-200">{f.label}</span>
              <span
                className={`shrink-0 text-sm font-semibold tabular ${
                  f.amount > 0 ? "text-good" : f.amount < 0 ? "text-bad" : "text-mist-400"
                }`}
              >
                {f.amount > 0 ? "+" : f.amount < 0 ? "−" : "±"}
                {chf(Math.abs(f.amount)).replace("CHF ", "CHF ")}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-800">
              <div
                className={`h-full rounded-full ${f.amount >= 0 ? "bg-good/70" : "bg-bad/70"}`}
                style={{ width: `${(Math.abs(f.amount) / maxAbs) * 100}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-mist-400">{f.hint}</p>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-ink-700 pt-3">
        <div>
          <p className="text-sm font-medium text-mist-100">Geschätzter Handelswert</p>
          <p className="mt-0.5 text-xs text-mist-400 tabular">
            Spanne {chf(valuation.low)} – {chf(valuation.high)}
          </p>
        </div>
        <span className="text-2xl font-semibold tabular text-volt-400">{chf(valuation.value)}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone={valuation.confidence > 0.75 ? "good" : "warn"}>
          Zuverlässigkeit {pct(valuation.confidence)}
        </Badge>
        <Badge>{valuation.comparables} vergleichbare Inserate</Badge>
      </div>
    </div>
  );
}
