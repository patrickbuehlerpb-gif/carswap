import type { Fuel } from "../types";

/**
 * Ausstattungsmerkmale — eine einzige Quelle für Formular und Bewertung.
 *
 * Bewusst **markenneutral** beschrieben. Ein Bezeichner wie «Bowers & Wilkins»
 * suggeriert, dass es diese Ausstattung beim gewählten Fahrzeug gibt, was pro
 * Modell verschieden und meist falsch ist. Für den Wert zählt ohnehin nur, dass
 * ein aufpreispflichtiges Soundsystem verbaut ist, nicht welche Marke.
 *
 * Die Beträge entsprechen dem ungefähren Neupreis-Aufschlag in Franken. Die
 * Bewertung schreibt sie mit derselben Restwertquote ab wie das Fahrzeug.
 */
export interface FeatureDef {
  name: string;
  value: number;
  /** Leer bedeutet: für jede Antriebsart sinnvoll. */
  fuels?: Fuel[];
  hint?: string;
}

export const FEATURES: FeatureDef[] = [
  { name: "Anhängerkupplung", value: 900, hint: "fest oder abnehmbar" },
  { name: "Panoramadach", value: 700 },
  { name: "Luftfederung", value: 1_400 },
  { name: "Adaptives Fahrwerk", value: 600 },
  { name: "Head-up-Display", value: 500 },
  { name: "Matrix- oder Laserlicht", value: 500 },
  { name: "360°-Kamera", value: 400 },
  { name: "Adaptiver Tempomat", value: 400, hint: "mit Spurführung" },
  { name: "Premium-Soundsystem", value: 600, hint: "aufpreispflichtige Anlage" },
  { name: "Ledersitze", value: 700 },
  { name: "Sitzheizung", value: 250 },
  { name: "Sitzbelüftung", value: 350 },
  { name: "Massagesitze", value: 600 },
  { name: "Elektrische Heckklappe", value: 300 },
  { name: "Standheizung", value: 600, fuels: ["benzin", "diesel", "hybrid"] },
  { name: "Winterräder", value: 1_100, hint: "zweiter Radsatz dabei" },
  { name: "Wärmepumpe", value: 800, fuels: ["elektro", "hybrid"] },
  { name: "Schnellladen ab 150 kW", value: 700, fuels: ["elektro"] },
  { name: "Dreiphasiges Laden (11 kW)", value: 400, fuels: ["elektro"] },
];

/**
 * Frühere Bezeichnungen auf die heutigen abbilden, damit bestehende Inserate
 * ihren Wert behalten. `null` heisst: fällt ersatzlos weg.
 */
const LEGACY: Record<string, string | null> = {
  "Harman Kardon": "Premium-Soundsystem",
  "Bowers & Wilkins": "Premium-Soundsystem",
  Burmester: "Premium-Soundsystem",
  "Pilot Assist": "Adaptiver Tempomat",
  "Matrix-LED": "Matrix- oder Laserlicht",
  Sportfahrwerk: "Adaptives Fahrwerk",
  "AHK abnehmbar": "Anhängerkupplung",
  // Der Antrieb ist ein eigenes Feld — als Ausstattung wäre er doppelt gezählt.
  Allrad: null,
};

const valueByName = new Map(FEATURES.map((f) => [f.name, f.value]));

/** Merkmale, die zur gewählten Antriebsart passen. */
export function featuresFor(fuel: Fuel): FeatureDef[] {
  return FEATURES.filter((f) => !f.fuels || f.fuels.includes(fuel));
}

/**
 * Bringt eine gespeicherte Liste auf die heutigen Bezeichnungen und entfernt
 * Doppelungen — «Anhängerkupplung» und «AHK abnehmbar» sind dieselbe Sache.
 */
export function normalizeFeatures(features: string[]): string[] {
  const out: string[] = [];
  for (const raw of features) {
    const mapped = raw in LEGACY ? LEGACY[raw] : raw;
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/** Kennen wir dieses Merkmal? Frei eingetippte Texte sollen nichts wert sein. */
export function isKnownFeature(name: string): boolean {
  const mapped = name in LEGACY ? LEGACY[name] : name;
  return mapped !== null && valueByName.has(mapped);
}


