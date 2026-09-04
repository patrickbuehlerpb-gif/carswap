"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { deals, listings, vehicles } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { listingSchema, type ListingInput } from "@/lib/validation";

export interface SaveResult {
  ok?: boolean;
  error?: string;
  vehicleId?: string;
}

function toRow(input: ListingInput) {
  return {
    make: input.make,
    model: input.model,
    trim: input.trim,
    // Der Monat wird auf den 15. gelegt: die Bewertung rechnet auf Monatsebene
    firstRegistration: `${input.firstRegistration}-15`,
    mileageKm: input.mileageKm,
    fuel: input.fuel,
    body: input.body,
    drivetrain: input.drivetrain,
    powerPs: input.powerPs,
    listPriceNew: input.listPriceNew,
    condition: input.condition,
    color: input.color,
    rangeKm: input.rangeKm ?? null,
    batterySoh: input.fuel === "elektro" ? (input.batterySoh ?? null) : null,
    features: input.features,
    notes: input.notes || null,
    defects: input.defects,
    serviceHistory: input.serviceHistory,
    previousOwners: input.previousOwners,
    accidentFree: input.accidentFree,
    mfkUntil: input.mfkUntil || null,
    photos: input.photos,
  };
}

function wishRow(input: ListingInput) {
  return {
    wishMakes: input.wishMakes,
    wishBodies: input.wishBodies,
    wishFuels: input.wishFuels,
    wishMinYear: input.wishMinYear ?? null,
    wishMaxMileageKm: input.wishMaxMileageKm ?? null,
    wishMaxCashOut: input.wishMaxCashOut ?? null,
    wishNotes: input.wishNotes || null,
    askPremium: input.askPremium,
  };
}

export async function createListingAction(raw: unknown): Promise<SaveResult> {
  const me = await requireUser();

  const limit = await checkRateLimit(`listing:${me.id}`, 10, 24 * 60 * 60);
  if (!limit.ok) return { error: "Zu viele Inserate in kurzer Zeit. Bitte morgen weitermachen." };

  const parsed = listingSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Eingaben unvollständig." };

  const vehicleId = newId("veh");
  await db.transaction(async (tx) => {
    await tx.insert(vehicles).values({ id: vehicleId, ownerId: me.id, ...toRow(parsed.data) });
    await tx.insert(listings).values({
      id: newId("lst"),
      vehicleId,
      ownerId: me.id,
      status: "aktiv",
      ...wishRow(parsed.data),
    });
  });

  revalidatePath("/garage");
  revalidatePath("/markt");
  return { ok: true, vehicleId };
}

export async function updateListingAction(vehicleId: string, raw: unknown): Promise<SaveResult> {
  const me = await requireUser();

  const [owned] = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.ownerId, me.id)))
    .limit(1);
  if (!owned) return { error: "Dieses Fahrzeug gehört nicht zu deinem Konto." };

  const parsed = listingSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Eingaben unvollständig." };

  // Kilometerstand darf nicht zurücklaufen — das wäre entweder ein Tippfehler
  // oder ein Manipulationsversuch.
  if (parsed.data.mileageKm < owned.mileageKm - 100) {
    return {
      error: `Der Kilometerstand liegt unter dem zuletzt gespeicherten (${owned.mileageKm.toLocaleString(
        "de-CH",
      )} km). Bitte prüfen.`,
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(vehicles)
      .set({ ...toRow(parsed.data), updatedAt: new Date() })
      .where(eq(vehicles.id, vehicleId));
    await tx
      .update(listings)
      .set({ ...wishRow(parsed.data), updatedAt: new Date() })
      .where(eq(listings.vehicleId, vehicleId));
  });

  revalidatePath("/garage");
  revalidatePath(`/fahrzeug/${vehicleId}`);
  revalidatePath("/markt");
  return { ok: true, vehicleId };
}

/** Nimmt ein Inserat vom Markt, ohne das Fahrzeug zu löschen. */
export async function setListingStatusAction(
  vehicleId: string,
  status: "aktiv" | "pausiert",
): Promise<SaveResult> {
  const me = await requireUser();
  const rows = await db
    .update(listings)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(listings.vehicleId, vehicleId),
        eq(listings.ownerId, me.id),
        or(eq(listings.status, "aktiv"), eq(listings.status, "pausiert")),
      ),
    )
    .returning({ id: listings.id });
  if (!rows.length) return { error: "Das Inserat lässt sich gerade nicht ändern." };

  revalidatePath("/garage");
  revalidatePath("/markt");
  return { ok: true };
}

/**
 * Archiviert ein Fahrzeug. Gelöscht wird nichts, weil abgeschlossene Tausche
 * weiterhin darauf verweisen.
 */
export async function archiveVehicleAction(vehicleId: string): Promise<SaveResult> {
  const me = await requireUser();

  const open = await db
    .select({ id: deals.id })
    .from(deals)
    .where(
      and(
        or(eq(deals.fromVehicleId, vehicleId), eq(deals.toVehicleId, vehicleId)),
        or(
          eq(deals.status, "vorschlag"),
          eq(deals.status, "verhandlung"),
          eq(deals.status, "angenommen"),
          eq(deals.status, "treuhand"),
        ),
      ),
    )
    .limit(1);
  if (open.length) {
    return { error: "Zu diesem Fahrzeug läuft noch ein Tausch. Bitte diesen zuerst abschliessen." };
  }

  const rows = await db
    .update(vehicles)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.ownerId, me.id)))
    .returning({ id: vehicles.id });
  if (!rows.length) return { error: "Dieses Fahrzeug gehört nicht zu deinem Konto." };

  await db
    .update(listings)
    .set({ status: "pausiert", updatedAt: new Date() })
    .where(and(eq(listings.vehicleId, vehicleId), ne(listings.status, "getauscht")));

  revalidatePath("/garage");
  revalidatePath("/markt");
  return { ok: true };
}
