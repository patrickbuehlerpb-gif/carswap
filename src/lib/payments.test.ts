import { describe, expect, it } from "vitest";
import { platformFee, toMinor, paymentParties } from "@/lib/payments";

describe("Zahlungsgebühr", () => {
  it("deckt den Stripe-Anteil, sodass der Nettobetrag ankommt", () => {
    const percent = 0.029;
    const fixed = 30;
    for (const chf of [100, 1_000, 4_500, 25_000, 120_000]) {
      const netto = toMinor(chf);
      const brutto = netto + platformFee(netto);
      const stripeBehaeltEin = Math.round(brutto * percent) + fixed;
      // Nach Stripes Abzug muss mindestens der Nettobetrag übrig bleiben.
      expect(brutto - stripeBehaeltEin).toBeGreaterThanOrEqual(netto);
      // Und nicht unnötig viel mehr — höchstens ein Franken Puffer.
      expect(brutto - stripeBehaeltEin - netto).toBeLessThanOrEqual(100);
    }
  });

  it("ist immer positiv und ganzzahlig", () => {
    for (const netto of [1, 50, 999, 1_000_000]) {
      const fee = platformFee(netto);
      expect(Number.isInteger(fee)).toBe(true);
      expect(fee).toBeGreaterThan(0);
    }
  });
});

describe("Wer zahlt an wen", () => {
  it("kehrt Zahler und Empfänger mit dem Vorzeichen um", () => {
    const basis = { initiatorId: "a", counterpartyId: "b" };
    expect(paymentParties({ ...basis, cashDelta: 0 })).toBeNull();
    expect(paymentParties({ ...basis, cashDelta: 500 })).toEqual({
      payerId: "a",
      payeeId: "b",
      amount: 500,
    });
    expect(paymentParties({ ...basis, cashDelta: -500 })).toEqual({
      payerId: "b",
      payeeId: "a",
      amount: 500,
    });
  });
});
