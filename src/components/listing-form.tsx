"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { upload } from "@vercel/blob/client";
import { Combobox } from "@/components/combobox";
import { ValueChart } from "@/components/value-chart";
import { VehicleVisual } from "@/components/vehicle-visual";
import { Badge, Card } from "@/components/ui";
import { createListingAction, updateListingAction } from "@/app/actions/listings";
import { chf, km, label } from "@/lib/format";
import type { Body, Condition, Fuel, ServiceHistory, Vehicle, VehiclePhoto } from "@/lib/types";
import { MAKE_NAMES, modelsFor } from "@/lib/data/catalog";
import { featuresFor, normalizeFeatures } from "@/lib/data/features";
import { BODIES, CONDITIONS, DRIVETRAINS, FUELS, SERVICE_HISTORIES } from "@/lib/validation";
import { hasValuationInput, valuate, valueHistory } from "@/lib/valuation";

export interface ListingFormValues {
  make: string;
  model: string;
  trim: string;
  firstRegistration: string;
  mileageKm: number;
  fuel: Fuel;
  body: Body;
  drivetrain: (typeof DRIVETRAINS)[number];
  powerPs: number;
  listPriceNew: number;
  condition: Condition;
  color: string;
  rangeKm?: number;
  batterySoh?: number;
  features: string[];
  notes: string;
  defects: string[];
  serviceHistory: ServiceHistory;
  previousOwners: number;
  accidentFree: boolean;
  mfkUntil: string;
  photos: VehiclePhoto[];
  wishMakes: string[];
  wishBodies: Body[];
  wishFuels: Fuel[];
  wishMinYear?: number;
  wishMaxMileageKm?: number;
  wishMaxCashOut?: number;
  wishNotes: string;
  askPremium: number;
}

export const EMPTY_FORM: ListingFormValues = {
  make: "VW",
  model: "",
  trim: "",
  firstRegistration: new Date(Date.now() - 3 * 365 * 86_400_000).toISOString().slice(0, 7),
  mileageKm: 60_000,
  fuel: "elektro",
  body: "suv",
  drivetrain: "front",
  powerPs: 150,
  listPriceNew: 45_000,
  condition: "gut",
  color: "",
  batterySoh: 95,
  features: [],
  notes: "",
  defects: [],
  serviceHistory: "lückenlos scheckheft",
  previousOwners: 1,
  accidentFree: true,
  mfkUntil: "",
  photos: [],
  wishMakes: [],
  wishBodies: [],
  wishFuels: [],
  wishNotes: "",
  askPremium: 0,
};

export function ListingForm({
  mode,
  vehicleId,
  initial,
  asOf,
  uploadsEnabled,
}: {
  mode: "create" | "edit";
  vehicleId?: string;
  initial: ListingFormValues;
  asOf: string;
  uploadsEnabled: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<ListingFormValues>(() => ({
    ...initial,
    features: normalizeFeatures(initial.features),
  }));
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const [defectDraft, setDefectDraft] = useState("");
  const [makeFilter, setMakeFilter] = useState("");

  function set<K extends keyof ListingFormValues>(key: K, value: ListingFormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  /** Modellvorschläge zur gewählten Marke — nur eine Hilfe, keine Pflicht. */
  const modelSuggestions = useMemo(() => modelsFor(v.make), [v.make]);

  /**
   * Beim Markenwechsel das Modell leeren: ein Modellname der alten Marke wäre
   * danach falsch. Nur bei einer tatsächlichen Änderung, damit das Laden eines
   * bestehenden Inserats nichts überschreibt.
   */
  /** Nur Merkmale zeigen, die zur gewählten Antriebsart passen. */
  const availableFeatures = useMemo(() => featuresFor(v.fuel), [v.fuel]);

  /** Gefilterte Markenliste für die Wunschliste; Ausgewählte bleiben sichtbar. */
  const visibleWishMakes = useMemo(() => {
    const q = makeFilter.trim().toLowerCase();
    if (!q) return MAKE_NAMES;
    return MAKE_NAMES.filter(
      (m) => m.toLowerCase().includes(q) || v.wishMakes.includes(m),
    );
  }, [makeFilter, v.wishMakes]);

  /** Antriebswechsel: Merkmale abwerfen, die es dort nicht gibt. */
  function changeFuel(fuel: Fuel) {
    const allowed = new Set(featuresFor(fuel).map((f) => f.name));
    setV((prev) => ({
      ...prev,
      fuel,
      features: prev.features.filter((f) => allowed.has(f)),
      batterySoh: fuel === "elektro" ? (prev.batterySoh ?? 95) : prev.batterySoh,
    }));
  }

  function changeMake(make: string) {
    setV((prev) => (prev.make === make ? prev : { ...prev, make, model: "" }));
  }

  function toggle<T>(key: keyof ListingFormValues, list: T[], item: T) {
    const next = list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
    setV((prev) => ({ ...prev, [key]: next }));
  }

  /** Live-Bewertung während der Eingabe — dieselbe Rechnung wie später im Inserat. */
  const preview = useMemo<Vehicle | null>(() => {
    if (!v.model.trim()) return null;
    return {
      id: vehicleId ?? "vorschau",
      ownerId: "",
      make: v.make,
      model: v.model,
      trim: v.trim,
      year: Number(v.firstRegistration.slice(0, 4)),
      firstRegistration: `${v.firstRegistration}-15`,
      mileageKm: v.mileageKm,
      fuel: v.fuel,
      body: v.body,
      drivetrain: v.drivetrain,
      powerPs: v.powerPs,
      listPriceNew: v.listPriceNew,
      condition: v.condition,
      color: v.color,
      rangeKm: v.rangeKm,
      batterySoh: v.fuel === "elektro" ? v.batterySoh : undefined,
      features: v.features,
      photos: v.photos,
      notes: v.notes,
      defects: v.defects,
      serviceHistory: v.serviceHistory,
      previousOwners: v.previousOwners,
      accidentFree: v.accidentFree,
      mfkUntil: v.mfkUntil || undefined,
    };
  }, [v, vehicleId, asOf]);

  // Ohne brauchbare Erstzulassung und Neupreis gibt es keine Vorschau —
  // sonst zeigte das Formular einen Wert, der auf nichts beruht.
  const bewertbar = preview !== null && hasValuationInput(preview);
  const valuation = bewertbar ? valuate(preview!, asOf) : null;
  const history = bewertbar ? valueHistory(preview!, 18, 12, asOf) : null;

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    if (!uploadsEnabled) {
      setUploadError("Fotouploads sind auf dieser Installation nicht eingerichtet.");
      return;
    }
    if (v.photos.length + files.length > 10) {
      setUploadError("Höchstens zehn Fotos pro Inserat.");
      return;
    }

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 8 * 1024 * 1024) {
          setUploadError(`${file.name} ist grösser als 8 MB.`);
          continue;
        }
        const dimensions = await readDimensions(file);
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
        });
        setV((prev) => ({
          ...prev,
          photos: [...prev.photos, { url: blob.url, ...dimensions }],
        }));
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Der Upload ist fehlgeschlagen.");
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    setError(null);
    const payload = {
      ...v,
      notes: v.notes || undefined,
      mfkUntil: v.mfkUntil || "",
      wishNotes: v.wishNotes || undefined,
      rangeKm: v.rangeKm || undefined,
      batterySoh: v.fuel === "elektro" ? v.batterySoh : undefined,
    };
    start(async () => {
      const res =
        mode === "create"
          ? await createListingAction(payload)
          : await updateListingAction(vehicleId!, payload);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(`/auto/${res.vehicleId ?? vehicleId}`);
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,380px)]">
      <div className="min-w-0 space-y-6">
        {/* ---- Auto ---- */}
        <Card className="p-5 sm:p-6">
          <h2 className="text-base font-semibold text-ink">Auto</h2>
          <p className="mt-1 text-sm text-ink-3">
            Je genauer die Angaben, desto belastbarer die Bewertung — und desto weniger
            Rückfragen bekommst du.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Combobox
              label="Marke"
              value={v.make}
              onChange={changeMake}
              options={MAKE_NAMES}
              placeholder="Marke suchen …"
              emptyHint="Kein Treffer — deine Eingabe wird als eigene Marke übernommen."
              required
            />
            <Combobox
              label="Modell"
              value={v.model}
              onChange={(m) => set("model", m)}
              options={modelSuggestions}
              placeholder={modelSuggestions.length ? "Modell suchen …" : "Modell eintragen …"}
              hint={
                modelSuggestions.length
                  ? `${modelSuggestions.length} Modelle für ${v.make} — eigene Eingabe bleibt möglich.`
                  : `Für ${v.make} haben wir keine Modellliste — trag es von Hand ein.`
              }
              emptyHint="Kein Treffer — deine Eingabe wird übernommen."
              required
            />
          </div>

          <Field
            label="Version / Ausführung"
            className="mt-4"
            hint="Nur zur Beschreibung. Für den Wert zählen Neupreis, Leistung, Reichweite und Batteriezustand. Trag die Werte deiner Version dort ein."
          >
            <input
              value={v.trim}
              onChange={(e) => set("trim", e.target.value)}
              className={input}
              placeholder="z.B. Long Range Dual Motor"
            />
          </Field>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Erstzulassung">
              <input
                type="month"
                value={v.firstRegistration}
                max={asOf}
                onChange={(e) => set("firstRegistration", e.target.value)}
                className={input}
              />
            </Field>
            <Field label="Neupreis (CHF)" hint="Listenpreis deiner Version inklusive Sonderausstattung, wie damals bezahlt.">
              <input
                type="number"
                step={500}
                min={3000}
                value={v.listPriceNew}
                onChange={(e) => set("listPriceNew", Number(e.target.value))}
                className={input}
              />
            </Field>
            <Field label="Leistung (PS)">
              <input
                type="number"
                min={1}
                value={v.powerPs}
                onChange={(e) => set("powerPs", Number(e.target.value))}
                className={input}
              />
            </Field>
          </div>

          <Field label={`Kilometerstand — ${km(v.mileageKm)}`} className="mt-4">
            <input
              type="range"
              min={0}
              max={300_000}
              step={1_000}
              value={v.mileageKm}
              onChange={(e) => set("mileageKm", Number(e.target.value))}
              className="w-full accent-marke"
            />
          </Field>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Antrieb">
              <select
                value={v.fuel}
                onChange={(e) => changeFuel(e.target.value as Fuel)}
                className={input}
              >
                {FUELS.map((f) => (
                  <option key={f} value={f}>
                    {label.fuel(f)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Karosserie">
              <select
                value={v.body}
                onChange={(e) => set("body", e.target.value as Body)}
                className={input}
              >
                {BODIES.map((b) => (
                  <option key={b} value={b}>
                    {label.body(b)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Antriebsart">
              <select
                value={v.drivetrain}
                onChange={(e) => set("drivetrain", e.target.value as ListingFormValues["drivetrain"])}
                className={input}
              >
                {DRIVETRAINS.map((d) => (
                  <option key={d} value={d}>
                    {label.drive(d)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {(v.fuel === "elektro" || v.fuel === "hybrid") && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Reichweite WLTP (km)">
                <input
                  type="number"
                  min={0}
                  value={v.rangeKm ?? ""}
                  onChange={(e) => set("rangeKm", e.target.value ? Number(e.target.value) : undefined)}
                  className={input}
                />
              </Field>
              {v.fuel === "elektro" && (
                <Field
                  label={`Batteriezustand — ${v.batterySoh ?? 95} % SoH`}
                  hint="Aus dem Batteriezertifikat oder der Auto-App."
                >
                  <input
                    type="range"
                    min={50}
                    max={100}
                    value={v.batterySoh ?? 95}
                    onChange={(e) => set("batterySoh", Number(e.target.value))}
                    className="w-full accent-marke"
                  />
                </Field>
              )}
            </div>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Zustand">
              <select
                value={v.condition}
                onChange={(e) => set("condition", e.target.value as Condition)}
                className={input}
              >
                {CONDITIONS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Serviceheft">
              <select
                value={v.serviceHistory}
                onChange={(e) => set("serviceHistory", e.target.value as ServiceHistory)}
                className={input}
              >
                {SERVICE_HISTORIES.map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </select>
            </Field>
            <Field label="Anzahl Halter">
              <input
                type="number"
                min={1}
                max={20}
                value={v.previousOwners}
                onChange={(e) => set("previousOwners", Number(e.target.value))}
                className={input}
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Farbe">
              <input value={v.color} onChange={(e) => set("color", e.target.value)} className={input} />
            </Field>
            <Field label="MFK gültig bis">
              <input
                type="date"
                value={v.mfkUntil}
                onChange={(e) => set("mfkUntil", e.target.value)}
                className={input}
              />
            </Field>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={v.accidentFree}
              onChange={(e) => set("accidentFree", e.target.checked)}
              className="accent-marke"
            />
            Unfallfrei
          </label>

          <FieldGroup
            label="Ausstattung"
            className="mt-5"
            hint="Für die Beschreibung und die Suche. Auf den Wert zählt sie nicht noch einmal: sie steckt schon im Neupreis, den du eingetragen hast."
          >
            <div className="flex flex-wrap gap-1.5">
              {availableFeatures.map((f) => (
                <Chip
                  key={f.name}
                  active={v.features.includes(f.name)}
                  onClick={() => toggle("features", v.features, f.name)}
                  title={f.hint}
                >
                  {f.name}
                </Chip>
              ))}
            </div>
          </FieldGroup>

          <FieldGroup label="Bekannte Mängel" className="mt-5" hint="Offen angeben — das schafft Vertrauen und spart Rückfragen bei der Übergabe.">
            <div className="flex gap-2">
              <input
                value={defectDraft}
                onChange={(e) => setDefectDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (defectDraft.trim()) {
                      set("defects", [...v.defects, defectDraft.trim()]);
                      setDefectDraft("");
                    }
                  }
                }}
                className={input}
                placeholder="z.B. Steinschlag Frontscheibe"
              />
              <button
                type="button"
                onClick={() => {
                  if (defectDraft.trim()) {
                    set("defects", [...v.defects, defectDraft.trim()]);
                    setDefectDraft("");
                  }
                }}
                className="shrink-0 rounded-lg border border-line-strong px-3 text-sm text-ink-2 hover:text-ink"
              >
                Hinzufügen
              </button>
            </div>
            {v.defects.length > 0 && (
              <ul className="mt-2 space-y-1">
                {v.defects.map((d, i) => (
                  <li key={`${d}-${i}`} className="flex items-center gap-2 text-sm text-warn">
                    <span>· {d}</span>
                    <button
                      type="button"
                      onClick={() => set("defects", v.defects.filter((_, j) => j !== i))}
                      className="text-ink-3 hover:text-bad"
                      aria-label={`${d} entfernen`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </FieldGroup>

          <Field label="Beschreibung" className="mt-5">
            <textarea
              value={v.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={4}
              maxLength={2000}
              className={`${input} resize-none`}
              placeholder="Wartungshistorie, Besonderheiten, warum du tauschen möchtest …"
            />
          </Field>
        </Card>

        {/* ---- Fotos ---- */}
        <Card className="p-5 sm:p-6">
          <h2 className="text-base font-semibold text-ink">Fotos</h2>
          <p className="mt-1 text-sm text-ink-3">
            Bis zu zehn Bilder, je höchstens 8 MB. Ohne Fotos zeigen wir eine schematische
            Darstellung.
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            {v.photos.map((p, i) => (
              <div key={p.url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={`Foto ${i + 1}`}
                  className="h-24 w-36 rounded-lg border border-line object-cover"
                />
                <button
                  type="button"
                  onClick={() => set("photos", v.photos.filter((_, j) => j !== i))}
                  className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full border border-line bg-surface text-sm text-ink-2 shadow hover:text-bad"
                  aria-label={`Foto ${i + 1} entfernen`}
                >
                  ×
                </button>
              </div>
            ))}
            <label
              className={`grid h-24 w-36 cursor-pointer place-items-center rounded-lg border border-dashed text-xs ${
                uploadsEnabled
                  ? "border-line-strong text-ink-3 hover:border-marke hover:text-marke"
                  : "border-line text-ink-3 opacity-60"
              }`}
            >
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                multiple
                className="sr-only"
                disabled={!uploadsEnabled || uploading}
                onChange={(e) => handleFiles(e.target.files)}
              />
              {uploading ? "Lädt …" : "+ Foto"}
            </label>
          </div>
          {uploadError && <p className="mt-2 text-sm text-bad">{uploadError}</p>}
          {!uploadsEnabled && (
            <p className="mt-2 text-xs text-ink-3">
              Fotospeicher ist nicht konfiguriert (BLOB_READ_WRITE_TOKEN fehlt).
            </p>
          )}
        </Card>

        {/* ---- Wunschliste ---- */}
        <Card className="p-5 sm:p-6">
          <h2 className="text-base font-semibold text-ink">Was suchst du im Tausch?</h2>
          <p className="mt-1 text-sm text-ink-3">
            Danach entscheidet sich, wem wir dein Auto zeigen. Je offener die Liste, desto mehr
            Treffer. Je enger, desto passender.
          </p>

          <FieldGroup
            label="Marken"
            className="mt-5"
            hint="Ohne Auswahl kommt jede Marke infrage."
          >
            {v.wishMakes.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {v.wishMakes.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggle("wishMakes", v.wishMakes, m)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-marke/45 bg-marke/30 px-2.5 py-1 text-xs text-marke"
                  >
                    {m}
                    <span aria-hidden>×</span>
                    <span className="sr-only">entfernen</span>
                  </button>
                ))}
              </div>
            )}
            <input
              value={makeFilter}
              onChange={(e) => setMakeFilter(e.target.value)}
              placeholder="Marken filtern …"
              className={`${input} mb-2`}
              aria-label="Marken filtern"
            />
            <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-line bg-surface-2 p-2">
              {visibleWishMakes.map((m) => (
                <Chip
                  key={m}
                  active={v.wishMakes.includes(m)}
                  onClick={() => toggle("wishMakes", v.wishMakes, m)}
                >
                  {m}
                </Chip>
              ))}
              {visibleWishMakes.length === 0 && (
                <p className="px-1 py-1 text-xs text-ink-3">Keine Marke passt zum Filter.</p>
              )}
            </div>
          </FieldGroup>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <FieldGroup label="Karosserie">
              <div className="flex flex-wrap gap-1.5">
                {BODIES.map((b) => (
                  <Chip
                    key={b}
                    active={v.wishBodies.includes(b)}
                    onClick={() => toggle("wishBodies", v.wishBodies, b)}
                  >
                    {label.body(b)}
                  </Chip>
                ))}
              </div>
            </FieldGroup>
            <FieldGroup label="Antrieb">
              <div className="flex flex-wrap gap-1.5">
                {FUELS.map((f) => (
                  <Chip
                    key={f}
                    active={v.wishFuels.includes(f)}
                    onClick={() => toggle("wishFuels", v.wishFuels, f)}
                  >
                    {label.fuel(f)}
                  </Chip>
                ))}
              </div>
            </FieldGroup>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Field label="Baujahr ab">
              <input
                type="number"
                min={1980}
                max={2100}
                value={v.wishMinYear ?? ""}
                onChange={(e) =>
                  set("wishMinYear", e.target.value ? Number(e.target.value) : undefined)
                }
                className={input}
                placeholder="egal"
              />
            </Field>
            <Field label="Höchstens km">
              <input
                type="number"
                min={0}
                step={5000}
                value={v.wishMaxMileageKm ?? ""}
                onChange={(e) =>
                  set("wishMaxMileageKm", e.target.value ? Number(e.target.value) : undefined)
                }
                className={input}
                placeholder="egal"
              />
            </Field>
            <Field
              label="Ausgleich (CHF)"
              hint="Positiv: du zahlst so viel drauf. Negativ: du willst so viel erhalten."
            >
              <input
                type="number"
                step={500}
                value={v.wishMaxCashOut ?? ""}
                onChange={(e) =>
                  set("wishMaxCashOut", e.target.value ? Number(e.target.value) : undefined)
                }
                className={input}
                placeholder="egal"
              />
            </Field>
          </div>

          <Field label="Anmerkung zur Wunschliste" className="mt-4">
            <input
              value={v.wishNotes}
              onChange={(e) => set("wishNotes", e.target.value)}
              className={input}
              placeholder="z.B. Anhängerkupplung ist Bedingung"
            />
          </Field>
        </Card>
      </div>

      {/* ---- Vorschau ---- */}
      <div className="min-w-0 space-y-5 lg:sticky lg:top-24 lg:self-start">
        <Card className="overflow-hidden">
          {v.photos[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.photos[0].url} alt="" className="aspect-[16/9] w-full object-cover" />
          ) : (
            <VehicleVisual
              id={vehicleId ?? "vorschau"}
              body={v.body}
              className="aspect-[16/9] w-full"
              label={`${v.firstRegistration.slice(0, 4)} · ${label.fuel(v.fuel)}`}
            />
          )}
          <div className="p-5">
            <p className="text-[11px] uppercase tracking-wider text-ink-3">Live-Bewertung</p>
            {valuation ? (
              <>
                <p className="mt-1 text-3xl betrag text-ink">
                  {chf(valuation.value)}
                </p>
                <p className="mt-1 text-xs text-ink-3 tabular">
                  Spanne {chf(valuation.low)} – {chf(valuation.high)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone={valuation.confidence > 0.75 ? "good" : "warn"}>
                    {Math.round(valuation.confidence * 100)} % Zuverlässigkeit
                  </Badge>
                  <Badge>
                    {Math.round((valuation.value / v.listPriceNew) * 100)} % vom Neupreis
                  </Badge>
                </div>
                {history && (
                  <div className="mt-5">
                    <ValueChart points={history} />
                  </div>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-3">
                Gib Modell und Eckdaten ein — die Bewertung erscheint sofort.
              </p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          {error && (
            <p role="alert" className="mb-3 rounded-lg border border-bad/35 bg-bad/12 p-3 text-sm text-bad">
              {error}
            </p>
          )}
          <button
            onClick={submit}
            disabled={pending || !v.model.trim()}
            className="w-full rounded-lg bg-marke py-2.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi disabled:opacity-50"
          >
            {pending
              ? "Wird gespeichert …"
              : mode === "create"
                ? "Inserat veröffentlichen"
                : "Änderungen speichern"}
          </button>
          <p className="mt-2 text-center text-[11px] text-ink-3">
            Du kannst alles später jederzeit anpassen.
          </p>
          <Link
            href="/garage"
            className="mt-3 block text-center text-sm text-ink-3 hover:text-ink"
          >
            Abbrechen
          </Link>
        </Card>
      </div>
    </div>
  );
}

const input =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-marke";

/** Für genau ein Eingabefeld — das umschliessende label verbindet Text und Feld. */
function Field({
  label: l,
  children,
  hint,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-3">
        {l}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

/**
 * Für Gruppen mehrerer Bedienelemente. Ein label darf nur ein einziges
 * Formularfeld umschliessen — bei Schaltflächengruppen ist fieldset/legend
 * die richtige Auszeichnung, sonst verschwinden die Buttons aus dem
 * Accessibility-Baum.
 */
function FieldGroup({
  label: l,
  children,
  hint,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <fieldset className={`block ${className}`}>
      <legend className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-3">
        {l}
      </legend>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </fieldset>
  );
}

function Chip({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
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

/** Bildmasse aus der Datei lesen, damit das Layout nicht springt. */
function readDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 1600, height: 900 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
