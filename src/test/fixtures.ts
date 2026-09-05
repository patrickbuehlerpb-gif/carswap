import { sql as raw } from "drizzle-orm";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { listings, users, vehicles } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { testSession } from "./setup";

/** Setzt den angemeldeten Nutzer für die folgenden Aktionsaufrufe. */
export function als(userId: string | null): void {
  testSession.userId = userId;
}

/** Leert alle Tabellen. Reihenfolge egal, weil CASCADE die Verweise löst. */
export async function resetDatabase(): Promise<void> {
  await db.execute(raw`truncate table
    deal_vehicle_locks, deal_messages, payments, deals, ring_legs, ring_swaps,
    watchlist, reviews, reports,
    listings, vehicles, sessions, auth_tokens, rate_limits, webhook_events, users
    restart identity cascade`);
}

export async function createUser(
  name: string,
  extra: {
    stripeAccountId?: string;
    stripePayoutsEnabled?: boolean;
    /** Echtes Passwort — nur nötig, wo eine Aktion es nachprüft. */
    password?: string;
    email?: string;
  } = {},
): Promise<string> {
  const id = newId("usr");
  await db.insert(users).values({
    id,
    email: extra.email ?? `${id}@test.invalid`,
    name,
    passwordHash: extra.password
      ? await hashPassword(extra.password)
      : "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA",
    emailVerifiedAt: new Date(),
    stripeAccountId: extra.stripeAccountId ?? null,
    stripePayoutsEnabled: extra.stripePayoutsEnabled ?? false,
  });
  return id;
}

/** Ein Fahrzeug samt aktivem Inserat. */
export async function createVehicle(
  ownerId: string,
  overrides: Partial<typeof vehicles.$inferInsert> = {},
): Promise<string> {
  const id = newId("veh");
  await db.insert(vehicles).values({
    id,
    ownerId,
    make: "Polestar",
    model: "4",
    firstRegistration: "2024-03-15",
    mileageKm: 20_000,
    fuel: "elektro",
    body: "suv",
    drivetrain: "heck",
    powerPs: 272,
    listPriceNew: 68_000,
    condition: "gut",
    serviceHistory: "lückenlos scheckheft",
    ...overrides,
  });
  await db.insert(listings).values({
    id: newId("lst"),
    vehicleId: id,
    ownerId,
    status: "aktiv",
  });
  return id;
}
