import { group, label } from "./format";
import type { Listing, Match, RingSwap, SwapWish, User, Vehicle } from "./types";
import { valueAt } from "./valuation";

/**
 * Ein Inserat mit Fahrzeug und Besitzer. Die Matching-Funktionen bekommen den
 * Bestand übergeben, statt ihn selbst zu laden — so bleiben sie rein und
 * lassen sich ohne Datenbank testen.
 */
export interface ListingEntry {
  listing: Listing;
  vehicle: Vehicle;
  owner: User;
}

/* ------------------------------------------------------------------ */
/* Wunsch-Abgleich                                                     */
/* ------------------------------------------------------------------ */

export interface WishFit {
  ok: boolean;
  /** 0..1 — wie gut das Fahrzeug den Wunsch trifft, auch wenn ok === false */
  quality: number;
  hits: string[];
  misses: string[];
}

/**
 * Prüft, ob ein Fahrzeug einen Tauschwunsch erfüllt. Marke, Karosserie und
 * Antrieb sind harte Kriterien (sofern angegeben), Baujahr und Laufleistung
 * dürfen knapp verfehlt werden, kosten dann aber Punkte.
 */
export function fitsWish(wish: SwapWish, v: Vehicle): WishFit {
  const hits: string[] = [];
  const misses: string[] = [];
  let ok = true;
  let quality = 1;

  if (wish.makes.length) {
    if (wish.makes.includes(v.make)) hits.push(`Marke ${v.make} steht auf der Wunschliste`);
    else {
      misses.push(`${v.make} ist keine der gesuchten Marken`);
      ok = false;
      quality -= 0.45;
    }
  }

  if (wish.bodies.length) {
    if (wish.bodies.includes(v.body)) hits.push(`Karosserieform ${label.body(v.body)} passt`);
    else {
      misses.push(
        `Gesucht wird ${wish.bodies.map(label.body).join(" oder ")}, nicht ${label.body(v.body)}`,
      );
      ok = false;
      quality -= 0.3;
    }
  }

  if (wish.fuels.length) {
    if (wish.fuels.includes(v.fuel)) hits.push(`Antrieb ${label.fuel(v.fuel)} passt`);
    else {
      misses.push(
        `Gesucht wird ${wish.fuels.map(label.fuel).join(" oder ")}, nicht ${label.fuel(v.fuel)}`,
      );
      ok = false;
      quality -= 0.35;
    }
  }

  if (wish.minYear !== undefined) {
    if (v.year >= wish.minYear) hits.push(`Baujahr ${v.year} erfüllt die Mindestanforderung`);
    else {
      const gap = wish.minYear - v.year;
      misses.push(`${gap} Jahr${gap > 1 ? "e" : ""} älter als gewünscht (ab ${wish.minYear})`);
      quality -= Math.min(0.3, gap * 0.12);
      if (gap > 2) ok = false;
    }
  }

  if (wish.maxMileageKm !== undefined) {
    if (v.mileageKm <= wish.maxMileageKm) hits.push("Laufleistung im gewünschten Rahmen");
    else {
      const over = v.mileageKm - wish.maxMileageKm;
      misses.push(`${group(over)} km über der Wunschgrenze`);
      quality -= Math.min(0.3, over / 60_000);
      if (over > 25_000) ok = false;
    }
  }

  return { ok, quality: Math.max(0, Math.min(1, quality)), hits, misses };
}

/* ------------------------------------------------------------------ */
/* Ausgleichszahlung                                                   */
/* ------------------------------------------------------------------ */

export interface CashCalc {
  /** Positiv: der Anbietende zahlt drauf. Negativ: er erhält Geld. */
  delta: number;
  giveValue: number;
  getValue: number;
  premium: number;
}

/**
 * Berechnet die Ausgleichszahlung für einen Tausch: Wert des Zielfahrzeugs
 * minus Wert des eigenen Fahrzeugs, zuzüglich eines vom Inserenten
 * geforderten Aufschlags.
 */
export function cashDelta(give: Vehicle, get: Vehicle, premium = 0, asOf?: string): CashCalc {
  const giveValue = valueAt(give, undefined, asOf);
  const getValue = valueAt(get, undefined, asOf);
  return {
    delta: Math.round((getValue - giveValue + premium) / 50) * 50,
    giveValue,
    getValue,
    premium,
  };
}

/* ------------------------------------------------------------------ */
/* Direkte Matches                                                     */
/* ------------------------------------------------------------------ */

export interface MatchOptions {
  /** Wonach der Nutzer selbst sucht — optional. */
  wish?: Partial<SwapWish>;
  /** Obergrenze für die eigene Zuzahlung. */
  maxCashOut?: number;
  /** Nur Inserate zeigen, bei denen auch die Gegenseite passt. */
  onlyMutual?: boolean;
}

/**
 * Bewertet alle Inserate aus Sicht eines konkreten eigenen Fahrzeugs.
 * Der Score bildet ab, wie wahrscheinlich der Tausch tatsächlich zustande
 * kommt — nicht nur, wie gut das Auto gefällt.
 */
export function findMatches(
  myVehicle: Vehicle,
  pool: ListingEntry[],
  opts: MatchOptions = {},
): Match[] {
  const results: Match[] = [];

  for (const { listing, vehicle, owner } of pool) {
    // Nur aktive Inserate: pausierte und in Verhandlung stehende sind nicht
    // zu haben, auch wenn sie im übergebenen Bestand stehen.
    if (listing.status !== "aktiv") continue;
    if (vehicle.id === myVehicle.id) continue;
    if (vehicle.ownerId === myVehicle.ownerId) continue;
    const cash = cashDelta(myVehicle, vehicle, listing.askPremium ?? 0);

    const reasons: string[] = [];
    const concerns: string[] = [];

    // 1) Passt mein Auto in den Wunsch der Gegenseite?
    const theirFit = fitsWish(listing.wish, myVehicle);
    // Die Gegenseite zahlt das Negative meiner Zuzahlung
    const theirPayment = -cash.delta;
    const cashOk =
      listing.wish.maxCashOut === undefined || theirPayment <= listing.wish.maxCashOut + 1;
    const mutual = theirFit.ok && cashOk;

    if (mutual) {
      reasons.push(`${owner.name} sucht ausdrücklich ein Fahrzeug wie deines`);
    } else if (theirFit.ok && !cashOk) {
      concerns.push(
        `${owner.name} müsste ${fmtChf(Math.abs(theirPayment))} ${
          theirPayment > 0 ? "zuzahlen" : "erhalten"
        } — das liegt ausserhalb des angegebenen Rahmens`,
      );
    } else {
      concerns.push(...theirFit.misses.map((m) => `Gegenseite: ${m}`));
    }

    // 2) Passt das Fahrzeug zu dem, was ich suche?
    let myQuality = 0.6;
    let fitsMyWish = true;
    const hasWish =
      !!opts.wish &&
      ((opts.wish.makes?.length ?? 0) > 0 ||
        (opts.wish.bodies?.length ?? 0) > 0 ||
        (opts.wish.fuels?.length ?? 0) > 0 ||
        opts.wish.minYear !== undefined ||
        opts.wish.maxMileageKm !== undefined);

    if (hasWish && opts.wish) {
      const w: SwapWish = {
        makes: opts.wish.makes ?? [],
        bodies: opts.wish.bodies ?? [],
        fuels: opts.wish.fuels ?? [],
        minYear: opts.wish.minYear,
        maxMileageKm: opts.wish.maxMileageKm,
      };
      const myFit = fitsWish(w, vehicle);
      myQuality = myFit.quality;
      fitsMyWish = myFit.ok;
      reasons.push(...myFit.hits.slice(0, 3));
      concerns.push(...myFit.misses.slice(0, 2));
    }

    // 3) Wie gross ist die Lücke, die mit Geld überbrückt werden muss?
    const relGap = Math.abs(cash.delta) / Math.max(cash.giveValue, cash.getValue);
    if (relGap < 0.05) reasons.push("Werte liegen nah beieinander — wenig Geld nötig");
    if (cash.delta > (opts.maxCashOut ?? Infinity)) {
      concerns.push(`Zuzahlung ${fmtChf(cash.delta)} liegt über deinem Limit`);
    }

    // 4) Objektiver Fortschritt gegenüber dem eigenen Auto
    if (vehicle.year > myVehicle.year) reasons.push(`${vehicle.year - myVehicle.year} Jahr(e) jünger`);
    if (vehicle.mileageKm < myVehicle.mileageKm * 0.8) {
      reasons.push(
        `${((1 - vehicle.mileageKm / myVehicle.mileageKm) * 100).toFixed(0)} % weniger Kilometer`,
      );
    }
    if (!vehicle.accidentFree) concerns.push("Unfallschaden dokumentiert");
    if (vehicle.defects?.length) concerns.push(`${vehicle.defects.length} bekannte(r) Mangel`);
    if (!owner.verified) concerns.push("Besitzer noch nicht verifiziert");

    const score = Math.round(
      100 *
        clamp01(
          0.34 * (mutual ? 1 : theirFit.quality * 0.5) +
            0.28 * myQuality +
            0.16 * (1 - Math.min(1, relGap / 0.4)) +
            0.1 * ratingScore(owner) +
            0.06 * (owner.verified ? 1 : 0.3) +
            0.06 * clamp01(1 - Math.abs(vehicle.mileageKm - 30_000) / 120_000),
        ),
    );

    if (opts.onlyMutual && !mutual) continue;
    if (opts.maxCashOut !== undefined && cash.delta > opts.maxCashOut) continue;

    results.push({
      listing,
      vehicle,
      owner,
      score,
      cashDelta: cash.delta,
      reasons: dedupe(reasons).slice(0, 4),
      concerns: dedupe(concerns).slice(0, 3),
      mutual,
      fitsMyWish,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ */
/* Ringtausch                                                          */
/* ------------------------------------------------------------------ */

export interface RingParticipant {
  user: User;
  gives: Vehicle;
  gets: Vehicle;
  cash: number;
}

export interface RingSwapDetail extends RingSwap {
  participants: RingParticipant[];
}

/**
 * Sucht Dreiertausche: du gibst dein Auto an A, A gibt seines an B, B gibt
 * seines an dich. Das löst den klassischen Fall, in dem zwei Parteien zwar
 * beide tauschen wollen, aber nicht miteinander.
 */
export function findRingSwaps(
  myVehicle: Vehicle,
  entries: ListingEntry[],
  myWish: Partial<SwapWish> | undefined,
  myUser: User,
  limit = 6,
): RingSwapDetail[] {
  // Positivliste statt Ausschluss: pausierte und in Verhandlung stehende
  // Inserate gehören genauso wenig in einen Ring wie getauschte.
  const pool = entries.filter(
    (e) => e.listing.status === "aktiv" && e.vehicle.ownerId !== myVehicle.ownerId,
  );
  const rings: RingSwapDetail[] = [];
  const seen = new Set<string>();

  // Der Wert jedes Fahrzeugs wird einmal berechnet, nicht in der inneren
  // Schleife — sonst wächst der Aufwand mit dem Quadrat des Marktes.
  const askValue = new Map<string, number>();
  for (const e of pool) {
    askValue.set(e.vehicle.id, valueAt(e.vehicle) + (e.listing.askPremium ?? 0));
  }
  // Ohne den eigenen Aufschlag — genau wie im Zweiertausch, auf den die
  // Ringkarte verlinkt. Sonst stünden auf zwei aufeinanderfolgenden Seiten
  // zwei verschiedene Beträge für denselben Schritt.
  const vMe = valueAt(myVehicle);

  const wantsMyCar = pool.filter((e) => fitsWish(e.listing.wish, myVehicle).ok);

  for (const entryA of wantsMyCar) {
    const a = entryA.listing;
    const aVehicle = entryA.vehicle;
    for (const entryB of pool) {
      const b = entryB.listing;
      const bVehicle = entryB.vehicle;
      if (b.id === a.id) continue;
      if (b.ownerId === a.ownerId) continue;
      if (bVehicle.id === myVehicle.id) continue;

      // Im Ring «ich → A → B → ich» bekommt A mein Fahrzeug (oben schon
      // geprüft) und B das von A. Dass A das Fahrzeug von B will, gehört
      // nicht dazu — A bekommt es nie zu sehen. Diese Bedingung hat
      // vorher gültige Dreiecke verworfen.
      if (!fitsWish(b.wish, aVehicle).ok) continue;

      // Und ich muss das Auto von B wollen
      let myQuality = 0.65;
      if (myWish) {
        const fit = fitsWish(
          {
            makes: myWish.makes ?? [],
            bodies: myWish.bodies ?? [],
            fuels: myWish.fuels ?? [],
            minYear: myWish.minYear,
            maxMileageKm: myWish.maxMileageKm,
          },
          bVehicle,
        );
        if (!fit.ok) continue;
        myQuality = fit.quality;
      }

      // Nicht sortieren: «ich → A → B» und «ich → B → A» sind zwei
      // verschiedene Ringe mit anderen Zuzahlungen. Die eigene Position
      // ist immer der Anfang, damit ist der Schlüssel schon eindeutig.
      const key = [myVehicle.id, aVehicle.id, bVehicle.id].join("|");
      if (seen.has(key)) continue;
      seen.add(key);

      // Gerechnet wird mit dem geforderten Wert, also inklusive Aufschlag.
      // Nur so bleibt die Summe der drei Zuzahlungen null und der Ring
      // rechnet sich mit denselben Zahlen wie ein Zweiertausch.
      const vA = askValue.get(aVehicle.id) ?? valueAt(aVehicle);
      const vB = askValue.get(bVehicle.id) ?? valueAt(bVehicle);

      // Jeder zahlt die Differenz zwischen erhaltenem und abgegebenem Wert.
      // Die dritte Zahlung ergibt sich aus den ersten beiden, statt einzeln
      // gerundet zu werden: sonst summieren sich drei Rundungsfehler zu 50
      // Franken, die im Treuhandtopf fehlen würden.
      const myCash = round50(vB - vMe);
      const aCash = round50(vMe - vA);
      const bCash = -(myCash + aCash);

      const ownerA = entryA.owner;
      const ownerB = entryB.owner;

      const score = Math.round(
        100 *
          clamp01(
            0.3 * myQuality +
              0.25 * (1 - Math.min(1, Math.abs(myCash) / (vMe * 0.4))) +
              0.15 * ratingScore(ownerA) +
              0.15 * ratingScore(ownerB) +
              0.15 * (ownerA.verified && ownerB.verified ? 1 : 0.4),
          ),
      );

      rings.push({
        id: `ring-${[myVehicle.id, aVehicle.id, bVehicle.id].join("-")}`,
        legs: [
          { fromUserId: myUser.id, toUserId: a.ownerId, vehicleId: myVehicle.id, cash: myCash },
          { fromUserId: a.ownerId, toUserId: b.ownerId, vehicleId: aVehicle.id, cash: aCash },
          { fromUserId: b.ownerId, toUserId: myUser.id, vehicleId: bVehicle.id, cash: bCash },
        ],
        userCashDelta: myCash,
        score,
        participants: [
          { user: myUser, gives: myVehicle, gets: bVehicle, cash: myCash },
          { user: ownerA, gives: aVehicle, gets: myVehicle, cash: aCash },
          { user: ownerB, gives: bVehicle, gets: aVehicle, cash: bCash },
        ],
      });
    }
  }

  return rings.sort((x, y) => y.score - x.score).slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Hilfen                                                              */
/* ------------------------------------------------------------------ */

/**
 * Ohne Bewertungen bekommt ein Konto einen neutralen Mittelwert statt einer
 * Null — sonst wären neue Nutzer strukturell benachteiligt.
 */
function ratingScore(user: User): number {
  if (user.rating === null || user.ratingCount === 0) return 0.8;
  return user.rating / 5;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round50(n: number): number {
  return Math.round(n / 50) * 50;
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

function fmtChf(n: number): string {
  return `CHF ${group(n)}`;
}
