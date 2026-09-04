"use server";

import { revalidatePath } from "next/cache";

import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { deals, listings, reports, users, vehicles } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { sendMail, siteUrl } from "@/lib/mail";
import { operator } from "@/lib/operator";

export interface ReportResult {
  ok?: boolean;
  error?: string;
}

const schema = z.object({
  reason: z.enum([
    "betrugsverdacht",
    "falsche angaben",
    "verbotenes fahrzeug",
    "beleidigend",
    "anderes",
  ]),
  note: z.string().trim().max(2_000),
});

/**
 * Meldet ein Inserat. Die Meldung geht in die Datenbank UND per Mail an die
 * Betreiberin — eine Tabelle, die niemand ansieht, wäre keine Meldefunktion.
 */
export async function reportListingAction(
  vehicleId: string,
  reason: string,
  note: string,
): Promise<ReportResult> {
  const me = await requireUser();

  const parsed = schema.safeParse({ reason, note });
  if (!parsed.success) return { error: "Bitte einen Grund auswählen." };

  const limit = await checkRateLimit(`report:${me.id}`, 20, 24 * 60 * 60);
  if (!limit.ok) return { error: "Zu viele Meldungen in kurzer Zeit." };

  const [ziel] = await db
    .select({ listing: listings, vehicle: vehicles })
    .from(listings)
    .innerJoin(vehicles, eq(vehicles.id, listings.vehicleId))
    .where(eq(listings.vehicleId, vehicleId))
    .limit(1);
  if (!ziel) return { error: "Inserat nicht gefunden." };
  if (ziel.listing.ownerId === me.id) {
    return { error: "Das ist dein eigenes Inserat." };
  }

  const angelegt = await db
    .insert(reports)
    .values({
      id: newId("rep"),
      listingId: ziel.listing.id,
      reporterId: me.id,
      reason: parsed.data.reason,
      note: parsed.data.note || null,
    })
    .onConflictDoNothing({ target: [reports.listingId, reports.reporterId] })
    .returning({ id: reports.id });
  if (!angelegt.length) return { error: "Du hast dieses Inserat bereits gemeldet." };

  const empfaenger = operator().email;
  if (empfaenger) {
    await sendMail({
      to: empfaenger,
      subject: `CarSwap: Meldung zu einem Inserat (${parsed.data.reason})`,
      text:
        `Gemeldet von ${me.name} (${me.email})\n` +
        `Fahrzeug: ${ziel.vehicle.make} ${ziel.vehicle.model}\n` +
        `${siteUrl()}/fahrzeug/${vehicleId}\n\n` +
        `Grund: ${parsed.data.reason}\n` +
        `${parsed.data.note || "(keine weiteren Angaben)"}\n`,
    });
  } else {
    console.warn(
      `[meldung] ${angelegt[0].id} zu Inserat ${ziel.listing.id} — OPERATOR_EMAIL fehlt, ` +
        "niemand wurde benachrichtigt.",
    );
  }

  return { ok: true };
}

/**
 * Sperrt ein gemeldetes Inserat. Es verschwindet aus dem Markt und lässt sich
 * vom Besitzer nicht wieder aktivieren — anders als «pausiert», das ihm
 * gehört. Läuft zu dem Fahrzeug ein verbindlicher Tausch, muss der zuerst
 * geklärt werden; ihn hier abzubrechen würde Geld bewegen.
 */
export async function blockListingAction(
  reportId: string,
  grund: string,
): Promise<ReportResult> {
  const me = await requireUser();
  if (!me.isAdmin) return { error: "Dafür fehlt dir die Berechtigung." };

  const [meldung] = await db
    .select({ listingId: reports.listingId, vehicleId: listings.vehicleId })
    .from(reports)
    .innerJoin(listings, eq(listings.id, reports.listingId))
    .where(eq(reports.id, reportId))
    .limit(1);
  if (!meldung) return { error: "Meldung nicht gefunden." };

  const gebunden = await db
    .select({ id: deals.id })
    .from(deals)
    .where(
      and(
        or(eq(deals.fromVehicleId, meldung.vehicleId), eq(deals.toVehicleId, meldung.vehicleId)),
        inArray(deals.status, ["angenommen", "treuhand", "abwicklung"]),
      ),
    )
    .limit(1);
  if (gebunden.length) {
    return {
      error:
        "Zu diesem Fahrzeug läuft ein verbindlich zugesagter Tausch. Der muss zuerst geklärt " +
        "werden — ihn hier abzubrechen würde Geld bewegen.",
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(listings)
      .set({
        status: "pausiert",
        blockedAt: new Date(),
        blockedReason: grund.trim().slice(0, 500) || null,
        updatedAt: new Date(),
      })
      .where(eq(listings.id, meldung.listingId));
    // Offene Vorschläge zu diesem Fahrzeug fallen weg.
    await tx
      .update(deals)
      .set({ status: "storniert", updatedAt: new Date() })
      .where(
        and(
          or(eq(deals.fromVehicleId, meldung.vehicleId), eq(deals.toVehicleId, meldung.vehicleId)),
          inArray(deals.status, ["vorschlag", "verhandlung"]),
        ),
      );
    await tx.update(reports).set({ status: "geprüft" }).where(eq(reports.id, reportId));
  });

  revalidatePath("/admin/meldungen");
  revalidatePath("/markt");
  return { ok: true };
}

/**
 * Legt das Konto hinter einem gemeldeten Inserat still. Anmelden geht weiter —
 * sonst käme die Person nicht mehr an ihre laufenden Tausche und ihre Daten —,
 * inserieren und tauschen nicht mehr.
 */
export async function suspendOwnerAction(
  reportId: string,
  grund: string,
): Promise<ReportResult> {
  const me = await requireUser();
  if (!me.isAdmin) return { error: "Dafür fehlt dir die Berechtigung." };

  const [meldung] = await db
    .select({ ownerId: listings.ownerId })
    .from(reports)
    .innerJoin(listings, eq(listings.id, reports.listingId))
    .where(eq(reports.id, reportId))
    .limit(1);
  if (!meldung) return { error: "Meldung nicht gefunden." };
  if (meldung.ownerId === me.id) return { error: "Dich selbst kannst du nicht stilllegen." };

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        suspendedAt: new Date(),
        suspendedReason: grund.trim().slice(0, 500) || null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, meldung.ownerId));
    // Alles, was noch offen im Markt steht, verschwindet — aber nur pausiert,
    // nicht gesperrt: wird die Stilllegung aufgehoben, soll die Person ihre
    // Inserate wieder aktivieren können. Solange sie gilt, verhindert das der
    // Wächter in setListingStatusAction.
    await tx
      .update(listings)
      .set({ status: "pausiert", updatedAt: new Date() })
      .where(and(eq(listings.ownerId, meldung.ownerId), eq(listings.status, "aktiv")));
    await tx.update(reports).set({ status: "geprüft" }).where(eq(reports.id, reportId));
  });

  revalidatePath("/admin/meldungen");
  revalidatePath("/markt");
  return { ok: true };
}

/** Hebt eine Stilllegung wieder auf. */
export async function unsuspendUserAction(userId: string): Promise<ReportResult> {
  const me = await requireUser();
  if (!me.isAdmin) return { error: "Dafür fehlt dir die Berechtigung." };

  const rows = await db
    .update(users)
    .set({ suspendedAt: null, suspendedReason: null, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (!rows.length) return { error: "Konto nicht gefunden." };

  revalidatePath("/admin/meldungen");
  return { ok: true };
}

/** Hebt die Sperre eines Inserats wieder auf. */
export async function unblockListingAction(listingId: string): Promise<ReportResult> {
  const me = await requireUser();
  if (!me.isAdmin) return { error: "Dafür fehlt dir die Berechtigung." };

  const rows = await db
    .update(listings)
    .set({ blockedAt: null, blockedReason: null, updatedAt: new Date() })
    .where(eq(listings.id, listingId))
    .returning({ id: listings.id });
  if (!rows.length) return { error: "Inserat nicht gefunden." };

  revalidatePath("/admin/meldungen");
  revalidatePath("/markt");
  return { ok: true };
}

/** Hakt eine Meldung ab. Nur für die Betreiberin. */
export async function resolveReportAction(reportId: string): Promise<ReportResult> {
  const me = await requireUser();
  if (!me.isAdmin) return { error: "Dafür fehlt dir die Berechtigung." };

  const rows = await db
    .update(reports)
    .set({ status: "geprüft" })
    .where(eq(reports.id, reportId))
    .returning({ id: reports.id });
  if (!rows.length) return { error: "Meldung nicht gefunden." };

  revalidatePath("/admin/meldungen");
  return { ok: true };
}
