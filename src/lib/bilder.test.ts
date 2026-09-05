import { describe, expect, it } from "vitest";
import { MAX_KANTE, zielMasse } from "@/lib/bilder";

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
