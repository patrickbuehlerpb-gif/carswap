/** Basiswährung der Plattform. Für andere Märkte hier zentral umstellen. */
export const CURRENCY = "CHF";

/**
 * Zahlen werden bewusst ohne `Intl` formatiert: Node und Browser liefern für
 * de-CH unterschiedliche Tausendertrennzeichen (' gegenüber ’), was zu
 * Hydration-Mismatches führt. Diese Implementierung ist auf beiden Seiten
 * identisch.
 */
const GROUP_SEP = "\u2019";

export function group(n: number): string {
  const neg = n < 0;
  const digits = Math.abs(Math.round(n)).toString();
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += GROUP_SEP;
    out += digits[i];
  }
  return neg ? `-${out}` : out;
}

const MONTHS_SHORT = [
  "Jan.", "Feb.", "März", "Apr.", "Mai", "Juni",
  "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez.",
];

export function chf(n: number, opts: { sign?: boolean; compact?: boolean } = {}): string {
  const rounded = Math.round(n);
  const abs = Math.abs(rounded);
  const body = opts.compact && abs >= 1000
    ? `${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k`
    : group(abs);
  const prefix = opts.sign ? (rounded > 0 ? "+" : rounded < 0 ? "−" : "±") : rounded < 0 ? "−" : "";
  return `${prefix}${CURRENCY} ${body}`;
}

export function km(n: number): string {
  return `${group(n)} km`;
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)} %`;
}

export function dateLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}. ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Kurzform für Chat-Zeitstempel, ebenfalls ohne Intl. */
export function dayMonth(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()}. ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/**
 * Der Stichtag wird bewusst übergeben statt hier gebildet: in einer
 * Client-Komponente käme sonst serverseitig ein anderes Datum heraus als im
 * Browser, und React verwirft die ganze Seite mit einem Hydration-Fehler.
 */
export function relativeAge(iso: string, now: string): string {
  const a = new Date(iso).getTime();
  const b = new Date(now).getTime();
  const days = Math.round((b - a) / 86_400_000);
  if (days < 0) return "heute";
  if (days < 1) return "heute";
  if (days === 1) return "gestern";
  if (days < 31) return `vor ${days} Tagen`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `vor ${months} Monat${months > 1 ? "en" : ""}`;
  const years = (days / 365).toFixed(1);
  return `vor ${years} Jahren`;
}

const BODY_LABEL: Record<string, string> = {
  suv: "SUV",
  limousine: "Limousine",
  kombi: "Kombi",
  kompakt: "Kompakt",
  coupe: "Coupé",
  van: "Van",
};

const FUEL_LABEL: Record<string, string> = {
  elektro: "Elektro",
  hybrid: "Hybrid",
  benzin: "Benzin",
  diesel: "Diesel",
};

const DRIVE_LABEL: Record<string, string> = {
  heck: "Heckantrieb",
  front: "Frontantrieb",
  allrad: "Allrad",
};

export const label = {
  body: (b: string) => BODY_LABEL[b] ?? b,
  fuel: (f: string) => FUEL_LABEL[f] ?? f,
  drive: (d: string) => DRIVE_LABEL[d] ?? d,
};

export function vehicleTitle(v: { make: string; model: string }): string {
  return `${v.make} ${v.model}`;
}

export function vehicleFullTitle(v: { make: string; model: string; trim?: string }): string {
  return `${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ""}`;
}

/**
 * Kuratierte Plattenfarben für die Fahrzeug-Visuals. Alle liegen in der
 * Palette der Marke und sind bewusst schwach gesättigt: die Platte ist der
 * Hintergrund einer technischen Zeichnung, nicht das Bild selbst. Eine feste
 * Liste statt frei berechneter Töne — so trifft die Oberfläche nie einen
 * schlammigen Zwischenton.
 */
const VISUAL_PLATES: string[] = [
  "#dce7e2",
  "#eae3d2",
  "#e3e6db",
  "#efe2ce",
  "#e2e0d9",
  "#dde5e6",
];

/**
 * Deterministische Plattenfarbe pro Fahrzeug — ersetzt Fotos, solange keine
 * hochgeladen sind, und bleibt zwischen Server- und Client-Rendering gleich.
 */
export function vehiclePlate(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return VISUAL_PLATES[h % VISUAL_PLATES.length];
}
