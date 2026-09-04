import "server-only";
import { and, desc, eq, inArray, isNull, ne, or, sql as raw } from "drizzle-orm";
import { db } from "./db";
import { normalizeFeatures } from "./data/features";
import {
  dealMessages,
  deals,
  listings,
  users,
  vehicles,
  watchlist,
  type DealRow,
  type ListingRow,
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
    verified: row.identityVerified && row.emailVerifiedAt !== null,
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
/* Merkliste                                                           */
/* ------------------------------------------------------------------ */

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
