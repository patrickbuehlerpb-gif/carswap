"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Combobox } from "@/components/combobox";
import { featuresFor, normalizeFeatures } from "@/lib/data/features";
import { ValueChart } from "@/components/value-chart";
import { ValuationBreakdown } from "@/components/valuation-breakdown";
import { VehicleVisual } from "@/components/vehicle-visual";
import { Badge, Card } from "@/components/ui";
import { MAKE_NAMES, modelsFor } from "@/lib/data/catalog";
import { chf, km, label } from "@/lib/format";
import type { Body, Condition, Fuel, ServiceHistory, Vehicle } from "@/lib/types";
import { depreciationPerMonth, valuate, valueAt, valueHistory } from "@/lib/valuation";


/** Formularzustand — daraus wird ein vollständiges Vehicle-Objekt gebaut. */
interface Draft {
  make: string;
  model: string;
  trim: string;
  firstRegistration: string;
  mileageKm: number;
  fuel: Fuel;
  body: Body;
  powerPs: number;
  listPriceNew: number;
  condition: Condition;
  serviceHistory: ServiceHistory;
  previousOwners: number;
  accidentFree: boolean;
  batterySoh: number;
  features: string[];
}

/** Ausgangswerte für Besucher ohne eigenes Fahrzeug im Konto. */
const BLANK: Draft = {
  make: "VW",
  model: "ID.7",
  trim: "Pro",
  firstRegistration: "2023-06",
  mileageKm: 45_000,
  fuel: "elektro",
  body: "limousine",
  powerPs: 286,
  listPriceNew: 58_000,
  condition: "gut",
  serviceHistory: "lückenlos scheckheft",
  previousOwners: 1,
  accidentFree: true,
  batterySoh: 94,
  features: ["Wärmepumpe", "Panoramadach"],
};

function draftFrom(v: Vehicle): Draft {
  return {
    make: v.make,
    model: v.model,
    trim: v.trim,
    firstRegistration: v.firstRegistration.slice(0, 7),
    mileageKm: v.mileageKm,
    fuel: v.fuel,
    body: v.body,
    powerPs: v.powerPs,
    listPriceNew: v.listPriceNew,
    condition: v.condition,
    serviceHistory: v.serviceHistory,
    previousOwners: v.previousOwners,
    accidentFree: v.accidentFree,
    batterySoh: v.batterySoh ?? 95,
    features: normalizeFeatures(v.features),
  };
}

function toVehicle(d: Draft, id: string): Vehicle {
  return {
    id,
    make: d.make,
    model: d.model,
    trim: d.trim,
    year: Number(d.firstRegistration.slice(0, 4)),
    firstRegistration: `${d.firstRegistration}-15`,
    mileageKm: d.mileageKm,
    fuel: d.fuel,
    body: d.body,
    drivetrain: "allrad",
    powerPs: d.powerPs,
    listPriceNew: d.listPriceNew,
    condition: d.condition,
    ownerId: "",
    color: "—",
    batterySoh: d.fuel === "elektro" ? d.batterySoh : undefined,
    features: d.features,
    photos: [],
    serviceHistory: d.serviceHistory,
    previousOwners: d.previousOwners,
    accidentFree: d.accidentFree,
  };
}

export function ValuationStudio({
  myVehicles,
  asOf,
}: {
  myVehicles: Vehicle[];
  /** Stichtag vom Server, damit Server- und Client-Rendering übereinstimmen */
  asOf: string;
}) {
  const [source, setSource] = useState<string>(myVehicles[0]?.id ?? "entwurf");
  const [draft, setDraft] = useState<Draft>(() =>
    myVehicles[0] ? draftFrom(myVehicles[0]) : BLANK,
  );

  // Die ID bleibt stabil pro Quelle, damit das Marktrauschen nicht bei jeder
  // Eingabe springt.
  const vehicle = useMemo(() => toVehicle(draft, source), [draft, source]);
  const valuation = useMemo(() => valuate(vehicle, asOf), [vehicle, asOf]);
  const history = useMemo(() => valueHistory(vehicle, 30, 24, asOf), [vehicle, asOf]);
  const perMonth = depreciationPerMonth(vehicle, asOf);

  const in12 = valueAt(vehicle, shiftMonth(asOf, 12), asOf);
  const in24 = valueAt(vehicle, shiftMonth(asOf, 24), asOf);

  const sensitivity = useMemo(() => {
    const base = valuation.value;
    const variants: Array<{ label: string; delta: number; hint: string }> = [
      {
        label: "10'000 km mehr",
        delta: valueAt({ ...vehicle, mileageKm: vehicle.mileageKm + 10_000 }, undefined, asOf) - base,
        hint: "typisch für acht Monate Normalbetrieb",
      },
      {
        label: "Zustand eine Stufe besser",
        delta: valueAt({ ...vehicle, condition: upgrade(vehicle.condition) }, undefined, asOf) - base,
        hint: "Aufbereitung, Smart Repair, Innenreinigung",
      },
      {
        label: "Ein Jahr älter",
        delta:
          valueAt({ ...vehicle, firstRegistration: shiftYear(vehicle.firstRegistration, -1) }, undefined, asOf) -
          base,
        hint: "reiner Alterseffekt ohne Mehrkilometer",
      },
      {
        label: "Ohne Serviceheft",
        delta: valueAt({ ...vehicle, serviceHistory: "keine" }, undefined, asOf) - base,
        hint: "fehlende Wartungsnachweise",
      },
    ];
    if (vehicle.fuel === "elektro") {
      variants.push({
        label: "Batterie 5 % schlechter",
        delta: valueAt({ ...vehicle, batterySoh: (vehicle.batterySoh ?? 95) - 5 }, undefined, asOf) - base,
        hint: "SoH ist beim Stromer der grösste Einzelhebel",
      });
    }
    return variants;
  }, [vehicle, valuation.value, asOf]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function loadPreset(v: Vehicle) {
    setSource(v.id);
    setDraft(draftFrom(v));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      {/* --------------- Eingabe --------------- */}
      <Card className="h-fit p-5 lg:sticky lg:top-24">
        {myVehicles.length > 0 && (
          <>
            <p className="text-[11px] uppercase tracking-wider text-ink-3">Aus deiner Garage</p>
            <div className="mt-2 mb-5 flex flex-wrap gap-2">
              {myVehicles.map((v) => (
                <button
                  key={v.id}
                  onClick={() => loadPreset(v)}
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    source === v.id
                      ? "border-volt-ink/45 bg-volt/30 text-volt-ink"
                      : "border-line bg-surface-2 text-ink-2 hover:text-ink"
                  }`}
                >
                  {v.make} {v.model}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Combobox
              label="Marke"
              value={draft.make}
              onChange={(make) =>
                setDraft((d) => (d.make === make ? d : { ...d, make, model: "" }))
              }
              options={MAKE_NAMES}
              placeholder="Marke suchen …"
            />
            <Combobox
              label="Modell"
              value={draft.model}
              onChange={(model) => set("model", model)}
              options={modelsFor(draft.make)}
              placeholder="Modell suchen …"
            />
          </div>

          <Field label="Version / Ausführung">
            <input
              value={draft.trim}
              onChange={(e) => set("trim", e.target.value)}
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Erstzulassung">
              <input
                type="month"
                value={draft.firstRegistration}
                max={asOf}
                onChange={(e) => set("firstRegistration", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Neupreis">
              <input
                type="number"
                step={500}
                value={draft.listPriceNew}
                onChange={(e) => set("listPriceNew", Math.max(5_000, Number(e.target.value)))}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label={`Kilometerstand — ${km(draft.mileageKm)}`}>
            <input
              type="range"
              min={0}
              max={250_000}
              step={1_000}
              value={draft.mileageKm}
              onChange={(e) => set("mileageKm", Number(e.target.value))}
              className="w-full accent-volt-ink"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Antrieb">
              <select
                value={draft.fuel}
                onChange={(e) => {
                  const fuel = e.target.value as Fuel;
                  const allowed = new Set(featuresFor(fuel).map((f) => f.name));
                  setDraft((d) => ({
                    ...d,
                    fuel,
                    features: d.features.filter((f) => allowed.has(f)),
                  }));
                }}
                className={inputClass}
              >
                {(["elektro", "hybrid", "benzin", "diesel"] as Fuel[]).map((f) => (
                  <option key={f} value={f}>
                    {label.fuel(f)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Karosserie">
              <select
                value={draft.body}
                onChange={(e) => set("body", e.target.value as Body)}
                className={inputClass}
              >
                {(["suv", "limousine", "kombi", "kompakt", "coupe", "van"] as Body[]).map((b) => (
                  <option key={b} value={b}>
                    {label.body(b)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Zustand">
              <select
                value={draft.condition}
                onChange={(e) => set("condition", e.target.value as Condition)}
                className={inputClass}
              >
                {(["neuwertig", "sehr gut", "gut", "gebraucht"] as Condition[]).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Halter">
              <input
                type="number"
                min={1}
                max={8}
                value={draft.previousOwners}
                onChange={(e) => set("previousOwners", Math.max(1, Number(e.target.value)))}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Serviceheft">
            <select
              value={draft.serviceHistory}
              onChange={(e) => set("serviceHistory", e.target.value as Draft["serviceHistory"])}
              className={inputClass}
            >
              <option value="lückenlos scheckheft">lückenlos scheckheft</option>
              <option value="teilweise">teilweise</option>
              <option value="keine">keine</option>
            </select>
          </Field>

          {draft.fuel === "elektro" && (
            <Field label={`Batteriezustand — ${draft.batterySoh} % SoH`}>
              <input
                type="range"
                min={70}
                max={100}
                value={draft.batterySoh}
                onChange={(e) => set("batterySoh", Number(e.target.value))}
                className="w-full accent-volt-ink"
              />
            </Field>
          )}

          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={draft.accidentFree}
              onChange={(e) => set("accidentFree", e.target.checked)}
              className="accent-volt-ink"
            />
            unfallfrei
          </label>

          <fieldset>
            <legend className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-3">
              Ausstattung
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {featuresFor(draft.fuel).map(({ name: f, hint }) => {
                const active = draft.features.includes(f);
                return (
                  <button
                    key={f}
                    title={hint}
                    onClick={() =>
                      set(
                        "features",
                        active ? draft.features.filter((x) => x !== f) : [...draft.features, f],
                      )
                    }
                    className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                      active
                        ? "border-volt-ink/45 bg-volt/30 text-volt-ink"
                        : "border-line bg-surface-2 text-ink-3 hover:text-ink-2"
                    }`}
                  >
                    {f}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      </Card>

      {/* --------------- Ergebnis --------------- */}
      <div className="min-w-0 space-y-6">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
            <VehicleVisual
              id={source}
              body={draft.body}
              className="aspect-[16/9] w-full shrink-0 rounded-lg sm:w-56"
            />
            <div className="flex-1">
              <p className="text-sm text-ink-3">
                {draft.make} {draft.model} {draft.trim}
              </p>
              <p className="mt-1 text-4xl font-semibold tabular text-ink">
                {chf(valuation.value)}
              </p>
              <p className="mt-1 text-sm text-ink-3 tabular">
                Realistische Spanne {chf(valuation.low)} – {chf(valuation.high)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone={valuation.confidence > 0.75 ? "good" : "warn"}>
                  {Math.round(valuation.confidence * 100)} % Zuverlässigkeit
                </Badge>
                <Badge>
                  {Math.round((valuation.value / draft.listPriceNew) * 100)} % vom Neupreis
                </Badge>
                <Badge tone="bad">{chf(perMonth)} pro Monat</Badge>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 divide-x divide-line border-t border-line sm:grid-cols-4">
            <Mini label="Heute" value={chf(valuation.value)} />
            <Mini label="in 12 Monaten" value={chf(in12)} tone="bad" />
            <Mini label="in 24 Monaten" value={chf(in24)} tone="bad" />
            <Mini
              label="Verlust 24 Mte."
              value={chf(valuation.value - in24)}
              tone="bad"
            />
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <p className="text-[11px] uppercase tracking-wider text-ink-3">
            Wertverlauf und Prognose
          </p>
          <div className="mt-4">
            <ValueChart points={history} />
          </div>
          <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-3">
            Die Prognose schreibt Alterung, Laufleistung und die Marktentwicklung des jeweiligen
            Antriebssegments fort. Das schattierte Band zeigt, wie unsicher die Schätzung mit
            zunehmendem Horizont wird — nach zwei Jahren liegt die realistische Streuung bereits
            im mittleren vierstelligen Bereich.
          </p>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <p className="text-[11px] uppercase tracking-wider text-ink-3">
              Zusammensetzung des Werts
            </p>
            <div className="mt-4">
              <ValuationBreakdown vehicle={vehicle} valuation={valuation} />
            </div>
          </Card>

          <div className="space-y-6">
            <Card className="p-5">
              <p className="text-[11px] uppercase tracking-wider text-ink-3">
                Was den Wert bewegt
              </p>
              <p className="mt-1 text-sm text-ink-3">
                Einzelne Änderungen gegenüber der aktuellen Konfiguration.
              </p>
              <ul className="mt-4 space-y-3">
                {sensitivity.map((s) => (
                  <li key={s.label}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-ink-2">{s.label}</span>
                      <span
                        className={`text-sm font-semibold tabular ${
                          s.delta >= 0 ? "text-good" : "text-bad"
                        }`}
                      >
                        {s.delta >= 0 ? "+" : "−"}
                        {chf(Math.abs(s.delta))}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-3">{s.hint}</p>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-5">
              <p className="text-[11px] uppercase tracking-wider text-ink-3">Empfehlung</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">
                {recommendation(valuation.value, perMonth, draft)}
              </p>
              <Link
                href="/matches"
                className="mt-4 block rounded-lg bg-volt py-2.5 text-center text-sm font-semibold text-ink transition-colors hover:bg-volt-hi"
              >
                Tauschmöglichkeiten anzeigen
              </Link>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink-3";

function Field({ label: l, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-3">
        {l}
      </span>
      {children}
    </label>
  );
}

function Mini({
  label: l,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "bad";
}) {
  return (
    <div className="p-4">
      <p className="text-[11px] uppercase tracking-wider text-ink-3">{l}</p>
      <p className={`mt-1 text-lg font-semibold tabular ${tone === "bad" ? "text-ink-2" : "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}

function recommendation(value: number, perMonth: number, d: Draft): string {
  const rel = Math.abs(perMonth) / value;
  if (rel > 0.011) {
    return `Dieses Fahrzeug verliert derzeit rund ${chf(Math.abs(perMonth))} pro Monat — über ein Prozent seines Werts. Ein Tausch in den nächsten Monaten kostet dich deutlich weniger als ein Jahr Abwarten. Achte darauf, dass dein Tauschpartner ein Fahrzeug mit flacherer Kurve anbietet.`;
  }
  if (d.mileageKm > 120_000) {
    return `Der Wertverlust ist mit ${chf(Math.abs(perMonth))} pro Monat moderat, weil der grösste Teil bereits eingetreten ist. Bei dieser Laufleistung schlagen künftig eher Reparaturen als Wertverlust zu Buche — ein Tausch in ein jüngeres Fahrzeug ist vor allem eine Frage des Reparaturrisikos.`;
  }
  return `Mit ${chf(Math.abs(perMonth))} Wertverlust pro Monat liegt dein Fahrzeug im normalen Bereich. Du hast keinen akuten Zeitdruck — nutze das, um auf ein Angebot mit beidseitiger Passung zu warten, statt die Differenz mit Bargeld zu überbrücken.`;
}

function upgrade(c: Condition): Condition {
  const order: Condition[] = ["gebraucht", "gut", "sehr gut", "neuwertig"];
  const i = order.indexOf(c);
  return order[Math.min(order.length - 1, i + 1)];
}

function shiftMonth(month: string, months: number): string {
  const d = new Date(`${month}-01`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 7);
}

function shiftYear(iso: string, years: number): string {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}
