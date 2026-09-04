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
  it("liegt nie über dem Neupreis — auch Spanne und Prognoseband nicht", () => {
    const neuwertig = fahrzeug({
      firstRegistration: "2026-09-15",
      mileageKm: 0,
      condition: "neuwertig",
      serviceHistory: "lückenlos scheckheft",
      batterySoh: 100,
      features: ["Panoramadach", "Anhängerkupplung", "Adaptives Fahrwerk"],
    });
    const grenze = neuwertig.listPriceNew;
    expect(valueAt(neuwertig, undefined, STICHTAG)).toBeLessThanOrEqual(grenze);

    // Eine «realistische Spanne» über dem Neupreis würde genau der Zusage
    // widersprechen, für die der Deckel da ist.
    const res = valuate(neuwertig, STICHTAG);
    expect(res.high).toBeLessThanOrEqual(grenze);
    expect(res.low).toBeLessThanOrEqual(grenze);

    for (const p of valueHistory(neuwertig, 6, 12, STICHTAG)) {
      expect(p.value, `Wert im Monat ${p.month}`).toBeLessThanOrEqual(grenze);
      if (p.high !== undefined) expect(p.high, `Band im Monat ${p.month}`).toBeLessThanOrEqual(grenze);
    }
  });

  it("verliert schon mit der Zulassung spürbar an Wert", () => {
    // Ohne diesen Sprung begänne die Kurve waagrecht und der Deckel würde
    // die ersten Monate flachdrücken.
    const frisch = fahrzeug({ firstRegistration: "2026-09-15", mileageKm: 500 });
    const wert = valueAt(frisch, undefined, STICHTAG);
    expect(wert).toBeLessThan(frisch.listPriceNew * 0.95);
    expect(wert).toBeGreaterThan(frisch.listPriceNew * 0.75);
  });

  it("zeichnet auch die ersten Monate als fallende Kurve", () => {
    const jung = fahrzeug({
      firstRegistration: "2026-06-15",
      mileageKm: 3_000,
      condition: "neuwertig",
      serviceHistory: "lückenlos scheckheft",
    });
    const punkte = valueHistory(jung, 3, 0, STICHTAG);
    const werte = punkte.map((p) => p.value);
    // Keine zwei aufeinanderfolgenden Monate mit identischem Wert — genau das
    // war das Bild, als der Deckel die junge Kurve abgeschnitten hat.
    expect(new Set(werte).size).toBe(werte.length);
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

  it("fällt über Jahre hinweg, Monat für Monat höchstens leicht steigend", () => {
    // Das Marktrauschen (±1.2 %) kann einzelne Monate anheben. Geprüft wird
    // deshalb beides: der Trend über Jahre streng fallend, und kein einzelner
    // Monat, der um mehr als das Rauschen nach oben ausbricht.
    const v = fahrzeug({ firstRegistration: "2019-02-15", fuel: "benzin", make: "BMW" });
    const punkte = valueHistory(v, 60, 24, STICHTAG);
    expect(punkte.length).toBeGreaterThan(70);

    for (let i = 1; i < punkte.length; i++) {
      const anstieg = punkte[i].value - punkte[i - 1].value;
      expect(anstieg, `Sprung nach oben bei ${punkte[i].month}`).toBeLessThan(
        punkte[i - 1].value * 0.03,
      );
    }

    const jahresschritte = ["2020-06", "2022-06", "2024-06", "2026-06", "2028-06"].map((m) =>
      valueAt(v, m, STICHTAG),
    );
    for (let i = 1; i < jahresschritte.length; i++) {
      expect(jahresschritte[i]).toBeLessThan(jahresschritte[i - 1]);
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

  it("hält den Restposten in der Grössenordnung, die sein Name behauptet", () => {
    // Er darf Marktindex, Streuung (±1.2 %) und Rundung enthalten — mehr
    // nicht. Sonst versteckt sich dort ein Posten, den niemand benennt.
    for (const v of [
      fahrzeug({ firstRegistration: "2026-09-15", condition: "neuwertig", mileageKm: 0 }),
      fahrzeug({ firstRegistration: "2022-01-15", mileageKm: 80_000 }),
      fahrzeug({ fuel: "benzin", make: "Porsche", listPriceNew: 150_000, mileageKm: 5_000 }),
    ]) {
      const res = valuate(v, STICHTAG);
      const rest = res.breakdown.find((f) => f.label.startsWith("Marktlage"));
      if (!rest) continue;
      // Index kann bis 35 % ausmachen, Rauschen 1.2 %, Rundung 25 Franken.
      expect(Math.abs(rest.amount), `Restposten bei ${v.make} ${v.model}`).toBeLessThanOrEqual(
        res.value * 0.37 + 50,
      );
    }
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
