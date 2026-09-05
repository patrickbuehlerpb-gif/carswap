"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { VehicleCard } from "@/components/vehicle-card";
import { chf, label } from "@/lib/format";
import { findMatches, type ListingEntry } from "@/lib/matching";
import type { Body, Fuel, Vehicle } from "@/lib/types";
import { valueAt } from "@/lib/valuation";

const BODIES: Body[] = ["suv", "limousine", "kombi", "kompakt"];
const FUELS: Fuel[] = ["elektro", "hybrid", "benzin", "diesel"];

type Sort = "score" | "cash-asc" | "cash-desc" | "value-desc" | "km-asc";

export function MarketBrowser({
  pool,
  myVehicles,
  watchlist,
  signedIn,
}: {
  pool: ListingEntry[];
  myVehicles: Vehicle[];
  watchlist: string[];
  signedIn: boolean;
}) {
  const [myVehicleId, setMyVehicleId] = useState(myVehicles[0]?.id ?? "");
  const [makes, setMakes] = useState<string[]>([]);
  const [bodies, setBodies] = useState<Body[]>([]);
  const [fuels, setFuels] = useState<Fuel[]>([]);
  const [minYear, setMinYear] = useState<number | undefined>();
  const [maxCash, setMaxCash] = useState(30_000);
  const [onlyMutual, setOnlyMutual] = useState(false);
  const [sort, setSort] = useState<Sort>("score");

  const myVehicle = myVehicles.find((v) => v.id === myVehicleId) ?? myVehicles[0] ?? null;

  /** Nur Marken anbieten, die im Bestand tatsächlich vorkommen. */
  const availableMakes = useMemo(
    () => [...new Set(pool.map((e) => e.vehicle.make))].sort((a, b) => a.localeCompare(b, "de-CH")),
    [pool],
  );

  const matches = useMemo(() => {
    // Ohne eigenes Auto gibt es keine Zuzahlung — dann werden die
    // Inserate nur gefiltert und nach Aktualität gezeigt.
    const all = myVehicle
      ? findMatches(myVehicle, pool, { wish: { makes, bodies, fuels, minYear }, onlyMutual })
      : pool.map((e) => ({
          listing: e.listing,
          vehicle: e.vehicle,
          owner: e.owner,
          score: 0,
          cashDelta: 0,
          reasons: [],
          concerns: [],
          mutual: false,
          fitsMyWish: true,
        }));
    const filtered = all.filter((m) => {
      if (makes.length && !makes.includes(m.vehicle.make)) return false;
      if (bodies.length && !bodies.includes(m.vehicle.body)) return false;
      if (fuels.length && !fuels.includes(m.vehicle.fuel)) return false;
      if (minYear && m.vehicle.year < minYear) return false;
      if (myVehicle && m.cashDelta > maxCash) return false;
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "cash-asc":
          return a.cashDelta - b.cashDelta;
        case "cash-desc":
          return b.cashDelta - a.cashDelta;
        case "value-desc":
          return valueAt(b.vehicle) - valueAt(a.vehicle);
        case "km-asc":
          return a.vehicle.mileageKm - b.vehicle.mileageKm;
        default:
          return b.score - a.score;
      }
    });
    return sorted;
  }, [myVehicle, pool, makes, bodies, fuels, minYear, maxCash, onlyMutual, sort]);

  const mutualCount = matches.filter((m) => m.mutual).length;
  const activeFilters =
    makes.length + bodies.length + fuels.length + (minYear ? 1 : 0) + (onlyMutual ? 1 : 0);

  function toggle<T>(arr: T[], set: (v: T[]) => void, v: T) {
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  }

  function resetFilters() {
    setMakes([]);
    setBodies([]);
    setFuels([]);
    setMinYear(undefined);
    setMaxCash(30_000);
    setOnlyMutual(false);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[248px_1fr]">
      {/* --------------- Filter --------------- */}
      <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
        <div>
          <FilterLabel>Dein Tauschobjekt</FilterLabel>
          {myVehicles.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-line-strong p-3 text-xs text-ink-3">
              {signedIn ? (
                <>
                  Stelle dein Auto ein, dann rechnen wir jede Zuzahlung direkt dagegen.{" "}
                  <Link href="/inserat/neu" className="text-marke hover:underline">
                    Auto anbieten
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/konto/registrieren" className="text-marke hover:underline">
                    Konto erstellen
                  </Link>{" "}
                  und Auto einstellen, um Zuzahlungen zu sehen.
                </>
              )}
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {myVehicles.map((v) => {
                const active = v.id === myVehicleId;
                return (
                  <button
                    key={v.id}
                    onClick={() => setMyVehicleId(v.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-marke/40 bg-marke/25"
                        : "border-line bg-surface-2 hover:border-line-strong"
                    }`}
                  >
                    <span className="block text-sm font-medium text-ink">
                      {v.make} {v.model}
                    </span>
                    <span className="block text-xs text-ink-3">
                      {v.trim ? `${v.year} · ${v.trim}` : v.year}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <FilterGroup title="Marke">
          <div className="flex flex-wrap gap-1.5">
            {availableMakes.map((m) => (
              <Chip key={m} active={makes.includes(m)} onClick={() => toggle(makes, setMakes, m)}>
                {m}
              </Chip>
            ))}
          </div>
        </FilterGroup>

        <FilterGroup title="Karosserie">
          <div className="flex flex-wrap gap-1.5">
            {BODIES.map((b) => (
              <Chip key={b} active={bodies.includes(b)} onClick={() => toggle(bodies, setBodies, b)}>
                {label.body(b)}
              </Chip>
            ))}
          </div>
        </FilterGroup>

        <FilterGroup title="Antrieb">
          <div className="flex flex-wrap gap-1.5">
            {FUELS.map((f) => (
              <Chip key={f} active={fuels.includes(f)} onClick={() => toggle(fuels, setFuels, f)}>
                {label.fuel(f)}
              </Chip>
            ))}
          </div>
        </FilterGroup>

        <FilterGroup title="Baujahr ab">
          <div className="flex flex-wrap gap-1.5">
            {[2021, 2022, 2023, 2024, 2025].map((y) => (
              <Chip
                key={y}
                active={minYear === y}
                onClick={() => setMinYear(minYear === y ? undefined : y)}
              >
                {y}
              </Chip>
            ))}
          </div>
        </FilterGroup>

        {myVehicle && (
        <FilterGroup title={`Maximale Zuzahlung: ${chf(maxCash)}`}>
          <input
            type="range"
            min={-25_000}
            max={40_000}
            step={1_000}
            value={maxCash}
            onChange={(e) => setMaxCash(Number(e.target.value))}
            className="mt-1 w-full accent-marke"
            aria-label="Maximale Zuzahlung"
          />
          <p className="mt-1 text-[11px] text-ink-3">
            Negative Werte heissen: du willst Geld erhalten.
          </p>
        </FilterGroup>
        )}

        {myVehicle && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface-2 p-3">
          <input
            type="checkbox"
            checked={onlyMutual}
            onChange={(e) => setOnlyMutual(e.target.checked)}
            className="mt-0.5 accent-marke"
          />
          <span>
            <span className="block text-sm font-medium text-ink">Nur beidseitige Treffer</span>
            <span className="mt-0.5 block text-xs text-ink-3">
              Die Gegenseite sucht ausdrücklich ein Auto wie deines.
            </span>
          </span>
        </label>
        )}

        {activeFilters > 0 && (
          <button
            onClick={resetFilters}
            className="w-full rounded-lg border border-line py-2 text-sm text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          >
            Filter zurücksetzen ({activeFilters})
          </button>
        )}
      </aside>

      {/* --------------- Ergebnisse --------------- */}
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-3">
            <span className="font-semibold tabular text-ink">{matches.length}</span> Inserate
            {mutualCount > 0 && (
              <>
                {" · "}
                <span className="text-marke">{mutualCount} beidseitig passend</span>
              </>
            )}
          </p>
          <label className="flex items-center gap-2 text-sm text-ink-3">
            Sortieren
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink-3"
            >
              <option value="score">Beste Übereinstimmung</option>
              <option value="cash-asc">Geringste Zuzahlung</option>
              <option value="cash-desc">Höchster Erlös</option>
              <option value="value-desc">Teuerste zuerst</option>
              <option value="km-asc">Wenigste Kilometer</option>
            </select>
          </label>
        </div>

        {matches.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-12 text-center">
            <p className="text-sm text-ink-2">Keine Inserate mit diesen Kriterien.</p>
            <button
              onClick={resetFilters}
              className="mt-3 text-sm text-marke hover:text-marke"
            >
              Filter zurücksetzen
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {matches.map((m) => (
              <VehicleCard
                key={m.vehicle.id}
                vehicle={m.vehicle}
                listing={m.listing}
                owner={m.owner}
                cashDelta={myVehicle ? m.cashDelta : undefined}
                score={myVehicle ? m.score : undefined}
                mutual={m.mutual}
                watched={watchlist.includes(m.listing.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <FilterLabel>{title}</FilterLabel>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
      {children}
    </span>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-marke/45 bg-marke/30 text-marke"
          : "border-line bg-surface-2 text-ink-2 hover:border-line-strong hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
