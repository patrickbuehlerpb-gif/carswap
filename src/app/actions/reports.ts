"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { listings, reports, vehicles } from "@/lib/db/schema";
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
