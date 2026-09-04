import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { listings, reports, users } from "@/lib/db/schema";
import { als, createUser, createVehicle, resetDatabase } from "@/test/fixtures";
import { reportListingAction, resolveReportAction } from "@/app/actions/reports";

beforeEach(async () => {
  await resetDatabase();
  als(null);
});

async function inserat() {
  const besitzer = await createUser("Bruno");
  const melder = await createUser("Anna");
  const vehicleId = await createVehicle(besitzer);
  return { besitzer, melder, vehicleId };
}

describe("Meldung abhaken", () => {
  it("lässt nur die Betreiberin abhaken", async () => {
    const { melder, vehicleId } = await inserat();
    als(melder);
    await reportListingAction(vehicleId, "anderes", "");
    const [meldung] = await db.select().from(reports);

    // Normale Konten dürfen nicht
    expect((await resolveReportAction(meldung.id)).error).toMatch(/Berechtigung/);
    expect((await db.select().from(reports))[0].status).toBe("offen");

    // Als Betreiberin schon
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, melder));
    expect((await resolveReportAction(meldung.id)).error).toBeUndefined();
    expect((await db.select().from(reports))[0].status).toBe("geprüft");
  });
});

describe("Inserat melden", () => {
  it("legt die Meldung an", async () => {
    const { melder, vehicleId } = await inserat();
    als(melder);
    expect((await reportListingAction(vehicleId, "betrugsverdacht", "Preis viel zu tief")).error)
      .toBeUndefined();

    const [row] = await db.select().from(reports);
    expect(row.reporterId).toBe(melder);
    expect(row.reason).toBe("betrugsverdacht");
    expect(row.status).toBe("offen");
    const [inseratRow] = await db.select().from(listings).where(eq(listings.vehicleId, vehicleId));
    expect(row.listingId).toBe(inseratRow.id);
  });

  it("nimmt dieselbe Meldung nicht zweimal", async () => {
    const { melder, vehicleId } = await inserat();
    als(melder);
    await reportListingAction(vehicleId, "anderes", "");
    expect((await reportListingAction(vehicleId, "anderes", "")).error).toMatch(/bereits gemeldet/);
    expect(await db.select().from(reports)).toHaveLength(1);
  });

  it("lässt das eigene Inserat nicht melden", async () => {
    const { besitzer, vehicleId } = await inserat();
    als(besitzer);
    expect((await reportListingAction(vehicleId, "anderes", "")).error).toMatch(/eigenes Inserat/);
  });

  it("weist einen unbekannten Grund ab", async () => {
    const { melder, vehicleId } = await inserat();
    als(melder);
    expect((await reportListingAction(vehicleId, "gefällt mir nicht", "")).error).toBeDefined();
    expect(await db.select().from(reports)).toHaveLength(0);
  });

  it("verlangt eine Anmeldung", async () => {
    const { vehicleId } = await inserat();
    await expect(reportListingAction(vehicleId, "anderes", "")).rejects.toThrow(/Nicht angemeldet/);
  });
});
