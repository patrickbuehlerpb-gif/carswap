import type { Deal } from "../types";

/**
 * Vorbelegte Tauschvorgänge, damit die Demo nicht bei null startet. Die Beträge
 * sind an den Modellwerten der beteiligten Fahrzeuge ausgerichtet, damit
 * Verhandlung und Modellrechnung zueinander passen.
 */
export const seedDeals: Deal[] = [
  {
    // Polestar 4 (46'800) gegen Skoda Enyaq (42'100) — Modellwert: −4'700
    id: "d-001",
    fromVehicleId: "v-me-1",
    toVehicleId: "v-016",
    initiatorId: "u-me",
    counterpartyId: "u-009",
    cashDelta: -5_500,
    status: "verhandlung",
    createdAt: "2026-08-26",
    messages: [
      {
        id: "m-1",
        authorId: "u-me",
        at: "2026-08-26T09:12:00Z",
        text: "Hallo Reto, dein Enyaq gefällt mir — vor allem die Anhängerkupplung. Mein Polestar 4 ist deutlich stärker motorisiert und hat weniger Kilometer, deshalb der Ausgleich zu meinen Gunsten. Interesse?",
        offerCash: -7_500,
      },
      {
        id: "m-2",
        authorId: "u-009",
        at: "2026-08-27T18:44:00Z",
        text: "Grundsätzlich ja. 7'500 finde ich aber zu viel — der Enyaq ist ein Jahr jünger und hat die AHK, die du selbst erwähnst. Ich käme auf 3'500.",
        offerCash: -3_500,
      },
      {
        id: "m-3",
        authorId: "u-me",
        at: "2026-08-28T07:30:00Z",
        text: "Die Rechnung sagt 4'700 zu meinen Gunsten. Treffen wir uns bei 5'500, dann übernehme ich die Fahrt für die Übergabe nach Chur?",
        offerCash: -5_500,
      },
    ],
  },
  {
    // Toyota RAV4 (30'750) gegen Skoda Octavia (19'050) — Modellwert: −11'700
    // aus Sicht von Tobias, der den RAV4 abgibt.
    id: "d-002",
    fromVehicleId: "v-013",
    toVehicleId: "v-me-2",
    initiatorId: "u-005",
    counterpartyId: "u-me",
    cashDelta: -11_000,
    status: "vorschlag",
    createdAt: "2026-08-31",
    messages: [
      {
        id: "m-4",
        authorId: "u-005",
        at: "2026-08-31T14:02:00Z",
        text: "Hoi Patrick, ich suche einen Diesel-Kombi mit Anhängerkupplung und biete meinen RAV4 Hybrid. Der RAV4 ist rund 11'700 mehr wert — ich würde mit 11'000 Ausgleich entgegenkommen, wenn du den Wagen so nimmst wie er steht.",
        offerCash: -11_000,
      },
    ],
  },
  {
    // Skoda Octavia (19'050) gegen Polestar 2 (24'650) — Modellwert: +5'600
    id: "d-003",
    fromVehicleId: "v-me-2",
    toVehicleId: "v-017",
    initiatorId: "u-me",
    counterpartyId: "u-010",
    cashDelta: 5_600,
    status: "abgelehnt",
    createdAt: "2026-05-14",
    messages: [
      {
        id: "m-5",
        authorId: "u-me",
        at: "2026-05-14T11:00:00Z",
        text: "Hallo Elena, ich hätte Interesse an deinem Polestar 2 und biete meinen Octavia Combi plus 5'600 Ausgleich.",
        offerCash: 5_600,
      },
      {
        id: "m-6",
        authorId: "u-010",
        at: "2026-05-16T20:15:00Z",
        text: "Danke für die Anfrage! Ich brauche zwingend einen Kombi mit mehr Ladevolumen und einer Anhängerkupplung — der Octavia hat zwar eine, ist mir aber insgesamt zu knapp. Ich muss leider absagen.",
      },
    ],
  },
];
