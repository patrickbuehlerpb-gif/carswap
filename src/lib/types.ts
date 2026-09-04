export type Fuel = "elektro" | "hybrid" | "benzin" | "diesel";
export type Body = "suv" | "limousine" | "kombi" | "kompakt" | "coupe" | "van";
export type Condition = "neuwertig" | "sehr gut" | "gut" | "gebraucht";
export type Drivetrain = "heck" | "front" | "allrad";
export type ServiceHistory = "lückenlos scheckheft" | "teilweise" | "keine";

export interface VehiclePhoto {
  url: string;
  width: number;
  height: number;
}

/** Ein konkretes Fahrzeug — egal ob im Besitz des Nutzers oder inseriert. */
export interface Vehicle {
  id: string;
  make: string;
  model: string;
  trim: string;
  year: number;
  /** Erstzulassung, ISO-Datum */
  firstRegistration: string;
  mileageKm: number;
  fuel: Fuel;
  body: Body;
  drivetrain: Drivetrain;
  powerPs: number;
  /** Listenpreis fabrikneu inkl. Ausstattung, in Basiswährung */
  listPriceNew: number;
  condition: Condition;
  color: string;
  /** Reichweite WLTP in km, nur bei Elektro/Hybrid */
  rangeKm?: number;
  /** Batteriezustand State of Health in Prozent, nur bei Elektro */
  batterySoh?: number;
  /** Freitext-Ausstattungsmerkmale, wertsteigernd */
  features: string[];
  /** Besitzer des Fahrzeugs */
  ownerId: string;
  photos: VehiclePhoto[];
  /** Kurzbeschreibung durch den Besitzer */
  notes?: string;
  /** Bekannte Mängel — drücken den Wert */
  defects?: string[];
  serviceHistory: ServiceHistory;
  previousOwners: number;
  accidentFree: boolean;
  mfkUntil?: string;
}

/** Was ein Inserent im Tausch sucht. */
export interface SwapWish {
  makes: string[];
  bodies: Body[];
  fuels: Fuel[];
  minYear?: number;
  maxMileageKm?: number;
  /** Der Inserent ist bereit, bis zu diesem Betrag draufzuzahlen (positiv)
   *  bzw. erwartet mindestens diesen Ausgleich (negativ). */
  maxCashOut?: number;
  notes?: string;
}

export interface User {
  id: string;
  name: string;
  location: string;
  canton: string;
  memberSince: string;
  /** Durchschnitt aus abgegebenen Bewertungen, null solange keine vorliegt */
  rating: number | null;
  ratingCount: number;
  swapsCompleted: number;
  /** E-Mail bestätigt und Identität geprüft */
  verified: boolean;
  avatarColor: string;
}

/** Ein Inserat: Fahrzeug + Tauschwunsch + Besitzer. */
export interface Listing {
  id: string;
  vehicleId: string;
  ownerId: string;
  createdAt: string;
  wish: SwapWish;
  /** Vom Inserenten gewünschter Ausgleich zusätzlich zur reinen Wertdifferenz. */
  askPremium?: number;
  views: number;
  status: "aktiv" | "pausiert" | "in verhandlung" | "getauscht";
}

export type DealStatus =
  | "vorschlag"
  | "verhandlung"
  | "angenommen"
  | "treuhand"
  | "abwicklung"
  | "abgeschlossen"
  | "abgelehnt"
  | "storniert";

export interface DealMessage {
  id: string;
  authorId: string;
  at: string;
  text: string;
  /** Wenn die Nachricht ein Gegenangebot enthält */
  offerCash?: number;
  /** Vom System erzeugter Statuseintrag statt einer Nutzernachricht */
  system?: boolean;
}

/** Ein Tauschvorgang zwischen zwei Parteien. */
export interface Deal {
  id: string;
  /** Fahrzeug, das der Initiator abgibt */
  fromVehicleId: string;
  /** Fahrzeug, das der Initiator erhalten möchte */
  toVehicleId: string;
  initiatorId: string;
  counterpartyId: string;
  /** Positiv = Initiator zahlt drauf. Negativ = Initiator erhält Geld. */
  cashDelta: number;
  status: DealStatus;
  createdAt: string;
  messages: DealMessage[];
  /** Anzahl Nachrichten — auch gesetzt, wenn `messages` leer geladen wurde */
  messageCount?: number;
  initiatorConfirmed?: boolean;
  counterpartyConfirmed?: boolean;
}

/** Ergebnis der Bewertung eines Fahrzeugs zu einem Stichtag. */
export interface Valuation {
  vehicleId: string;
  /** Empfohlener Handelswert */
  value: number;
  /** Realistische Spanne bei Privatverkauf */
  low: number;
  high: number;
  /** Aufschlüsselung, wie sich der Wert ergibt */
  breakdown: ValuationFactor[];
  /** Wie sicher ist die Schätzung, 0..1 */
  confidence: number;
  /** Vergleichbare Inserate, auf denen die Schätzung fusst */
  comparables: number;
}

export interface ValuationFactor {
  label: string;
  /** Betrag in Währungseinheiten, +/- gegenüber dem Basiswert */
  amount: number;
  hint: string;
}

export interface HistoryPoint {
  /** ISO Monat, z.B. 2024-03 */
  month: string;
  value: number;
  /** Untere/obere Grenze des Prognosebands, nur in der Zukunft gesetzt */
  low?: number;
  high?: number;
  forecast: boolean;
}

/** Ein Tauschvorschlag, den die Matching-Engine gefunden hat. */
export interface Match {
  listing: Listing;
  vehicle: Vehicle;
  owner: User;
  /** 0..100 */
  score: number;
  /** Positiv = Nutzer zahlt drauf */
  cashDelta: number;
  reasons: string[];
  concerns: string[];
  /** Passt das Fahrzeug des Nutzers in den Wunsch des Inserenten? */
  mutual: boolean;
  /** Passt das Inserat umgekehrt zu den Suchkriterien des Nutzers? */
  fitsMyWish: boolean;
}

/** Ringtausch über drei Parteien: A gibt an B, B an C, C an A. */
export interface RingSwap {
  id: string;
  legs: RingLeg[];
  /** Was der Nutzer unter dem Strich zahlt (positiv) oder erhält (negativ) */
  userCashDelta: number;
  score: number;
}

export interface RingLeg {
  fromUserId: string;
  toUserId: string;
  vehicleId: string;
  /** Ausgleich, den fromUser in den Topf zahlt (positiv) oder erhält */
  cash: number;
}
