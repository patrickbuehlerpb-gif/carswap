import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { authTokens, deals, listings, sessions, users, vehicles, watchlist } from "@/lib/db/schema";
import { als, createUser, createVehicle, resetDatabase } from "@/test/fixtures";
import { deleteAccountAction, exportMyDataAction } from "@/app/actions/account";

beforeEach(async () => {
  await resetDatabase();
  als(null);
});

async function kontoMitAllem() {
  const a = await createUser("Anna");
  const b = await createUser("Bruno");
  const va = await createVehicle(a);
  const vb = await createVehicle(b);
  await db.insert(sessions).values({
    id: newId("ses"),
    userId: a,
    tokenHash: newId("tok"),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await db.insert(authTokens).values({
    id: newId("at"),
    userId: a,
    tokenHash: newId("tok"),
    purpose: "verify_email",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  const [inseratB] = await db.select().from(listings).where(eq(listings.vehicleId, vb));
  await db.insert(watchlist).values({ userId: a, listingId: inseratB.id });
  return { a, b, va, vb };
}

describe("Auskunft", () => {
  it("liefert die eigenen Daten ohne Passwort-Hash", async () => {
    const { a } = await kontoMitAllem();
    als(a);
    const res = await exportMyDataAction();
    expect(res.error).toBeUndefined();

    const daten = JSON.parse(res.json!);
    expect(daten.konto.id).toBe(a);
    expect(daten.konto.passwordHash).toBeUndefined();
    expect(daten.fahrzeuge).toHaveLength(1);
    expect(daten.merkliste).toHaveLength(1);
  });

  it("verlangt eine Anmeldung", async () => {
    await expect(exportMyDataAction()).rejects.toThrow(/Nicht angemeldet/);
  });
});

describe("Kontolöschung", () => {
  it("verlangt das Bestätigungswort", async () => {
    const { a } = await kontoMitAllem();
    als(a);
    expect((await deleteAccountAction("ja bitte")).error).toMatch(/LÖSCHEN/);
    const [row] = await db.select().from(users).where(eq(users.id, a));
    expect(row.deletedAt).toBeNull();
  });

  it("entkoppelt das Konto und räumt Fahrzeuge, Sitzungen und Token weg", async () => {
    const { a, va } = await kontoMitAllem();
    als(a);
    const res = await deleteAccountAction("löschen");
    expect(res.error).toBeUndefined();

    const [row] = await db.select().from(users).where(eq(users.id, a));
    expect(row.deletedAt).not.toBeNull();
    expect(row.name).toBe("Gelöschtes Konto");
    expect(row.email).toContain("@invalid");
    expect(row.phone).toBeNull();
    // Der Hash darf zu keinem Passwort mehr passen
    expect(row.passwordHash).toBe("geloescht");

    expect(await db.select().from(sessions).where(eq(sessions.userId, a))).toHaveLength(0);
    expect(await db.select().from(authTokens).where(eq(authTokens.userId, a))).toHaveLength(0);
    expect(await db.select().from(watchlist).where(eq(watchlist.userId, a))).toHaveLength(0);

    const [fahrzeug] = await db.select().from(vehicles).where(eq(vehicles.id, va));
    expect(fahrzeug.archivedAt).not.toBeNull();
    const [inserat] = await db.select().from(listings).where(eq(listings.vehicleId, va));
    expect(inserat.status).toBe("pausiert");
  });

  it("verweigert die Löschung bei laufendem verbindlichem Tausch", async () => {
    const { a, b, va, vb } = await kontoMitAllem();
    await db.insert(deals).values({
      id: newId("dl"),
      fromVehicleId: va,
      toVehicleId: vb,
      initiatorId: a,
      counterpartyId: b,
      cashDelta: 0,
      status: "treuhand",
    });
    als(a);
    const res = await deleteAccountAction("LÖSCHEN");
    expect(res.error).toMatch(/verbindlich zugesagter Tausch/);
    const [row] = await db.select().from(users).where(eq(users.id, a));
    expect(row.deletedAt).toBeNull();
  });

  it("zieht offene Vorschläge zurück", async () => {
    const { a, b, va, vb } = await kontoMitAllem();
    const dealId = newId("dl");
    await db.insert(deals).values({
      id: dealId,
      fromVehicleId: va,
      toVehicleId: vb,
      initiatorId: a,
      counterpartyId: b,
      cashDelta: 0,
      status: "verhandlung",
    });
    als(a);
    expect((await deleteAccountAction("LÖSCHEN")).error).toBeUndefined();
    const [row] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(row.status).toBe("storniert");
  });
});
