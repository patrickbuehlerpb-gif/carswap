import "server-only";
import { and, desc, eq, inArray, isNull, ne, or, sql as raw } from "drizzle-orm";
import { db } from "./db";
import { normalizeFeatures } from "./data/features";
import {
  dealMessages,
  deals,
  listings,
  payments,
  reviews,
  ringLegs,
  ringSwaps,
  users,
  vehicles,
  watchlist,
  type DealRow,
  type ListingRow,
  type PaymentStatus,
  type RingStatusDb,
  type UserRow,
  type VehicleRow,
} from "./db/schema";
import type { Deal, DealMessage, DealStatus, Listing, User, Vehicle } from "./types";

/* ------------------------------------------------------------------ */
/* Übersetzung Datenbankzeile → Domänenobjekt                          */
/*                                                                     */
/* Bewusst explizit: die UI bekommt nie eine rohe Datenbankzeile,      */
/* sondern nur die Felder, die sie darstellt.                          */
/* ------------------------------------------------------------------ */

export function toVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    ownerId: row.ownerId,
    make: row.make,
    model: row.model,
    trim: row.trim,
    year: Number(row.firstRegistration.slice(0, 4)),
    firstRegistration: row.firstRegistration,
    mileageKm: row.mileageKm,
    fuel: row.fuel,
    body: row.body,
    drivetrain: row.drivetrain,
    powerPs: row.powerPs,
    listPriceNew: row.listPriceNew,
    condition: row.condition,
    color: row.color,
    rangeKm: row.rangeKm ?? undefined,
    batterySoh: row.batterySoh ?? undefined,
    // Alte Bezeichnungen werden schon beim Lesen auf die heutigen abgebildet,
    // damit Anzeige und Bewertung dieselbe Liste sehen.
    features: normalizeFeatures(row.features ?? []),
    archivedAt: row.archivedAt?.toISOString(),
    photos: row.photos ?? [],
    notes: row.notes ?? undefined,
    defects: row.defects?.length ? row.defects : undefined,
    serviceHistory: row.serviceHistory,
    previousOwners: row.previousOwners,
    accidentFree: row.accidentFree,
    mfkUntil: row.mfkUntil ?? undefined,
  };
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    canton: row.canton,
    memberSince: row.createdAt.toISOString().slice(0, 10),
    rating: row.ratingCount > 0 ? row.ratingSum / row.ratingCount / 10 : null,
    ratingCount: row.ratingCount,
    swapsCompleted: row.swapsCompleted,
    emailVerified: row.emailVerifiedAt !== null,
    identityVerified: row.identityVerified,
    avatarColor: row.avatarColor,
  };
}

export function toListing(row: ListingRow): Listing {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString().slice(0, 10),
    wish: {
      makes: row.wishMakes ?? [],
      bodies: row.wishBodies ?? [],
      fuels: row.wishFuels ?? [],
      minYear: row.wishMinYear ?? undefined,
      maxMileageKm: row.wishMaxMileageKm ?? undefined,
      maxCashOut: row.wishMaxCashOut ?? undefined,
      notes: row.wishNotes ?? undefined,
    },
    askPremium: row.askPremium,
    views: row.views,
    status: row.status,
  };
}

/** Ein Inserat mit allem, was die Kartenansicht braucht. */
export interface ListingView {
  listing: Listing;
  vehicle: Vehicle;
  owner: User;
}

/* ------------------------------------------------------------------ */
/* Fahrzeuge und Inserate                                              */
/* ------------------------------------------------------------------ */

export async function getVehicle(id: string): Promise<Vehicle | null> {
  const rows = await db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
  return rows[0] ? toVehicle(rows[0]) : null;
}

/**
 * Wie getVehicle, aber nur für Fahrzeuge, die nicht archiviert sind.
 *
 * Die öffentliche Fahrzeugseite muss das nehmen: eine Kontolöschung
 * archiviert die Fahrzeuge, und ihre Adressen standen vorher in der Sitemap.
 * Ohne diese Prüfung blieben Beschreibung, Mängelliste und Wunschtext
 * danach unter einer indexierten URL abrufbar.
 */
export async function getPublicVehicle(id: string): Promise<Vehicle | null> {
  const rows = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, id), isNull(vehicles.archivedAt)))
    .limit(1);
  return rows[0] ? toVehicle(rows[0]) : null;
}

export async function getVehiclesByIds(ids: string[]): Promise<Map<string, Vehicle>> {
  if (!ids.length) return new Map();
  const rows = await db.select().from(vehicles).where(inArray(vehicles.id, ids));
  return new Map(rows.map((r) => [r.id, toVehicle(r)]));
}

export async function getMyVehicles(userId: string): Promise<Vehicle[]> {
  const rows = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.ownerId, userId), isNull(vehicles.archivedAt)))
    .orderBy(desc(vehicles.createdAt));
  return rows.map(toVehicle);
}

/**
 * Alle aktiven Inserate, ohne die eigenen. Das Sortieren und Filtern nach
 * Passung passiert danach im Matching, weil es vom gewählten eigenen
 * Fahrzeug abhängt.
 */
/** Obergrenze für den Marktpool. Darüber hinaus wird gezählt, nicht geladen. */
export const MARKTPOOL_LIMIT = 500;

export async function getActiveListings(excludeOwnerId?: string): Promise<ListingView[]> {
  const rows = await db
    .select({ listing: listings, vehicle: vehicles, owner: users })
    .from(listings)
    .innerJoin(vehicles, eq(vehicles.id, listings.vehicleId))
    .innerJoin(users, eq(users.id, listings.ownerId))
    .where(
      excludeOwnerId
        ? and(eq(listings.status, "aktiv"), ne(listings.ownerId, excludeOwnerId))
        : eq(listings.status, "aktiv"),
    )
    .orderBy(desc(listings.createdAt))
    .limit(MARKTPOOL_LIMIT);

  return rows.map((r) => ({
    listing: toListing(r.listing),
    vehicle: toVehicle(r.vehicle),
    owner: toUser(r.owner),
  }));
}

/** Wie viele aktive Inserate es insgesamt gibt — für den Hinweis auf die Obergrenze. */
export async function countActiveListings(excludeOwnerId?: string): Promise<number> {
  const rows = await db
    .select({ n: raw<number>`count(*)::int` })
    .from(listings)
    .where(
      excludeOwnerId
        ? and(eq(listings.status, "aktiv"), ne(listings.ownerId, excludeOwnerId))
        : eq(listings.status, "aktiv"),
    );
  return rows[0]?.n ?? 0;
}

export async function getListingByVehicle(vehicleId: string): Promise<ListingView | null> {
  const rows = await db
    .select({ listing: listings, vehicle: vehicles, owner: users })
    .from(listings)
    .innerJoin(vehicles, eq(vehicles.id, listings.vehicleId))
    .innerJoin(users, eq(users.id, listings.ownerId))
    .where(eq(listings.vehicleId, vehicleId))
    .limit(1);
  const r = rows[0];
  return r
    ? { listing: toListing(r.listing), vehicle: toVehicle(r.vehicle), owner: toUser(r.owner) }
    : null;
}

export async function getMyListings(userId: string): Promise<ListingView[]> {
  const rows = await db
    .select({ listing: listings, vehicle: vehicles, owner: users })
    .from(listings)
    .innerJoin(vehicles, eq(vehicles.id, listings.vehicleId))
    .innerJoin(users, eq(users.id, listings.ownerId))
    .where(eq(listings.ownerId, userId));
  return rows.map((r) => ({
    listing: toListing(r.listing),
    vehicle: toVehicle(r.vehicle),
    owner: toUser(r.owner),
  }));
}

/**
 * Wie viele eigene Inserate gerade aktiv sind.
 *
 * Getrennt von `getMyVehicles`, weil ein Auto in der Garage und ein Auto im
 * Marktplatz zweierlei sind: ein pausiertes Inserat sieht niemand, und die
 * Treffermeldungen gehen nur an Leute mit aktivem Inserat. Wo die Seite
 * verspricht «wir schreiben dir», muss sie das hier fragen.
 */
export async function countMyActiveListings(userId: string): Promise<number> {
  const rows = await db
    .select({ n: raw<number>`count(*)::int` })
    .from(listings)
    .where(and(eq(listings.ownerId, userId), eq(listings.status, "aktiv")));
  return rows[0]?.n ?? 0;
}

/** Zählt einen Aufruf. Fehler hier dürfen die Seite nicht kippen. */
export async function countListingView(listingId: string): Promise<void> {
  try {
    await db
      .update(listings)
      .set({ views: raw`${listings.views} + 1` })
      .where(eq(listings.id, listingId));
  } catch (err) {
    console.error("Aufruf konnte nicht gezählt werden:", err);
  }
}

/* ------------------------------------------------------------------ */
/* Nutzer                                                              */
/* ------------------------------------------------------------------ */

export async function getPublicUser(id: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ? toUser(rows[0]) : null;
}

/* ------------------------------------------------------------------ */
/* Tausche                                                             */
/* ------------------------------------------------------------------ */

export interface DealView {
  deal: Deal;
  fromVehicle: Vehicle;
  toVehicle: Vehicle;
  other: User;
  /** Bin ich der Initiator? */
  iAmInitiator: boolean;
}

function toDeal(row: DealRow, messages: DealMessage[] = []): Deal {
  return {
    id: row.id,
    fromVehicleId: row.fromVehicleId,
    toVehicleId: row.toVehicleId,
    initiatorId: row.initiatorId,
    counterpartyId: row.counterpartyId,
    cashDelta: row.cashDelta,
    status: row.status as DealStatus,
    createdAt: row.createdAt.toISOString().slice(0, 10),
    messages,
  };
}

export async function getDealsForUser(userId: string): Promise<DealView[]> {
  const rows = await db
    .select()
    .from(deals)
    .where(or(eq(deals.initiatorId, userId), eq(deals.counterpartyId, userId)))
    .orderBy(desc(deals.updatedAt))
    .limit(100);
  if (!rows.length) return [];

  const vehicleIds = [...new Set(rows.flatMap((d) => [d.fromVehicleId, d.toVehicleId]))];
  const userIds = [...new Set(rows.flatMap((d) => [d.initiatorId, d.counterpartyId]))];
  const [vehicleMap, userRows, counts] = await Promise.all([
    getVehiclesByIds(vehicleIds),
    db.select().from(users).where(inArray(users.id, userIds)),
    db
      .select({ dealId: dealMessages.dealId, n: raw<number>`count(*)::int` })
      .from(dealMessages)
      .where(inArray(dealMessages.dealId, rows.map((d) => d.id)))
      .groupBy(dealMessages.dealId),
  ]);
  const userMap = new Map(userRows.map((u) => [u.id, toUser(u)]));
  const countMap = new Map(counts.map((c) => [c.dealId, c.n]));

  return rows.flatMap((row) => {
    const fromVehicle = vehicleMap.get(row.fromVehicleId);
    const toVehicle = vehicleMap.get(row.toVehicleId);
    const iAmInitiator = row.initiatorId === userId;
    const other = userMap.get(iAmInitiator ? row.counterpartyId : row.initiatorId);
    if (!fromVehicle || !toVehicle || !other) return [];
    const deal = toDeal(row);
    deal.messageCount = countMap.get(row.id) ?? 0;
    return [{ deal, fromVehicle, toVehicle, other, iAmInitiator }];
  });
}

export interface DealDetail extends DealView {
  authors: Map<string, User>;
}

/** Lädt einen Tausch samt Verlauf — nur für die beiden Beteiligten. */
export async function getDealForUser(dealId: string, userId: string): Promise<DealDetail | null> {
  const rows = await db
    .select()
    .from(deals)
    .where(
      and(
        eq(deals.id, dealId),
        or(eq(deals.initiatorId, userId), eq(deals.counterpartyId, userId)),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const [messageRows, vehicleMap, userRows] = await Promise.all([
    db
      .select()
      .from(dealMessages)
      .where(eq(dealMessages.dealId, dealId))
      .orderBy(dealMessages.createdAt),
    getVehiclesByIds([row.fromVehicleId, row.toVehicleId]),
    db.select().from(users).where(inArray(users.id, [row.initiatorId, row.counterpartyId])),
  ]);

  const fromVehicle = vehicleMap.get(row.fromVehicleId);
  const toVehicle = vehicleMap.get(row.toVehicleId);
  if (!fromVehicle || !toVehicle) return null;

  const authors = new Map(userRows.map((u) => [u.id, toUser(u)]));
  const iAmInitiator = row.initiatorId === userId;
  const other = authors.get(iAmInitiator ? row.counterpartyId : row.initiatorId);
  if (!other) return null;

  const messages: DealMessage[] = messageRows.map((m) => ({
    id: m.id,
    authorId: m.authorId,
    at: m.createdAt.toISOString(),
    text: m.body,
    offerCash: m.offerCash ?? undefined,
    system: m.system,
  }));

  const deal = toDeal(row, messages);
  deal.messageCount = messages.length;
  deal.initiatorConfirmed = row.initiatorConfirmed;
  deal.counterpartyConfirmed = row.counterpartyConfirmed;

  return { deal, fromVehicle, toVehicle, other, iAmInitiator, authors };
}

/* ------------------------------------------------------------------ */
/* Kontaktdaten der Gegenseite                                         */
/* ------------------------------------------------------------------ */

/**
 * Ab diesen Zuständen ist der Tausch verbindlich. Vorher — solange nur
 * verhandelt wird — bleibt die Telefonnummer unter Verschluss: sonst reichte
 * ein unverbindlicher Vorschlag, um an die Nummer jedes Inserenten zu kommen.
 */
const VERBINDLICH = ["angenommen", "treuhand", "abwicklung", "abgeschlossen"] as const;

export interface Kontakt {
  userId: string;
  name: string;
  phone: string;
}

/**
 * Die Telefonnummern der Gegenseite eines zugesagten Tauschs.
 *
 * Für die Übergabe brauchen die beiden einen Weg aneinander, der nicht durch
 * die Anwendung läuft — ein Auto wechselt nicht über ein Nachrichtenfeld den
 * Besitzer. Genau das steht auch beim Eingabefeld im Konto; ohne diese Stelle
 * wäre es ein leeres Versprechen.
 */
export async function getDealKontakte(dealId: string, userId: string): Promise<Kontakt[]> {
  const [row] = await db
    .select({
      status: deals.status,
      initiatorId: deals.initiatorId,
      counterpartyId: deals.counterpartyId,
    })
    .from(deals)
    .where(
      and(
        eq(deals.id, dealId),
        or(eq(deals.initiatorId, userId), eq(deals.counterpartyId, userId)),
      ),
    )
    .limit(1);
  if (!row) return [];
  if (!VERBINDLICH.includes(row.status as (typeof VERBINDLICH)[number])) return [];

  const gegenueber = row.initiatorId === userId ? row.counterpartyId : row.initiatorId;
  return kontakteVon([gegenueber]);
}

/** Dasselbe für den Ringtausch: die beiden anderen Beteiligten. */
export async function getRingKontakte(ringId: string, userId: string): Promise<Kontakt[]> {
  const [ring] = await db
    .select({ status: ringSwaps.status })
    .from(ringSwaps)
    .where(eq(ringSwaps.id, ringId))
    .limit(1);
  if (!ring) return [];
  if (!VERBINDLICH.includes(ring.status as (typeof VERBINDLICH)[number])) return [];

  const beine = await db
    .select({ userId: ringLegs.userId })
    .from(ringLegs)
    .where(eq(ringLegs.ringId, ringId));
  // Wer nicht mitmacht, bekommt nichts zu sehen.
  if (!beine.some((b) => b.userId === userId)) return [];

  return kontakteVon(beine.map((b) => b.userId).filter((id) => id !== userId));
}

async function kontakteVon(userIds: string[]): Promise<Kontakt[]> {
  if (!userIds.length) return [];
  const rows = await db
    .select({ id: users.id, name: users.name, phone: users.phone })
    .from(users)
    .where(inArray(users.id, userIds));
  // Ohne hinterlegte Nummer gibt es nichts anzuzeigen — dann bleibt der
  // Verlauf der einzige Weg.
  return rows
    .filter((r) => r.phone?.trim())
    .map((r) => ({ userId: r.id, name: r.name, phone: r.phone!.trim() }));
}

/* ------------------------------------------------------------------ */
/* Merkliste                                                           */
/* ------------------------------------------------------------------ */

/** Die eigene Bewertung zu einem Tausch, falls sie schon abgegeben wurde. */
export async function getMyReviewForDeal(dealId: string, userId: string) {
  const [row] = await db
    .select({ stars: reviews.stars, body: reviews.body })
    .from(reviews)
    .where(and(eq(reviews.dealId, dealId), eq(reviews.authorId, userId)))
    .limit(1);
  return row ?? null;
}

/** Die eigenen Bewertungen zu einem Ring, je bewerteter Person. */
export async function getMyRingReviews(
  ringId: string,
  authorId: string,
): Promise<Map<string, { stars: number; body: string | null }>> {
  const rows = await db
    .select({ subjectId: reviews.subjectId, stars: reviews.stars, body: reviews.body })
    .from(reviews)
    .where(and(eq(reviews.ringId, ringId), eq(reviews.authorId, authorId)));
  return new Map(rows.map((r) => [r.subjectId, { stars: r.stars, body: r.body }]));
}

/** Die neuesten Bewertungen über eine Person, mit dem Namen der Autorin. */
export async function getReviewsAbout(userId: string, limit = 5) {
  const rows = await db
    .select({
      stars: reviews.stars,
      body: reviews.body,
      createdAt: reviews.createdAt,
      authorName: users.name,
      authorColor: users.avatarColor,
    })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.authorId))
    .where(eq(reviews.subjectId, userId))
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    stars: r.stars,
    body: r.body,
    createdAt: r.createdAt.toISOString().slice(0, 10),
    authorName: r.authorName,
    authorColor: r.authorColor,
  }));
}

export async function getWatchlistIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ listingId: watchlist.listingId })
    .from(watchlist)
    .where(eq(watchlist.userId, userId));
  return rows.map((r) => r.listingId);
}

export async function getWatchlist(userId: string): Promise<ListingView[]> {
  const rows = await db
    .select({ listing: listings, vehicle: vehicles, owner: users })
    .from(watchlist)
    .innerJoin(listings, eq(listings.id, watchlist.listingId))
    .innerJoin(vehicles, eq(vehicles.id, listings.vehicleId))
    .innerJoin(users, eq(users.id, listings.ownerId))
    .where(eq(watchlist.userId, userId))
    .orderBy(desc(watchlist.createdAt));
  return rows.map((r) => ({
    listing: toListing(r.listing),
    vehicle: toVehicle(r.vehicle),
    owner: toUser(r.owner),
  }));
}

/* ------------------------------------------------------------------ */
/* Ringtausche                                                         */
/* ------------------------------------------------------------------ */

export interface RingParticipantView {
  user: User;
  /** Fahrzeug, das diese Person abgibt */
  gives: Vehicle;
  /** Wer dieses Fahrzeug bekommt */
  receiverId: string;
  /** Positiv: zahlt in den Topf. Negativ: bekommt daraus. */
  cash: number;
  accepted: boolean;
  confirmed: boolean;
}

export interface RingView {
  id: string;
  status: RingStatusDb;
  initiatorId: string;
  createdAt: string;
  /** Nach Position sortiert: 0 gibt an 1, 1 an 2, 2 zurück an 0. */
  participants: RingParticipantView[];
  messageCount: number;
}

export interface RingPaymentView {
  payerId: string;
  payeeId: string;
  amountMinor: number;
  feeMinor: number;
  status: PaymentStatus;
}

export interface RingDetail extends RingView {
  messages: DealMessage[];
  payments: RingPaymentView[];
}

/** Baut die Teilnehmeransicht aus Beinen, Fahrzeugen und Konten. */
function toParticipants(
  legs: { userId: string; vehicleId: string; receiverId: string; cash: number; acceptedAt: Date | null; confirmedAt: Date | null }[],
  vehicleMap: Map<string, Vehicle>,
  userMap: Map<string, User>,
): RingParticipantView[] | null {
  const out: RingParticipantView[] = [];
  for (const leg of legs) {
    const gives = vehicleMap.get(leg.vehicleId);
    const user = userMap.get(leg.userId);
    if (!gives || !user) return null;
    out.push({
      user,
      gives,
      receiverId: leg.receiverId,
      cash: leg.cash,
      accepted: leg.acceptedAt !== null,
      confirmed: leg.confirmedAt !== null,
    });
  }
  return out;
}

export async function getRingsForUser(userId: string): Promise<RingView[]> {
  const meine = await db
    .select({ ringId: ringLegs.ringId })
    .from(ringLegs)
    .where(eq(ringLegs.userId, userId));
  if (!meine.length) return [];
  const ringIds = [...new Set(meine.map((r) => r.ringId))];

  const [ringRows, legRows, counts] = await Promise.all([
    db
      .select()
      .from(ringSwaps)
      .where(inArray(ringSwaps.id, ringIds))
      .orderBy(desc(ringSwaps.updatedAt))
      .limit(100),
    db.select().from(ringLegs).where(inArray(ringLegs.ringId, ringIds)).orderBy(ringLegs.position),
    db
      .select({ ringId: dealMessages.ringId, n: raw<number>`count(*)::int` })
      .from(dealMessages)
      .where(inArray(dealMessages.ringId, ringIds))
      .groupBy(dealMessages.ringId),
  ]);

  const vehicleMap = await getVehiclesByIds([...new Set(legRows.map((l) => l.vehicleId))]);
  const userRows = await db
    .select()
    .from(users)
    .where(inArray(users.id, [...new Set(legRows.map((l) => l.userId))]));
  const userMap = new Map(userRows.map((u) => [u.id, toUser(u)]));
  const countMap = new Map(counts.map((c) => [c.ringId, c.n]));

  return ringRows.flatMap((ring) => {
    const legs = legRows.filter((l) => l.ringId === ring.id);
    if (legs.length !== 3) return [];
    const participants = toParticipants(legs, vehicleMap, userMap);
    if (!participants) return [];
    return [
      {
        id: ring.id,
        status: ring.status,
        initiatorId: ring.initiatorId,
        createdAt: ring.createdAt.toISOString().slice(0, 10),
        participants,
        messageCount: countMap.get(ring.id) ?? 0,
      },
    ];
  });
}

/** Lädt einen Ring samt Verlauf — nur für die drei Beteiligten. */
export async function getRingForUser(ringId: string, userId: string): Promise<RingDetail | null> {
  const [ring] = await db.select().from(ringSwaps).where(eq(ringSwaps.id, ringId)).limit(1);
  if (!ring) return null;

  const legs = await db
    .select()
    .from(ringLegs)
    .where(eq(ringLegs.ringId, ringId))
    .orderBy(ringLegs.position);
  if (legs.length !== 3) return null;
  if (!legs.some((l) => l.userId === userId)) return null;

  const [messageRows, vehicleMap, userRows, paymentRows] = await Promise.all([
    db
      .select()
      .from(dealMessages)
      .where(eq(dealMessages.ringId, ringId))
      .orderBy(dealMessages.createdAt),
    getVehiclesByIds(legs.map((l) => l.vehicleId)),
    db.select().from(users).where(inArray(users.id, legs.map((l) => l.userId))),
    db
      .select({
        payerId: payments.payerId,
        payeeId: payments.payeeId,
        amountMinor: payments.amountMinor,
        feeMinor: payments.feeMinor,
        status: payments.status,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(eq(payments.ringId, ringId))
      .orderBy(desc(payments.createdAt)),
  ]);

  const userMap = new Map(userRows.map((u) => [u.id, toUser(u)]));
  const participants = toParticipants(legs, vehicleMap, userMap);
  if (!participants) return null;

  // Je Weg zählt nur der jüngste Versuch — ältere, verfallene Sessions
  // stehen sonst als zweite Zeile in der Übersicht.
  const jüngste = new Map<string, RingPaymentView>();
  for (const row of paymentRows) {
    const key = `${row.payerId}|${row.payeeId}`;
    if (!jüngste.has(key)) {
      jüngste.set(key, {
        payerId: row.payerId,
        payeeId: row.payeeId,
        amountMinor: row.amountMinor,
        feeMinor: row.feeMinor,
        status: row.status,
      });
    }
  }

  return {
    id: ring.id,
    status: ring.status,
    initiatorId: ring.initiatorId,
    createdAt: ring.createdAt.toISOString().slice(0, 10),
    participants,
    messageCount: messageRows.length,
    messages: messageRows.map((m) => ({
      id: m.id,
      authorId: m.authorId,
      at: m.createdAt.toISOString(),
      text: m.body,
      system: m.system,
    })),
    payments: [...jüngste.values()],
  };
}
