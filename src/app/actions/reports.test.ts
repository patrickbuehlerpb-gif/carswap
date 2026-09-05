import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deals, listings, reports, users } from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";
import { als, createUser, createVehicle, resetDatabase } from "@/test/fixtures";
import {
  blockListingAction,
  reportListingAction,
  resolveReportAction,
  suspendOwnerAction,
  unblockListingAction,
  unsuspendUserAction,
} from "@/app/actions/reports";
import { proposeSwapAction } from "@/app/actions/deals";
import { setListingStatusAction } from "@/app/actions/listings";
import { exportMyDataAction } from "@/app/actions/account";

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

describe("Sperren und stilllegen", () => {
  async function gemeldet() {
    const { besitzer, melder, vehicleId } = await inserat();
    als(melder);
    await reportListingAction(vehicleId, "betrugsverdacht", "Sieht nach Betrug aus");
    const [meldung] = await db.select().from(reports);
    const admin = await createUser("Admin");
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, admin));
    return { besitzer, melder, admin, vehicleId, meldungId: meldung.id };
  }

  it("nimmt ein gesperrtes Inserat aus dem Markt und lässt es nicht reaktivieren", async () => {
    const { besitzer, admin, vehicleId, meldungId } = await gemeldet();
    als(admin);
    expect((await blockListingAction(meldungId, "Kennzeichen gefälscht")).error).toBeUndefined();

    const [inseratRow] = await db.select().from(listings).where(eq(listings.vehicleId, vehicleId));
    expect(inseratRow.status).toBe("pausiert");
    expect(inseratRow.blockedAt).not.toBeNull();
    expect(inseratRow.blockedReason).toBe("Kennzeichen gefälscht");

    // Der Besitzer kommt nicht mehr daran
    als(besitzer);
    expect((await setListingStatusAction(vehicleId, "aktiv")).error).toMatch(/gesperrt/);
    const [danach] = await db.select().from(listings).where(eq(listings.vehicleId, vehicleId));
    expect(danach.status).toBe("pausiert");
  });

  it("storniert offene Vorschläge zum gesperrten Fahrzeug", async () => {
    const { besitzer, melder, admin, vehicleId, meldungId } = await gemeldet();
    const meins = await createVehicle(melder);
    als(melder);
    const vorschlag = await proposeSwapAction({
      fromVehicleId: meins,
      toVehicleId: vehicleId,
      cashDelta: 0,
      message: "Interesse?",
    });
    expect(vorschlag.error).toBeUndefined();

    als(admin);
    expect((await blockListingAction(meldungId, "")).error).toBeUndefined();
    const [dealRow] = await db.select().from(deals).where(eq(deals.id, vorschlag.dealId!));
    expect(dealRow.status).toBe("storniert");
    void besitzer;
  });

  it("sperrt kein Inserat, an dem ein verbindlicher Tausch hängt", async () => {
    const { melder, admin, vehicleId, meldungId } = await gemeldet();
    const meins = await createVehicle(melder);
    await db.insert(deals).values({
      id: newId("dl"),
      fromVehicleId: meins,
      toVehicleId: vehicleId,
      initiatorId: melder,
      counterpartyId: (await db.select().from(listings).where(eq(listings.vehicleId, vehicleId)))[0]
        .ownerId,
      cashDelta: 0,
      status: "treuhand",
    });

    als(admin);
    const res = await blockListingAction(meldungId, "");
    expect(res.error).toMatch(/zugesagter Tausch/);
  });

  it("legt das Konto still: anmelden ja, handeln nein", async () => {
    const { besitzer, admin, vehicleId, meldungId } = await gemeldet();
    als(admin);
    expect((await suspendOwnerAction(meldungId, "Mehrfach auffällig")).error).toBeUndefined();

    const [konto] = await db.select().from(users).where(eq(users.id, besitzer));
    expect(konto.suspendedAt).not.toBeNull();
    // Aktive Inserate verschwinden
    const [inseratRow] = await db.select().from(listings).where(eq(listings.vehicleId, vehicleId));
    expect(inseratRow.status).toBe("pausiert");

    // Handeln ist gesperrt …
    als(besitzer);
    const neues = await createVehicle(await createUser("Chiara"));
    const res = await proposeSwapAction({
      fromVehicleId: vehicleId,
      toVehicleId: neues,
      cashDelta: 0,
      message: "Doch noch?",
    });
    expect(res.error).toMatch(/stillgelegt/);
    // … die Auskunft über die eigenen Daten nicht
    const auskunft = await exportMyDataAction();
    expect(auskunft.error).toBeUndefined();
  });

  it("macht die Stilllegung rückgängig — die Inserate lassen sich wieder aktivieren", async () => {
    const { besitzer, admin, vehicleId, meldungId } = await gemeldet();
    als(admin);
    await suspendOwnerAction(meldungId, "Zu prüfen");
    expect((await unsuspendUserAction(besitzer)).error).toBeUndefined();

    const [konto] = await db.select().from(users).where(eq(users.id, besitzer));
    expect(konto.suspendedAt).toBeNull();

    // Beim Stilllegen wurde nur pausiert, nicht gesperrt — sonst käme die
    // Person nach der Aufhebung nie wieder an ihr Inserat.
    const [inseratRow] = await db.select().from(listings).where(eq(listings.vehicleId, vehicleId));
    expect(inseratRow.blockedAt).toBeNull();
    als(besitzer);
    expect((await setListingStatusAction(vehicleId, "aktiv")).error).toBeUndefined();
  });

  it("macht eine Sperre rückgängig", async () => {
    const { besitzer, admin, vehicleId, meldungId } = await gemeldet();
    als(admin);
    await blockListingAction(meldungId, "Verdacht");
    const [gesperrt] = await db.select().from(listings).where(eq(listings.vehicleId, vehicleId));
    expect((await unblockListingAction(gesperrt.id)).error).toBeUndefined();

    als(besitzer);
    expect((await setListingStatusAction(vehicleId, "aktiv")).error).toBeUndefined();
  });

  it("lässt nur die Betreiberin aufheben", async () => {
    const { besitzer, melder, admin, vehicleId, meldungId } = await gemeldet();
    als(admin);
    await blockListingAction(meldungId, "");
    const [gesperrt] = await db.select().from(listings).where(eq(listings.vehicleId, vehicleId));

    als(melder);
    expect((await unblockListingAction(gesperrt.id)).error).toMatch(/Berechtigung/);
    expect((await unsuspendUserAction(besitzer)).error).toMatch(/Berechtigung/);
  });

  it("lässt die Betreiberin sich nicht selbst stilllegen", async () => {
    const { besitzer, meldungId } = await gemeldet();
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, besitzer));
    als(besitzer);
    expect((await suspendOwnerAction(meldungId, "")).error).toMatch(/selbst/);
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
