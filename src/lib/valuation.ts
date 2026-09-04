
import { group, label } from "./format";
import type { Fuel, HistoryPoint, Valuation, ValuationFactor, Vehicle } from "./types";

/**
 * Stichtag der Bewertung. Das Modell arbeitet auf Monatsebene, deshalb reicht
 * der laufende Monat — in UTC bestimmt, damit Server und Client dasselbe
 * Ergebnis liefern und keine Hydration-Mismatches entstehen.
 */
export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Erster Tag des Stichtagsmonats, für Datumsarithmetik. */
export function asOfIso(asOf?: string): string {
  return `${asOf ?? currentMonth()}-01`;
}

/** Normale Jahresfahrleistung, an der die km-Korrektur gemessen wird. */
const NORM_KM_PER_YEAR = 15_000;

/** Wie schnell ein Segment an Wert verliert: r(t) = exp(-lambda * t^0.7). */
const LAMBDA: Record<Fuel, number> = {
  elektro: 0.33,
  hybrid: 0.26,
  benzin: 0.24,
  diesel: 0.27,
};

/** Kosten je Kilometer Mehrlaufleistung gegenüber der Norm. */
const COST_PER_EXTRA_KM: Record<Fuel, number> = {
  elektro: 0.1,
  hybrid: 0.09,
  benzin: 0.085,
  diesel: 0.075,
};

/**
 * Marken mit überdurchschnittlicher Wertstabilität bekommen einen Bonus auf die
 * Restwertkurve, schwache Marken einen Abschlag. Faktor auf lambda.
 */
const BRAND_STRENGTH: Record<string, number> = {
  Porsche: 0.72,
  Toyota: 0.82,
  Lexus: 0.85,
  BMW: 0.95,
  Audi: 0.98,
  "Mercedes-Benz": 0.98,
  Skoda: 0.97,
  VW: 0.98,
  Volvo: 1.02,
  Tesla: 1.12,
  Polestar: 1.18,
  Zeekr: 1.22,
  NIO: 1.28,
  Cupra: 1.05,
  Hyundai: 1.04,
  Kia: 1.0,
  Renault: 1.1,
  Peugeot: 1.09,
  Ford: 1.08,
};

const CONDITION_FACTOR: Record<Vehicle["condition"], number> = {
  neuwertig: 1.04,
  "sehr gut": 1.01,
  gut: 1.0,
  gebraucht: 0.94,
};

const SERVICE_FACTOR: Record<Vehicle["serviceHistory"], number> = {
  "lückenlos scheckheft": 1.02,
  teilweise: 0.985,
  keine: 0.95,
};

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen für Zeit                                            */
/* ------------------------------------------------------------------ */

/**
 * Datumsangaben wie «2024-03-15» liest JavaScript als UTC-Mitternacht. Mit
 * den lokalen Gettern läge das in westlichen Zeitzonen im Vormonat — Server
 * und Browser kämen auf verschiedene Werte und React verwürfe die Seite.
 * Deshalb durchgehend UTC.
 */
function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Ohne brauchbare Erstzulassung lässt sich nichts rechnen. */
export function hasValuationInput(vehicle: Pick<Vehicle, "firstRegistration" | "listPriceNew">): boolean {
  return (
    Boolean(vehicle.firstRegistration) &&
    !Number.isNaN(new Date(vehicle.firstRegistration).getTime()) &&
    Number.isFinite(vehicle.listPriceNew) &&
    vehicle.listPriceNew > 0
  );
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  const names = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  return `${names[Number(m) - 1]} ${y.slice(2)}`;
}

/** Deterministisches Rauschen: gleicher Input, gleicher Output. */
function noise(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // auf -1..1 abbilden
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/* ------------------------------------------------------------------ */
/* Marktindex                                                          */
/* ------------------------------------------------------------------ */

/**
 * Segmentweite Marktbewegung, die über die normale Alterung hinausgeht —
 * normiert auf 1.0 am Stichtag. Elektroautos haben 2024 einen zusätzlichen
 * Preisrutsch erlebt (Neuwagen-Rabattschlacht, Förderstopp), der sich erst
 * 2025/26 beruhigt hat.
 */
const EV_INDEX: Array<[string, number]> = [
  ["2022-01", 1.34],
  ["2023-01", 1.28],
  ["2023-07", 1.21],
  ["2024-01", 1.13],
  ["2024-07", 1.05],
  ["2025-01", 1.015],
  ["2025-07", 1.005],
  ["2026-09", 1.0],
  ["2027-09", 0.982],
  ["2028-09", 0.975],
];

const ICE_INDEX: Array<[string, number]> = [
  ["2022-01", 1.12],
  ["2023-01", 1.09],
  ["2024-01", 1.05],
  ["2025-01", 1.02],
  ["2026-09", 1.0],
  ["2027-09", 0.995],
  ["2028-09", 0.99],
];

function marketIndex(month: string, fuel: Fuel): number {
  const table = fuel === "elektro" ? EV_INDEX : fuel === "hybrid" ? EV_INDEX : ICE_INDEX;
  const t = monthsBetween("2020-01-01", `${month}-01`);
  const pts = table.map(([m, v]) => [monthsBetween("2020-01-01", `${m}-01`), v] as const);

  if (t <= pts[0][0]) return pts[0][1];
  if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, v0] = pts[i];
    const [t1, v1] = pts[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0);
      const raw = v0 + (v1 - v0) * f;
      // Hybride bewegen sich nur halb so stark wie reine Stromer
      return fuel === "hybrid" ? 1 + (raw - 1) * 0.5 : raw;
    }
  }
  return 1;
}

/* ------------------------------------------------------------------ */
/* Kernbewertung                                                       */
/* ------------------------------------------------------------------ */

/** Restwertquote nach t Jahren, rein altersbedingt. */
function retention(ageYears: number, fuel: Fuel, make: string): number {
  const lambda = LAMBDA[fuel] * (BRAND_STRENGTH[make] ?? 1);
  const t = Math.max(0, ageYears);
  return Math.exp(-lambda * Math.pow(t, 0.7));
}

/**
 * Bewertet ein Fahrzeug zu einem beliebigen Stichtag. `atMonth` im Format
 * YYYY-MM; ohne Angabe wird der aktuelle Stichtag verwendet.
 */
/**
 * Die Ausstattung geht NICHT als eigener Posten ein. Der Neupreis, den die
 * Besitzerin einträgt, ist der damals bezahlte Preis der konfigurierten
 * Version — die Sonderausstattung steckt also bereits darin. Sie ein zweites
 * Mal zu addieren, hat den Wert gut ausgestatteter Fahrzeuge doppelt gezählt.
 * Für Matching und Beschreibung bleibt die Liste erhalten.
 */
export function valueAt(vehicle: Vehicle, atMonth?: string, asOf?: string): number {
  const month = atMonth ?? asOf ?? currentMonth();
  const ageMonths = monthsBetween(vehicle.firstRegistration, `${month}-01`);
  const ageYears = ageMonths / 12;
  if (ageYears < 0) return vehicle.listPriceNew;

  // Kilometerstand zum Stichtag linear interpoliert bzw. fortgeschrieben.
  // Bei einer Zulassung im laufenden Monat gibt es keine Laufzeit, über die
  // sich etwas verteilen liesse — dann gilt der eingetragene Stand direkt,
  // sonst wäre ein Vorführwagen mit 30'000 km so gut wie fabrikneu.
  const ageNowMonths = monthsBetween(vehicle.firstRegistration, asOfIso(asOf));
  const mileageAt =
    ageNowMonths <= 0
      ? vehicle.mileageKm
      : Math.max(0, (vehicle.mileageKm / ageNowMonths) * ageMonths);

  const base = vehicle.listPriceNew * retention(ageYears, vehicle.fuel, vehicle.make);

  // Laufleistungskorrektur gegenüber der Norm, gedeckelt auf ±18 %
  const expectedKm = NORM_KM_PER_YEAR * ageYears;
  const rawMileageAdj = -(mileageAt - expectedKm) * COST_PER_EXTRA_KM[vehicle.fuel];
  const mileageAdj = Math.max(-0.18 * base, Math.min(0.18 * base, rawMileageAdj));

  let value = base + mileageAdj;

  value *= CONDITION_FACTOR[vehicle.condition];
  value *= SERVICE_FACTOR[vehicle.serviceHistory];
  value *= 1 - Math.min(0.06, Math.max(0, vehicle.previousOwners - 1) * 0.012);
  if (!vehicle.accidentFree) value *= 0.88;

  if (vehicle.fuel === "elektro" && vehicle.batterySoh != null) {
    value *= 1 + ((vehicle.batterySoh - 95) / 100) * 0.6;
  }

  value -= (vehicle.defects?.length ?? 0) * 1200;

  value *= marketIndex(month, vehicle.fuel);

  // leichtes, aber stabiles Marktrauschen (±1.2 %)
  value *= 1 + noise(`${vehicle.id}:${month}`) * 0.012;

  // Ein gebrauchtes Fahrzeug ist höchstens so viel wert wie ein neues. Ohne
  // diesen Deckel hoben Zustand «neuwertig», lückenloses Serviceheft und
  // Ausstattung den Schätzwert eines fast neuen Autos über den Listenpreis.
  const capped = Math.min(value, vehicle.listPriceNew);
  return Math.max(500, Math.round(capped / 50) * 50);
}

/** Volle Bewertung mit Aufschlüsselung für den Stichtag. */
export function valuate(vehicle: Vehicle, asOf?: string): Valuation {
  const ageYears = monthsBetween(vehicle.firstRegistration, asOfIso(asOf)) / 12;
  const base = vehicle.listPriceNew * retention(ageYears, vehicle.fuel, vehicle.make);
  const value = valueAt(vehicle, undefined, asOf);

  const expectedKm = NORM_KM_PER_YEAR * ageYears;
  const kmDelta = vehicle.mileageKm - expectedKm;
  const mileageAdj = Math.max(
    -0.18 * base,
    Math.min(0.18 * base, -kmDelta * COST_PER_EXTRA_KM[vehicle.fuel]),
  );

  const breakdown: ValuationFactor[] = [
    {
      // Gerundet, damit die Summe aller Posten exakt den Endwert ergibt —
      // sonst schleppt der Restposten einen Bruchteil mit.
      label: "Altersbedingter Wertverlust",
      amount: Math.round(base - vehicle.listPriceNew),
      hint: `${ageYears.toFixed(1)} Jahre seit Erstzulassung, Restwertquote ${(
        (base / vehicle.listPriceNew) * 100
      ).toFixed(0)} %`,
    },
    {
      label: kmDelta > 0 ? "Überdurchschnittliche Laufleistung" : "Unterdurchschnittliche Laufleistung",
      amount: Math.round(mileageAdj),
      hint: `${group(Math.abs(kmDelta))} km ${
        kmDelta > 0 ? "über" : "unter"
      } dem Schnitt von ${group(NORM_KM_PER_YEAR)} km/Jahr`,
    },
    {
      label: `Zustand: ${vehicle.condition}`,
      amount: Math.round(base * (CONDITION_FACTOR[vehicle.condition] - 1)),
      hint: "Bewertung durch Besitzer, mit Fotos belegt",
    },
    {
      label: `Serviceheft: ${vehicle.serviceHistory}`,
      amount: Math.round(base * (SERVICE_FACTOR[vehicle.serviceHistory] - 1)),
      hint: "Nachweisbare Wartung schafft Vertrauen im Wiederverkauf",
    },
  ];

  if (vehicle.previousOwners > 1) {
    breakdown.push({
      label: `${vehicle.previousOwners} Vorbesitzer`,
      amount: -Math.round(base * Math.min(0.06, (vehicle.previousOwners - 1) * 0.012)),
      hint: "Jeder zusätzliche Halter kostet rund 1.2 % Wert",
    });
  }

  if (!vehicle.accidentFree) {
    breakdown.push({
      label: "Unfallschaden dokumentiert",
      amount: -Math.round(base * 0.12),
      hint: "Reparierter Vorschaden, im Fahrzeugausweis vermerkt",
    });
  }

  if (vehicle.fuel === "elektro" && vehicle.batterySoh != null) {
    breakdown.push({
      label: `Batteriezustand ${vehicle.batterySoh} % SoH`,
      amount: Math.round(base * ((vehicle.batterySoh - 95) / 100) * 0.6),
      hint: "Auslesbar über Batteriezertifikat, wichtigster Einzelfaktor beim Stromer",
    });
  }

  if (vehicle.defects?.length) {
    breakdown.push({
      label: `Bekannte Mängel (${vehicle.defects.length})`,
      amount: -vehicle.defects.length * 1200,
      hint: vehicle.defects.join(", "),
    });
  }

  // Restposten: bündelt Marktindex, Streuung und Rundung, damit Listenpreis
  // plus alle ausgewiesenen Faktoren exakt den Endwert ergeben. Der Name sagt
  // das auch — vorher stand hier «Aktuelle Marktlage», obwohl der Index in
  // vielen Monaten exakt 1.000 ist und der Betrag fast nur aus Rundung bestand.
  const explained = breakdown.reduce((sum, f) => sum + f.amount, 0);
  const rest = Math.round(value - vehicle.listPriceNew - explained);
  const index = marketIndex(asOf ?? currentMonth(), vehicle.fuel);
  if (rest !== 0) {
    breakdown.push({
      label: "Marktlage, Streuung und Rundung",
      amount: rest,
      hint: `Marktindex ${index.toFixed(3)} für ${label.fuel(vehicle.fuel)}, dazu die Streuung des Modells und die Rundung auf 50`,
    });
  }

  // Je jünger und je gängiger das Fahrzeug, desto sicherer die Schätzung
  const comparables = Math.max(
    3,
    Math.round(48 * Math.exp(-ageYears / 5) * (BRAND_STRENGTH[vehicle.make] ?? 1)),
  );
  const confidence = Math.max(0.45, Math.min(0.93, 0.5 + comparables / 90));
  const spread = 0.14 - confidence * 0.08;

  return {
    vehicleId: vehicle.id,
    value,
    low: Math.round((value * (1 - spread)) / 50) * 50,
    high: Math.round((value * (1 + spread)) / 50) * 50,
    breakdown,
    confidence,
    comparables,
  };
}

/**
 * Wertverlauf: `pastMonths` Monate rückwirkend plus `forecastMonths` Prognose
 * mit Unsicherheitsband, das mit dem Horizont breiter wird.
 */
export function valueHistory(
  vehicle: Vehicle,
  pastMonths = 30,
  forecastMonths = 24,
  asOf?: string,
): HistoryPoint[] {
  const points: HistoryPoint[] = [];
  const today = asOfIso(asOf);
  const regMonths = monthsBetween(vehicle.firstRegistration, today);
  // nicht weiter zurück als bis zur Erstzulassung
  const start = -Math.min(pastMonths, Math.max(0, regMonths));

  for (let i = start; i <= forecastMonths; i++) {
    const month = addMonths(today, i).slice(0, 7);
    const value = valueAt(vehicle, month, asOf);
    if (i <= 0) {
      points.push({ month, value, forecast: false });
    } else {
      // Band wächst mit der Wurzel der Zeit — typisch für Prognoseunsicherheit
      const band = 0.02 + 0.022 * Math.sqrt(i);
      points.push({
        month,
        value,
        low: Math.round((value * (1 - band)) / 50) * 50,
        high: Math.round((value * (1 + band)) / 50) * 50,
        forecast: true,
      });
    }
  }
  return points;
}

/** Bester Verkaufszeitpunkt in den nächsten 24 Monaten, gemessen am Wertverlust pro Monat. */
export function depreciationPerMonth(vehicle: Vehicle, asOf?: string): number {
  const now = valueAt(vehicle, undefined, asOf);
  const in12 = valueAt(vehicle, addMonths(asOfIso(asOf), 12).slice(0, 7), asOf);
  return Math.round((now - in12) / 12);
}
