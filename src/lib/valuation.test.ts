import { describe, expect, it } from "vitest";
import { valuate, valueAt, valueHistory } from "@/lib/valuation";
import { isKnownFeature, normalizeFeatures } from "@/lib/data/features";
import type { Vehicle } from "@/lib/types";

function fahrzeug(over: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "v1",
    ownerId: "u1",
    make: "Polestar",
    model: "4",
    trim: "",
    year: 2023,
    firstRegistration: "2023-03-15",
    mileageKm: 30_000,
    fuel: "elektro",
    body: "suv",
    drivetrain: "heck",
    powerPs: 272,
    listPriceNew: 60_000,
    condition: "gut",
    color: "Schwarz",
    features: [],
    photos: [],
    serviceHistory: "lückenlos scheckheft",
    previousOwners: 1,
    accidentFree: true,
    ...over,
  } as Vehicle;
}

const STICHTAG = "2026-09";

describe("Wertgrenzen", () => {
  it("liegt nie über dem Neupreis, auch im besten Fall", () => {
    const neuwertig = fahrzeug({
      firstRegistration: "2026-09-15",
      mileageKm: 0,
      condition: "neuwertig",
      serviceHistory: "lückenlos scheckheft",
      batterySoh: 100,
      features: ["Panoramadach", "Anhängerkupplung", "Adaptives Fahrwerk"],
    });
    expect(valueAt(neuwertig, undefined, STICHTAG)).toBeLessThanOrEqual(neuwertig.listPriceNew);
  });

  it("bleibt bei sehr alten und sehr abgefahrenen Fahrzeugen positiv", () => {
    for (const v of [
      fahrzeug({ firstRegistration: "1996-01-15", mileageKm: 900_000, condition: "gebraucht" }),
      fahrzeug({ firstRegistration: "1996-01-15", mileageKm: 0 }),
      fahrzeug({ listPriceNew: 3_000, mileageKm: 500_000 }),
    ]) {
      const wert = valueAt(v, undefined, STICHTAG);
      expect(Number.isFinite(wert)).toBe(true);
      expect(wert).toBeGreaterThanOrEqual(500);
    }
  });

  it("fällt mit dem Alter monoton", () => {
    const v = fahrzeug({ firstRegistration: "2020-01-15" });
    let letzter = Infinity;
    for (const monat of ["2020-06", "2021-06", "2023-06", "2026-06", "2030-06"]) {
      const wert = valueAt(v, monat, STICHTAG);
      expect(wert).toBeLessThanOrEqual(letzter);
      letzter = wert;
    }
  });

  it("beachtet den Kilometerstand auch im Zulassungsmonat", () => {
    const vorfuehr = fahrzeug({ firstRegistration: "2026-09-15", mileageKm: 30_000 });
    const fabrikneu = fahrzeug({ firstRegistration: "2026-09-15", mileageKm: 0 });
    expect(valueAt(vorfuehr, undefined, STICHTAG)).toBeLessThan(
      valueAt(fabrikneu, undefined, STICHTAG),
    );
  });

  it("liefert für dieselbe Eingabe immer dasselbe Ergebnis", () => {
    const v = fahrzeug();
    const a = valueAt(v, undefined, STICHTAG);
    for (let i = 0; i < 5; i++) expect(valueAt(v, undefined, STICHTAG)).toBe(a);
  });
});

describe("Aufschlüsselung", () => {
  it("summiert sich exakt auf den ausgewiesenen Wert", () => {
    for (const v of [
      fahrzeug(),
      fahrzeug({ condition: "gebraucht", previousOwners: 4, accidentFree: false }),
      fahrzeug({ fuel: "benzin", batterySoh: undefined, defects: ["Kupplung"] }),
      fahrzeug({ features: ["Panoramadach", "Wärmepumpe"], mileageKm: 5_000 }),
    ]) {
      const res = valuate(v, STICHTAG);
      const summe = res.breakdown.reduce((n, f) => n + f.amount, v.listPriceNew);
      expect(summe).toBe(res.value);
    }
  });

  it("nennt den Restposten nicht mehr «Aktuelle Marktlage»", () => {
    const res = valuate(fahrzeug(), STICHTAG);
    expect(res.breakdown.map((f) => f.label)).not.toContain("Aktuelle Marktlage");
  });
});

describe("Ausstattung", () => {
  it("erkennt frei erfundene Bezeichnungen als unbekannt", () => {
    expect(isKnownFeature("Einhorn-Paket")).toBe(false);
    expect(isKnownFeature("Panoramadach")).toBe(true);
    // Alte Schreibweisen bleiben gültig
    expect(isKnownFeature("Harman Kardon")).toBe(true);
  });

  it("verändert den Schätzwert überhaupt nicht — sie steckt im Neupreis", () => {
    const ohne = valueAt(fahrzeug({ features: [] }), undefined, STICHTAG);
    for (const liste of [
      ["Einhorn-Paket", "Sportsitze deluxe"],
      ["Panoramadach", "Anhängerkupplung", "Adaptives Fahrwerk"],
    ]) {
      expect(valueAt(fahrzeug({ features: liste }), undefined, STICHTAG)).toBe(ohne);
    }
  });

  it("führt Anhängerkupplung und alte Schreibweise zusammen", () => {
    expect(normalizeFeatures(["Anhängerkupplung", "AHK abnehmbar"])).toEqual(["Anhängerkupplung"]);
    expect(normalizeFeatures(["Harman Kardon", "Bowers & Wilkins"])).toEqual([
      "Premium-Soundsystem",
    ]);
  });

  it("lässt Allrad aussen vor, weil der Antrieb ein eigenes Feld ist", () => {
    expect(normalizeFeatures(["Allrad"])).toEqual([]);
  });
});

describe("Verlauf", () => {
  it("liefert Vergangenheit und Prognose in aufsteigenden Monaten", () => {
    const punkte = valueHistory(fahrzeug(), 12, 12, STICHTAG);
    expect(punkte.length).toBe(25);
    const monate = punkte.map((p) => p.month);
    expect([...monate].sort()).toEqual(monate);
    expect(punkte.filter((p) => p.forecast).length).toBe(12);
  });

  it("bleibt bei ungültiger Erstzulassung ohne Absturz", () => {
    const kaputt = fahrzeug({ firstRegistration: "" });
    expect(() => valueHistory(kaputt, 6, 6, STICHTAG)).not.toThrow();
    expect(() => valuate(kaputt, STICHTAG)).not.toThrow();
  });
});
