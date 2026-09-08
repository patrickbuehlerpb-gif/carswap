import { describe, expect, it } from "vitest";
import { MAX_KANTE, RAHMEN_BREIT, RAHMEN_SCHMAL, rahmenVerhaeltnis, zielMasse } from "@/lib/bilder";

/**
 * Nur die Rechnung — das Verkleinern selbst braucht eine Leinwand und läuft
 * deshalb im Browser. Die Rechnung ist aber die Stelle, an der ein Fehler
 * unbemerkt bliebe: ein verzerrtes Foto sieht man erst im Inserat.
 */
describe("Zielmasse", () => {
  it("lässt kleine Bilder unangetastet", () => {
    expect(zielMasse(800, 600)).toEqual({ width: 800, height: 600 });
    expect(zielMasse(MAX_KANTE, 100)).toEqual({ width: MAX_KANTE, height: 100 });
  });

  it("begrenzt die längste Kante", () => {
    expect(zielMasse(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    // Hochkant: begrenzt wird die Höhe, nicht pauschal die Breite.
    expect(zielMasse(3000, 4000)).toEqual({ width: 1500, height: 2000 });
  });

  it("behält das Seitenverhältnis", () => {
    for (const [w, h] of [
      [4032, 3024],
      [6000, 4000],
      [2560, 1440],
      [1080, 1920],
    ]) {
      const ziel = zielMasse(w, h);
      expect(Math.abs(ziel.width / ziel.height - w / h)).toBeLessThan(0.01);
    }
  });

  it("rechnet keine Kante auf null herunter", () => {
    // Ein sehr breites Panorama: die kurze Kante darf nicht verschwinden.
    const ziel = zielMasse(20_000, 5);
    expect(ziel.width).toBe(2000);
    expect(ziel.height).toBeGreaterThanOrEqual(1);
  });

  it("nimmt eine abweichende Obergrenze an", () => {
    expect(zielMasse(4000, 2000, 1000)).toEqual({ width: 1000, height: 500 });
  });
});

/**
 * Der Rahmen auf der Fahrzeugseite. Hochkant fotografierte Autos waren dort
 * auf einen Streifen von 42 % Höhe beschnitten — Dach und Räder fehlten.
 */
describe("Rahmen für ein Foto", () => {
  it("nimmt die Form des Bildes an", () => {
    expect(rahmenVerhaeltnis(1200, 900)).toBeCloseTo(4 / 3);
    expect(rahmenVerhaeltnis(1500, 1000)).toBeCloseTo(1.5);
  });

  it("lässt ein hochkantes Bild hochkant werden — bis zum Quadrat", () => {
    // Das übliche Telefonfoto. Vorher 16:9, jetzt so hoch wie erlaubt.
    expect(rahmenVerhaeltnis(1125, 1500)).toBe(RAHMEN_SCHMAL);
    expect(rahmenVerhaeltnis(1000, 3000)).toBe(RAHMEN_SCHMAL);
  });

  it("lässt ein sehr breites Bild nicht zum Schlitz werden", () => {
    expect(rahmenVerhaeltnis(4000, 1000)).toBe(RAHMEN_BREIT);
  });

  it("fällt bei unbrauchbaren Massen auf den breiten Rahmen zurück", () => {
    // Fehlende Masse dürfen die Seite nicht auf Höhe null zusammenfallen
    // lassen — dann sähe man gar kein Bild mehr.
    expect(rahmenVerhaeltnis(0, 0)).toBe(RAHMEN_BREIT);
    expect(rahmenVerhaeltnis(NaN, 100)).toBe(RAHMEN_BREIT);
  });
});
