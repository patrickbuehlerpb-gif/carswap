import type { Metadata } from "next";
import Link from "next/link";
import { ValueChart } from "@/components/value-chart";
import { VehicleVisual } from "@/components/vehicle-visual";
import { Badge, Card, SectionHead, SpecRow } from "@/components/ui";
import { WatchlistSection } from "@/components/watchlist-section";
import { currentUser } from "@/lib/data/users";
import { myVehicleIds, requireVehicle } from "@/lib/data/vehicles";
import { chf, dateLabel, km, label } from "@/lib/format";
import { findMatches } from "@/lib/matching";
import { depreciationPerMonth, valuate, valueHistory } from "@/lib/valuation";

export const metadata: Metadata = { title: "Garage" };

export default function GaragePage() {
  const myVehicles = myVehicleIds.map(requireVehicle);
  const total = myVehicles.reduce((s, v) => s + valuate(v).value, 0);
  const totalLoss = myVehicles.reduce((s, v) => s + depreciationPerMonth(v), 0);

  return (
    <div className="space-y-10">
      <SectionHead
        title="Deine Garage"
        sub={`${currentUser.name} · ${currentUser.location} · Mitglied seit ${dateLabel(currentUser.memberSince)}`}
      />

      <Card className="grid grid-cols-2 divide-ink-800 sm:grid-cols-4 sm:divide-x">
        <Summary label="Fahrzeuge" value={String(myVehicles.length)} />
        <Summary label="Gesamtwert" value={chf(total)} />
        <Summary label="Wertverlust / Monat" value={chf(totalLoss)} tone="bad" />
        <Summary label="Bewertung" value={`${currentUser.rating.toFixed(1)} ★`} />
      </Card>

      <div className="space-y-8">
        {myVehicles.map((v) => {
          const val = valuate(v);
          const history = valueHistory(v, 18, 12);
          const perMonth = depreciationPerMonth(v);
          const best = findMatches(v, {}).slice(0, 3);

          return (
            <Card key={v.id} className="overflow-hidden">
              <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,300px)_1fr] sm:p-6">
                <div>
                  <VehicleVisual
                    id={v.id}
                    body={v.body}
                    className="aspect-[16/9] w-full rounded-lg"
                    label={`${v.year} · ${label.fuel(v.fuel)}`}
                  />
                  <h3 className="mt-4 text-lg font-semibold tracking-tight text-mist-100">
                    {v.make} {v.model}
                  </h3>
                  <p className="text-sm text-mist-400">{v.trim}</p>

                  <div className="mt-4">
                    <SpecRow label="Kilometerstand" value={km(v.mileageKm)} />
                    <SpecRow label="Erstzulassung" value={dateLabel(v.firstRegistration)} />
                    <SpecRow label="Zustand" value={v.condition} />
                    {v.batterySoh !== undefined && (
                      <SpecRow label="Batterie" value={`${v.batterySoh} % SoH`} />
                    )}
                    {v.mfkUntil && <SpecRow label="MFK bis" value={dateLabel(v.mfkUntil)} />}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href="/wert"
                      className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-mist-200 transition-colors hover:border-ink-500 hover:text-mist-100"
                    >
                      Bewertung anpassen
                    </Link>
                    <Link
                      href={`/fahrzeug/${v.id}`}
                      className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-mist-200 transition-colors hover:border-ink-500 hover:text-mist-100"
                    >
                      Inserat ansehen
                    </Link>
                  </div>
                </div>

                <div>
                  <div className="flex flex-wrap items-end gap-8">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-mist-400">
                        Aktueller Wert
                      </p>
                      <p className="mt-1 text-3xl font-semibold tabular text-mist-100">
                        {chf(val.value)}
                      </p>
                      <p className="mt-0.5 text-xs text-mist-400 tabular">
                        {chf(val.low)} – {chf(val.high)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-mist-400">
                        pro Monat
                      </p>
                      <p className="mt-1 text-xl font-semibold tabular text-bad">
                        {chf(perMonth)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-mist-400">
                        vom Neupreis
                      </p>
                      <p className="mt-1 text-xl font-semibold tabular text-mist-100">
                        {Math.round((val.value / v.listPriceNew) * 100)} %
                      </p>
                    </div>
                  </div>

                  <div className="mt-5">
                    <ValueChart points={history} />
                  </div>

                  <div className="mt-6 border-t border-ink-800 pt-4">
                    <p className="text-[11px] uppercase tracking-wider text-mist-400">
                      Beste Tauschmöglichkeiten
                    </p>
                    <ul className="mt-3 space-y-2">
                      {best.map((m) => (
                        <li key={m.vehicle.id}>
                          <Link
                            href={`/tausch/${m.vehicle.id}?mine=${v.id}`}
                            className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-850 p-2.5 transition-colors hover:border-ink-600"
                          >
                            <VehicleVisual
                              id={m.vehicle.id}
                              body={m.vehicle.body}
                              className="h-10 w-16 shrink-0 rounded"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-mist-100">
                                {m.vehicle.make} {m.vehicle.model}
                              </span>
                              <span className="block truncate text-xs text-mist-400">
                                {m.owner.location} · Score {m.score}
                              </span>
                            </span>
                            {m.mutual && <Badge tone="volt">beidseitig</Badge>}
                            <span className="shrink-0 text-right text-sm">
                              <span className="block text-[10px] uppercase tracking-wider text-mist-400">
                                {m.cashDelta > 0 ? "du zahlst" : "du erhältst"}
                              </span>
                              <span
                                className={`font-semibold tabular ${
                                  m.cashDelta > 0 ? "text-amber-warn" : "text-good"
                                }`}
                              >
                                {chf(Math.abs(m.cashDelta))}
                              </span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <WatchlistSection />
    </div>
  );
}

function Summary({
  label: l,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "bad";
}) {
  return (
    <div className="border-b border-ink-800 p-5 last:border-0 sm:border-b-0">
      <p className="text-[11px] uppercase tracking-wider text-mist-400">{l}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular ${
          tone === "bad" ? "text-bad" : "text-mist-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
