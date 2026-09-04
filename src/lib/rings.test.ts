import { describe, expect, it } from "vitest";
import { ringBalanced, ringClosed, ringTransfers } from "@/lib/rings";
import { ringCashSplit } from "@/lib/matching";

describe("ringCashSplit", () => {
  it("summiert sich immer zu null", () => {
    const faelle: [number, number, number][] = [
      [30_000, 30_000, 30_000],
      [42_310, 51_770, 28_940],
      [1, 2, 3],
      [99_999, 12_345, 67_891],
    ];
    for (const werte of faelle) {
      const cash = ringCashSplit(werte);
      expect(cash.reduce((a, b) => a + b, 0)).toBe(0);
    }
  });

  it("lässt jeden die Differenz zwischen erhaltenem und abgegebenem Wert zahlen", () => {
    // Position 0 gibt 30'000 ab und bekommt 35'000 — zahlt also 5'000 drauf.
    const [c0, c1, c2] = ringCashSplit([30_000, 40_000, 35_000]);
    expect(c0).toBe(5_000);
    expect(c1).toBe(-10_000);
    expect(c2).toBe(5_000);
  });

  it("rundet den dritten Betrag nicht separat", () => {
    // Zwei einzeln gerundete Beträge ergäben in der Summe 50 Franken Fehler.
    const cash = ringCashSplit([10_020, 10_030, 10_040]);
    expect(cash[0] + cash[1] + cash[2]).toBe(0);
  });
});

describe("ringTransfers", () => {
  it("lässt bei ausgeglichenem Ring nichts fliessen", () => {
    expect(ringTransfers([
      { userId: "a", cash: 0 },
      { userId: "b", cash: 0 },
      { userId: "c", cash: 0 },
    ])).toEqual([]);
  });

  it("führt einen Zahler zu einem Empfänger", () => {
    const t = ringTransfers([
      { userId: "a", cash: 5_000 },
      { userId: "b", cash: 0 },
      { userId: "c", cash: -5_000 },
    ]);
    expect(t).toEqual([{ payerId: "a", payeeId: "c", amount: 5_000 }]);
  });

  it("teilt einen Zahler auf zwei Empfänger auf", () => {
    const t = ringTransfers([
      { userId: "a", cash: 5_000 },
      { userId: "b", cash: -2_000 },
      { userId: "c", cash: -3_000 },
    ]);
    expect(t).toEqual([
      { payerId: "a", payeeId: "b", amount: 2_000 },
      { payerId: "a", payeeId: "c", amount: 3_000 },
    ]);
  });

  it("führt zwei Zahler zu einem Empfänger", () => {
    const t = ringTransfers([
      { userId: "a", cash: 3_000 },
      { userId: "b", cash: -4_000 },
      { userId: "c", cash: 1_000 },
    ]);
    expect(t).toEqual([
      { payerId: "a", payeeId: "b", amount: 3_000 },
      { payerId: "c", payeeId: "b", amount: 1_000 },
    ]);
  });

  it("bewegt genau so viel Geld, wie im Topf liegt", () => {
    const legs = [
      { userId: "a", cash: 7_350 },
      { userId: "b", cash: -2_100 },
      { userId: "c", cash: -5_250 },
    ];
    const summe = ringTransfers(legs).reduce((s, t) => s + t.amount, 0);
    expect(summe).toBe(7_350);
    for (const leg of legs) {
      const raus = ringTransfers(legs)
        .filter((t) => t.payerId === leg.userId)
        .reduce((s, t) => s + t.amount, 0);
      const rein = ringTransfers(legs)
        .filter((t) => t.payeeId === leg.userId)
        .reduce((s, t) => s + t.amount, 0);
      expect(raus - rein).toBe(leg.cash);
    }
  });
});

describe("ringBalanced", () => {
  it("erkennt einen Ring, dessen Ausgleiche sich nicht aufheben", () => {
    expect(ringBalanced([
      { userId: "a", cash: 100 },
      { userId: "b", cash: 0 },
      { userId: "c", cash: 0 },
    ])).toBe(false);
  });
});

describe("ringClosed", () => {
  const ring = [
    { userId: "a", receiverId: "b" },
    { userId: "b", receiverId: "c" },
    { userId: "c", receiverId: "a" },
  ];

  it("akzeptiert einen geschlossenen Ring", () => {
    expect(ringClosed(ring)).toBe(true);
  });

  it("weist zwei getrennte Tausche zurück", () => {
    expect(ringClosed([
      { userId: "a", receiverId: "b" },
      { userId: "b", receiverId: "a" },
      { userId: "c", receiverId: "c" },
    ])).toBe(false);
  });

  it("weist einen Ring zurück, in dem jemand an sich selbst gibt", () => {
    expect(ringClosed([
      { userId: "a", receiverId: "a" },
      { userId: "b", receiverId: "c" },
      { userId: "c", receiverId: "b" },
    ])).toBe(false);
  });

  it("weist doppelte Empfänger zurück", () => {
    expect(ringClosed([
      { userId: "a", receiverId: "c" },
      { userId: "b", receiverId: "c" },
      { userId: "c", receiverId: "a" },
    ])).toBe(false);
  });
});
