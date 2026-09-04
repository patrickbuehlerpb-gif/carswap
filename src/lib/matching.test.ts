import { describe, expect, it } from "vitest";
import { cashDelta, findMatches, findRingSwaps, type ListingEntry } from "@/lib/matching";
import type { Listing, SwapWish, User, Vehicle } from "@/lib/types";

/* Reine Funktionen — hier braucht es keine Datenbank. */

function fahrzeug(id: string, ownerId: string, over: Partial<Vehicle> = {}): Vehicle {
  return {
    id,
    ownerId,
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

function nutzer(id: string): User {
  return {
    id,
    name: `Nutzer ${id}`,
    location: "Zürich",
    canton: "ZH",
    memberSince: "2025-01-01",
    rating: null,
    ratingCount: 0,
    swapsCompleted: 0,
    verified: true,
    avatarColor: "#000000",
  };
}

function wunsch(over: Partial<SwapWish> = {}): SwapWish {
  return { makes: [], bodies: [], fuels: [], ...over };
}

function eintrag(
  vehicle: Vehicle,
  wish: SwapWish,
  over: Partial<Listing> = {},
): ListingEntry {
  const listing: Listing = {
    id: `lst-${vehicle.id}`,
    vehicleId: vehicle.id,
    ownerId: vehicle.ownerId,
    createdAt: "2026-01-01",
    wish,
    askPremium: 0,
    views: 0,
    status: "aktiv",
    ...over,
  };
  return { listing, vehicle, owner: nutzer(vehicle.ownerId) };
}

describe("Ringtausch", () => {
  /**
   * Ich (Polestar) → A (Kia) → B (Zeekr) → ich.
   * A will einen Polestar, B will einen Kia, ich will einen Zeekr.
   * Dass A keinen Zeekr will, darf den Ring nicht verhindern — A bekommt
   * das Fahrzeug von B nie zu sehen.
   */
  function dreieck() {
    const meins = fahrzeug("v-me", "u-me", { make: "Polestar" });
    const aAuto = fahrzeug("v-a", "u-a", { make: "Kia", model: "EV6" });
    const bAuto = fahrzeug("v-b", "u-b", { make: "Zeekr", model: "7X" });
    const pool = [
      eintrag(aAuto, wunsch({ makes: ["Polestar"] })),
      eintrag(bAuto, wunsch({ makes: ["Kia"] })),
    ];
    return { meins, aAuto, bAuto, pool };
  }

  it("findet ein Dreieck, in dem A das Fahrzeug von B gar nicht will", () => {
    const { meins, pool } = dreieck();
    const ringe = findRingSwaps(meins, pool, { makes: ["Zeekr"] }, nutzer("u-me"));

    expect(ringe).toHaveLength(1);
    const ring = ringe[0];
    expect(ring.participants.map((p) => p.gives.id)).toEqual(["v-me", "v-a", "v-b"]);
    expect(ring.participants.map((p) => p.gets.id)).toEqual(["v-b", "v-me", "v-a"]);
  });

  it("lässt die Zuzahlungen aller drei zusammen auf null aufgehen", () => {
    const { meins, pool } = dreieck();
    const [ring] = findRingSwaps(meins, pool, { makes: ["Zeekr"] }, nutzer("u-me"));
    const summe = ring.participants.reduce((n, p) => n + p.cash, 0);
    expect(summe).toBe(0);
  });

  it("rechnet den Aufschlag des Inserenten mit ein", () => {
    const meins = fahrzeug("v-me", "u-me", { make: "Polestar" });
    const aAuto = fahrzeug("v-a", "u-a", { make: "Kia" });
    const bAuto = fahrzeug("v-b", "u-b", { make: "Zeekr" });
    const ohne = findRingSwaps(
      meins,
      [eintrag(aAuto, wunsch({ makes: ["Polestar"] })), eintrag(bAuto, wunsch({ makes: ["Kia"] }))],
      { makes: ["Zeekr"] },
      nutzer("u-me"),
    );
    const mit = findRingSwaps(
      meins,
      [
        eintrag(aAuto, wunsch({ makes: ["Polestar"] })),
        eintrag(bAuto, wunsch({ makes: ["Kia"] }), { askPremium: 2000 }),
      ],
      { makes: ["Zeekr"] },
      nutzer("u-me"),
    );
    // Ich bekomme das Fahrzeug von B, also trage ich dessen Aufschlag.
    expect(mit[0].userCashDelta - ohne[0].userCashDelta).toBe(2000);
    expect(mit[0].participants.reduce((n, p) => n + p.cash, 0)).toBe(0);
  });

  it("hält Hin- und Gegenrichtung auseinander", () => {
    // Beide Richtungen sind gültig: jeder will von jedem.
    const meins = fahrzeug("v-me", "u-me", { make: "Polestar" });
    const aAuto = fahrzeug("v-a", "u-a", { make: "Kia", mileageKm: 10_000 });
    const bAuto = fahrzeug("v-b", "u-b", { make: "Zeekr", mileageKm: 90_000 });
    const alle = wunsch({ makes: ["Polestar", "Kia", "Zeekr"] });
    const ringe = findRingSwaps(
      meins,
      [eintrag(aAuto, alle), eintrag(bAuto, alle)],
      { makes: ["Polestar", "Kia", "Zeekr"] },
      nutzer("u-me"),
    );

    expect(ringe).toHaveLength(2);
    // Reihenfolge der Teilnehmer ist [ich, A, B]; jeder bekommt das Fahrzeug
    // des Nächsten im Ring. Die beiden Richtungen unterscheiden sich darin,
    // wer A und wer B ist.
    const wege = ringe.map((r) => r.participants.map((p) => p.gets.id).join(">")).sort();
    expect(wege).toEqual(["v-a>v-me>v-b", "v-b>v-me>v-a"]);
    // Unterschiedliche Fahrzeugwerte heissen unterschiedliche Zuzahlungen.
    expect(ringe[0].userCashDelta).not.toBe(ringe[1].userCashDelta);
  });

  it("nimmt weder das eigene Fahrzeug noch zweimal denselben Nutzer auf", () => {
    const meins = fahrzeug("v-me", "u-me");
    const eigenes2 = fahrzeug("v-me2", "u-me");
    const aAuto = fahrzeug("v-a", "u-a");
    const aZweites = fahrzeug("v-a2", "u-a");
    const alle = wunsch();
    const ringe = findRingSwaps(
      meins,
      [eintrag(eigenes2, alle), eintrag(aAuto, alle), eintrag(aZweites, alle)],
      undefined,
      nutzer("u-me"),
    );
    for (const ring of ringe) {
      const nutzerIds = ring.participants.map((p) => p.user.id);
      expect(new Set(nutzerIds).size).toBe(3);
    }
  });

  it("übergeht getauschte und pausierte Inserate", () => {
    const meins = fahrzeug("v-me", "u-me", { make: "Polestar" });
    const aAuto = fahrzeug("v-a", "u-a", { make: "Kia" });
    const bAuto = fahrzeug("v-b", "u-b", { make: "Zeekr" });
    const ringe = findRingSwaps(
      meins,
      [
        eintrag(aAuto, wunsch({ makes: ["Polestar"] })),
        eintrag(bAuto, wunsch({ makes: ["Kia"] }), { status: "getauscht" }),
      ],
      { makes: ["Zeekr"] },
      nutzer("u-me"),
    );
    expect(ringe).toHaveLength(0);
  });
});

describe("Zweiertausch", () => {
  it("rechnet den Ausgleich aus Sicht des Anbietenden", () => {
    const meins = fahrzeug("v-me", "u-me", { mileageKm: 90_000 });
    const anderes = fahrzeug("v-a", "u-a", { mileageKm: 10_000 });
    const calc = cashDelta(meins, anderes, 0);
    // Das jüngere Fahrzeug ist mehr wert, also zahle ich drauf.
    expect(calc.delta).toBeGreaterThan(0);
    expect(calc.delta % 50).toBe(0);
    expect(cashDelta(meins, anderes, 1000).delta - calc.delta).toBe(1000);
  });

  it("findet ein Gegenüber nur, wenn beide Wunschlisten passen", () => {
    const meins = fahrzeug("v-me", "u-me", { make: "Polestar" });
    const passend = fahrzeug("v-a", "u-a", { make: "Zeekr" });
    const unpassend = fahrzeug("v-b", "u-b", { make: "Kia" });
    const pool = [
      eintrag(passend, wunsch({ makes: ["Polestar"] })),
      eintrag(unpassend, wunsch({ makes: ["BMW"] })),
    ];
    const matches = findMatches(meins, pool, { wish: { makes: ["Zeekr", "Kia"] } });

    const beidseitig = matches.filter((m) => m.mutual && m.fitsMyWish);
    expect(beidseitig.map((m) => m.listing.vehicleId)).toEqual(["v-a"]);
  });
});
