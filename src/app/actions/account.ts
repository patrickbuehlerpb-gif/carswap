"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authTokens,
  dealMessages,
  deals,
  listings,
  payments,
  sessions,
  users,
  vehicles,
  watchlist,
} from "@/lib/db/schema";
import { destroySession, requireUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import {
  connectOnboardingUrl,
  ensureConnectAccount,
  refreshPayoutStatus,
  stripeConfigured,
} from "@/lib/payments";

export interface AccountResult {
  ok?: boolean;
  error?: string;
  notice?: string;
  redirectTo?: string;
}

const profileSchema = z.object({
  name: z.string().trim().min(2, "Bitte den Namen angeben.").max(80),
  location: z.string().trim().max(80),
  canton: z.string().trim().max(2),
  phone: z.string().trim().max(30).optional(),
});

export async function updateProfileAction(
  _prev: AccountResult,
  formData: FormData,
): Promise<AccountResult> {
  const me = await requireUser();
  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    location: formData.get("location") ?? "",
    canton: formData.get("canton") ?? "",
    phone: formData.get("phone") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Eingaben unvollständig." };

  await db
    .update(users)
    .set({
      name: parsed.data.name,
      location: parsed.data.location,
      canton: parsed.data.canton.toUpperCase(),
      phone: parsed.data.phone || null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, me.id));

  revalidatePath("/konto");
  revalidatePath("/garage");
  return { notice: "Profil gespeichert." };
}

/**
 * Startet oder setzt das Stripe-Connect-Onboarding fort. Ohne dieses Konto
 * kann die Gegenseite eine Ausgleichszahlung nicht empfangen.
 */
export async function startPayoutOnboardingAction(): Promise<AccountResult> {
  const me = await requireUser();
  if (!stripeConfigured()) {
    return { error: "Auszahlungen sind auf dieser Installation noch nicht eingerichtet." };
  }
  try {
    const accountId = await ensureConnectAccount(me.id, me.email);
    const url = await connectOnboardingUrl(accountId);
    return { ok: true, redirectTo: url };
  } catch (err) {
    console.error("Connect-Onboarding fehlgeschlagen:", err);
    return { error: "Das Auszahlungskonto konnte nicht angelegt werden. Bitte später erneut." };
  }
}

export async function refreshPayoutStatusAction(): Promise<AccountResult> {
  const me = await requireUser();
  if (!stripeConfigured() || !me.stripeAccountId) return { ok: true };
  try {
    const enabled = await refreshPayoutStatus(me.id);
    revalidatePath("/konto");
    return { ok: true, notice: enabled ? "Auszahlungen sind freigeschaltet." : undefined };
  } catch (err) {
    console.error("Statusabfrage fehlgeschlagen:", err);
    return { error: "Der Status konnte nicht abgefragt werden." };
  }
}

/* ------------------------------------------------------------------ */
/* Auskunft und Löschung                                               */
/* ------------------------------------------------------------------ */

/**
 * Gibt alle zum Konto gespeicherten Daten als JSON zurück. Die Datenschutz-
 * erklärung sagt Auskunft zu — ohne diesen Pfad wäre das ein leeres
 * Versprechen.
 */
export async function exportMyDataAction(): Promise<{ json?: string; error?: string }> {
  const me = await requireUser();

  const limit = await checkRateLimit(`export:${me.id}`, 5, 24 * 60 * 60);
  if (!limit.ok) return { error: "Zu viele Auskunftsanfragen. Bitte morgen erneut." };

  const [konto] = await db.select().from(users).where(eq(users.id, me.id)).limit(1);
  if (!konto) return { error: "Konto nicht gefunden." };

  const [meineFahrzeuge, meineInserate, meineDeals, meineZahlungen, meineMerkliste] =
    await Promise.all([
      db.select().from(vehicles).where(eq(vehicles.ownerId, me.id)),
      db.select().from(listings).where(eq(listings.ownerId, me.id)),
      db
        .select()
        .from(deals)
        .where(or(eq(deals.initiatorId, me.id), eq(deals.counterpartyId, me.id))),
      db
        .select()
        .from(payments)
        .where(or(eq(payments.payerId, me.id), eq(payments.payeeId, me.id))),
      db.select().from(watchlist).where(eq(watchlist.userId, me.id)),
    ]);

  const dealIds = meineDeals.map((d) => d.id);
  const nachrichten = dealIds.length
    ? await db.select().from(dealMessages).where(inArray(dealMessages.dealId, dealIds))
    : [];

  // Der Passwort-Hash gehört nicht in eine Auskunft — er ist kein
  // personenbezogenes Datum im Sinne der Auskunftspflicht, aber ein Geheimnis.
  const { passwordHash: _hash, ...kontoOhneGeheimnis } = konto;

  return {
    json: JSON.stringify(
      {
        erstelltAm: new Date().toISOString(),
        konto: kontoOhneGeheimnis,
        fahrzeuge: meineFahrzeuge,
        inserate: meineInserate,
        tausche: meineDeals,
        nachrichten,
        zahlungen: meineZahlungen,
        merkliste: meineMerkliste,
      },
      null,
      2,
    ),
  };
}

/**
 * Löscht das Konto. Abgeschlossene Tausche bleiben bestehen, werden aber vom
 * Konto entkoppelt: Name, Adresse und Kontaktdaten werden entfernt, die
 * E-Mail-Adresse durch eine unbrauchbare Kennung ersetzt. Fahrzeuge und
 * Inserate verschwinden aus dem Markt.
 */
export async function deleteAccountAction(bestaetigung: string): Promise<AccountResult> {
  const me = await requireUser();
  if (bestaetigung.trim().toUpperCase() !== "LÖSCHEN") {
    return { error: "Bitte zum Bestätigen das Wort LÖSCHEN eintippen." };
  }

  // Ein laufender verbindlicher Tausch muss zuerst zu Ende gebracht werden —
  // sonst stünde die Gegenseite mit einem Auto und ohne Ansprechpartner da.
  const offen = await db
    .select({ id: deals.id })
    .from(deals)
    .where(
      and(
        or(eq(deals.initiatorId, me.id), eq(deals.counterpartyId, me.id)),
        inArray(deals.status, ["angenommen", "treuhand", "abwicklung"]),
      ),
    )
    .limit(1);
  if (offen.length) {
    return {
      error:
        "Zu deinem Konto läuft noch ein verbindlich zugesagter Tausch. Er muss erst abgeschlossen " +
        "oder abgebrochen sein.",
    };
  }

  await db.transaction(async (tx) => {
    // Offene Vorschläge zurückziehen
    await tx
      .update(deals)
      .set({ status: "storniert", updatedAt: new Date() })
      .where(
        and(
          or(eq(deals.initiatorId, me.id), eq(deals.counterpartyId, me.id)),
          inArray(deals.status, ["vorschlag", "verhandlung"]),
        ),
      );

    // Fahrzeuge aus dem Markt nehmen
    await tx
      .update(listings)
      .set({ status: "pausiert", updatedAt: new Date() })
      .where(and(eq(listings.ownerId, me.id), ne(listings.status, "getauscht")));
    await tx
      .update(vehicles)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(vehicles.ownerId, me.id));

    await tx.delete(watchlist).where(eq(watchlist.userId, me.id));
    await tx.delete(authTokens).where(eq(authTokens.userId, me.id));
    await tx.delete(sessions).where(eq(sessions.userId, me.id));

    await tx
      .update(users)
      .set({
        // Die Adresse muss eindeutig bleiben (Unique-Index) und darf sich
        // nicht mehr zum Anmelden eignen.
        email: `geloescht+${me.id}@invalid`,
        name: "Gelöschtes Konto",
        location: "",
        canton: "",
        phone: null,
        passwordHash: "geloescht",
        emailVerifiedAt: null,
        identityVerified: false,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, me.id));
  });

  await destroySession();
  return { ok: true, redirectTo: "/?konto=geloescht" };
}
