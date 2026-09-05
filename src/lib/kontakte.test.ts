import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { deals, ringLegs, ringSwaps, users } from "@/lib/db/schema";
import type { DealStatusDb, RingStatusDb } from "@/lib/db/schema";
import { getDealKontakte, getRingKontakte } from "@/lib/queries";
import { createUser, createVehicle, resetDatabase } from "@/test/fixtures";

beforeEach(async () => {
  await resetDatabase();
});

async function mitNummer(name: string, nummer: string | null): Promise<string> {
  const id = await createUser(name);
  await db.update(users).set({ phone: nummer }).where(eq(users.id, id));
  return id;
}

async function tausch(a: string, b: string, status: DealStatusDb): Promise<string> {
  const id = newId("dl");
  await db.insert(deals).values({
    id,
    fromVehicleId: await createVehicle(a),
    toVehicleId: await createVehicle(b),
    initiatorId: a,
    counterpartyId: b,
    cashDelta: 0,
    status,
  });
  return id;
}

async function ring(ids: string[], status: RingStatusDb): Promise<string> {
  const id = newId("ring");
  await db.insert(ringSwaps).values({ id, initiatorId: ids[0], status });
  for (const [i, userId] of ids.entries()) {
    await db.insert(ringLegs).values({
      id: newId("leg"),
      ringId: id,
      position: i,
      userId,
      vehicleId: await createVehicle(userId),
      receiverId: ids[(i + 1) % ids.length],
      cash: 0,
    });
  }
  return id;
}

describe("Telefonnummer im Zweiertausch", () => {
  it("bleibt verdeckt, solange nur verhandelt wird", async () => {
    const anna = await mitNummer("Anna", "+41 79 111 11 11");
    const bruno = await mitNummer("Bruno", "+41 79 222 22 22");
    for (const status of ["vorschlag", "verhandlung", "abgelehnt", "storniert"] as const) {
      const d = await tausch(anna, bruno, status);
      expect(await getDealKontakte(d, anna), status).toEqual([]);
      expect(await getDealKontakte(d, bruno), status).toEqual([]);
    }
  });

  it("wird ab der Zusage sichtbar — und zwar nur die der Gegenseite", async () => {
    const anna = await mitNummer("Anna", "+41 79 111 11 11");
    const bruno = await mitNummer("Bruno", "+41 79 222 22 22");
    const d = await tausch(anna, bruno, "angenommen");

    expect(await getDealKontakte(d, anna)).toEqual([
      { userId: bruno, name: "Bruno", phone: "+41 79 222 22 22" },
    ]);
    expect(await getDealKontakte(d, bruno)).toEqual([
      { userId: anna, name: "Anna", phone: "+41 79 111 11 11" },
    ]);
  });

  it("bleibt bis zum Abschluss sichtbar", async () => {
    const anna = await mitNummer("Anna", "+41 79 111 11 11");
    const bruno = await mitNummer("Bruno", "+41 79 222 22 22");
    for (const status of ["treuhand", "abwicklung", "abgeschlossen"] as const) {
      const d = await tausch(anna, bruno, status);
      expect(await getDealKontakte(d, anna), status).toHaveLength(1);
    }
  });

  it("gibt Unbeteiligten nichts", async () => {
    const anna = await mitNummer("Anna", "+41 79 111 11 11");
    const bruno = await mitNummer("Bruno", "+41 79 222 22 22");
    const carla = await mitNummer("Carla", "+41 79 333 33 33");
    const d = await tausch(anna, bruno, "angenommen");
    expect(await getDealKontakte(d, carla)).toEqual([]);
  });

  it("lässt eine fehlende Nummer einfach weg", async () => {
    const anna = await mitNummer("Anna", "+41 79 111 11 11");
    const bruno = await mitNummer("Bruno", null);
    const d = await tausch(anna, bruno, "angenommen");
    expect(await getDealKontakte(d, anna)).toEqual([]);
    expect(await getDealKontakte(d, bruno)).toHaveLength(1);
  });
});

describe("Telefonnummern im Ringtausch", () => {
  it("bleiben verdeckt, solange der Ring nicht steht", async () => {
    const ids = [
      await mitNummer("Anna", "+41 79 111 11 11"),
      await mitNummer("Bruno", "+41 79 222 22 22"),
      await mitNummer("Carla", "+41 79 333 33 33"),
    ];
    const r = await ring(ids, "vorschlag");
    expect(await getRingKontakte(r, ids[0])).toEqual([]);
  });

  it("zeigen ab der Zusage die beiden anderen", async () => {
    const ids = [
      await mitNummer("Anna", "+41 79 111 11 11"),
      await mitNummer("Bruno", "+41 79 222 22 22"),
      await mitNummer("Carla", "+41 79 333 33 33"),
    ];
    const r = await ring(ids, "angenommen");
    const kontakte = await getRingKontakte(r, ids[0]);
    expect(kontakte.map((k) => k.name).sort()).toEqual(["Bruno", "Carla"]);
    expect(kontakte.map((k) => k.userId)).not.toContain(ids[0]);
  });

  it("geben Unbeteiligten nichts", async () => {
    const ids = [
      await mitNummer("Anna", "+41 79 111 11 11"),
      await mitNummer("Bruno", "+41 79 222 22 22"),
      await mitNummer("Carla", "+41 79 333 33 33"),
    ];
    const fremd = await mitNummer("Fremd", "+41 79 444 44 44");
    const r = await ring(ids, "abgeschlossen");
    expect(await getRingKontakte(r, fremd)).toEqual([]);
  });
});
