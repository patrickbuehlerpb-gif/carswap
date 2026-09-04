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
  reviews,
  ringLegs,
  ringSwaps,
  sessions,
  users,
  vehicles,
  watchlist,
} from "@/lib/db/schema";
import { destroySession, requireUser } from "@/lib/auth/session";
import { deleteBlobs } from "@/lib/blob";
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
  if (!parsed.success)
    return {
      error: parsed.error.issues[0]?.message ?? "Eingaben unvollständig.",
    };

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
    return {
      error:
        "Auszahlungen sind auf dieser Installation noch nicht eingerichtet.",
    };
  }
  try {
    const accountId = await ensureConnectAccount(me.id, me.email);
    const url = await connectOnboardingUrl(accountId);
    return { ok: true, redirectTo: url };
  } catch (err) {
    console.error("Connect-Onboarding fehlgeschlagen:", err);
    return {
      error:
        "Das Auszahlungskonto konnte nicht angelegt werden. Bitte später erneut.",
    };
  }
}

export async function refreshPayoutStatusAction(): Promise<AccountResult> {
  const me = await requireUser();
  if (!stripeConfigured() || !me.stripeAccountId) return { ok: true };
  try {
    const enabled = await refreshPayoutStatus(me.id);
    revalidatePath("/konto");
    return {
      ok: true,
      notice: enabled ? "Auszahlungen sind freigeschaltet." : undefined,
    };
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
export async function exportMyDataAction(): Promise<{
  json?: string;
  error?: string;
}> {
  const me = await requireUser();

  const limit = await checkRateLimit(`export:${me.id}`, 5, 24 * 60 * 60);
  if (!limit.ok)
    return { error: "Zu viele Auskunftsanfragen. Bitte morgen erneut." };

  const [konto] = await db
    .select()
    .from(users)
    .where(eq(users.id, me.id))
    .limit(1);
  if (!konto) return { error: "Konto nicht gefunden." };

  const [
    meineFahrzeuge,
    meineInserate,
    meineDeals,
    meineZahlungen,
    meineMerkliste,
    meineBewertungen,
  ] = await Promise.all([
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
    // Beides gehört dazu: was ich geschrieben habe und was über mich steht.
    db
      .select()
      .from(reviews)
      .where(or(eq(reviews.authorId, me.id), eq(reviews.subjectId, me.id))),
  ]);

  const meineRingBeine = await db.select().from(ringLegs).where(eq(ringLegs.userId, me.id));
  const ringIds = [...new Set(meineRingBeine.map((l) => l.ringId))];
  const meineRinge = ringIds.length
    ? await db.select().from(ringSwaps).where(inArray(ringSwaps.id, ringIds))
    : [];

  const dealIds = meineDeals.map((d) => d.id);
  const nachrichten = [
    ...(dealIds.length
      ? await db.select().from(dealMessages).where(inArray(dealMessages.dealId, dealIds))
      : []),
    ...(ringIds.length
      ? await db.select().from(dealMessages).where(inArray(dealMessages.ringId, ringIds))
      : []),
  ];

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
        ringtausche: meineRinge,
        ringbeine: meineRingBeine,
        nachrichten,
        zahlungen: meineZahlungen,
        merkliste: meineMerkliste,
        bewertungen: meineBewertungen,
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
export async function deleteAccountAction(
  bestaetigung: string,
): Promise<AccountResult> {
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

  // Dasselbe gilt für einen verbindlich gewordenen Ring: dort warten zwei
  // andere Personen auf eine Übergabe.
  const offenerRing = await db
    .select({ id: ringSwaps.id })
    .from(ringSwaps)
    .innerJoin(ringLegs, eq(ringLegs.ringId, ringSwaps.id))
    .where(
      and(
        eq(ringLegs.userId, me.id),
        inArray(ringSwaps.status, ["angenommen", "treuhand", "abwicklung"]),
      ),
    )
    .limit(1);
  if (offenerRing.length) {
    return {
      error:
        "Zu deinem Konto läuft noch ein verbindlich zugesagter Ringtausch. Er muss erst " +
        "abgeschlossen oder abgebrochen sein.",
    };
  }

  // Auch eine Zahlung, die noch in der Luft hängt, hält die Löschung auf.
  // Sie kann einen abgebrochenen Tausch überleben — etwa wenn die Freigabe
  // bei Stripe scheitert. Danach wäre niemand mehr erreichbar, dem das Geld
  // gehört.
  const offeneZahlung = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        or(eq(payments.payerId, me.id), eq(payments.payeeId, me.id)),
        inArray(payments.status, ["erstellt", "autorisiert", "eingezogen"]),
      ),
    )
    .limit(1);
  if (offeneZahlung.length) {
    return {
      error:
        "Zu deinem Konto ist noch ein Betrag hinterlegt oder unterwegs. Bitte melde dich beim " +
        "Support — sobald die Zahlung abgeschlossen oder freigegeben ist, lässt sich das Konto löschen.",
    };
  }

  const zuLoeschendeFotos: string[] = [];

  try {
    await db.transaction(async (tx) => {
      // Die beiden Sperrgründe innerhalb der Transaktion erneut prüfen und
      // die Zeilen dabei sperren. Zwischen der Vorprüfung oben und hier
      // könnte die Gegenseite einen Vorschlag angenommen haben.
      const nochOffen = await tx
        .select({ id: deals.id })
        .from(deals)
        .where(
          and(
            or(eq(deals.initiatorId, me.id), eq(deals.counterpartyId, me.id)),
            inArray(deals.status, ["angenommen", "treuhand", "abwicklung"]),
          ),
        )
        .for("update")
        .limit(1);
      if (nochOffen.length) throw new LoeschKonflikt("verbindlicher Tausch");

      const nochRing = await tx
        .select({ id: ringSwaps.id })
        .from(ringSwaps)
        .innerJoin(ringLegs, eq(ringLegs.ringId, ringSwaps.id))
        .where(
          and(
            eq(ringLegs.userId, me.id),
            inArray(ringSwaps.status, ["angenommen", "treuhand", "abwicklung"]),
          ),
        )
        .for("update", { of: ringSwaps })
        .limit(1);
      if (nochRing.length) throw new LoeschKonflikt("verbindlicher Tausch");

      const nochZahlung = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            or(eq(payments.payerId, me.id), eq(payments.payeeId, me.id)),
            inArray(payments.status, ["erstellt", "autorisiert", "eingezogen"]),
          ),
        )
        .for("update")
        .limit(1);
      if (nochZahlung.length) throw new LoeschKonflikt("offene Zahlung");

      // Fotos merken, bevor die Fahrzeuge archiviert werden
      const meineFahrzeuge = await tx
        .select({ photos: vehicles.photos })
        .from(vehicles)
        .where(eq(vehicles.ownerId, me.id));
      for (const f of meineFahrzeuge) {
        for (const foto of f.photos ?? []) zuLoeschendeFotos.push(foto.url);
      }

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

      // Offene Ringvorschläge ebenfalls: ohne diese Person kommen sie nie
      // zustande, und die beiden anderen sollen nicht darauf warten.
      const meineRinge = await tx
        .select({ ringId: ringLegs.ringId })
        .from(ringLegs)
        .where(eq(ringLegs.userId, me.id));
      if (meineRinge.length) {
        await tx
          .update(ringSwaps)
          .set({ status: "storniert", updatedAt: new Date() })
          .where(
            and(
              inArray(
                ringSwaps.id,
                meineRinge.map((r) => r.ringId),
              ),
              eq(ringSwaps.status, "vorschlag"),
            ),
          );
      }

      // Fahrzeuge aus dem Markt nehmen
      await tx
        .update(listings)
        .set({ status: "pausiert", updatedAt: new Date() })
        .where(
          and(eq(listings.ownerId, me.id), ne(listings.status, "getauscht")),
        );
      await tx
        .update(vehicles)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(vehicles.ownerId, me.id));

      await tx.delete(watchlist).where(eq(watchlist.userId, me.id));
      await tx.delete(authTokens).where(eq(authTokens.userId, me.id));
      await tx.delete(sessions).where(eq(sessions.userId, me.id));

      // Nachrichten und Bewertungen sind Freitext und enthalten typischerweise
      // Übergabeort, Telefonnummer oder Klarnamen. Die Zeilen bleiben, damit
      // der Verlauf für die Gegenseite lesbar bleibt — der Inhalt geht.
      await tx
        .update(dealMessages)
        .set({ body: "[Nachricht eines gelöschten Kontos]" })
        .where(
          and(eq(dealMessages.authorId, me.id), eq(dealMessages.system, false)),
        );
      await tx
        .update(reviews)
        .set({ body: null })
        .where(eq(reviews.authorId, me.id));

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
          // Der Verweis auf das Auszahlungskonto wird gelöst. Das Konto selbst
          // liegt bei Stripe und untersteht deren gesetzlichen Aufbewahrungs-
          // fristen — darauf weist die Oberfläche ausdrücklich hin.
          stripeAccountId: null,
          stripePayoutsEnabled: false,
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, me.id));
    });
  } catch (err) {
    if (err instanceof LoeschKonflikt) {
      return {
        error:
          err.grund === "offene Zahlung"
            ? "Zu deinem Konto ist noch ein Betrag hinterlegt oder unterwegs. Bitte melde dich " +
              "beim Support."
            : "Zu deinem Konto ist gerade ein Tausch verbindlich geworden. Er muss erst " +
              "abgeschlossen oder abgebrochen sein.",
      };
    }
    throw err;
  }

  // Erst nach dem Commit: der Blob-Speicher lässt sich nicht zurückrollen.
  await deleteBlobs(zuLoeschendeFotos);

  await destroySession();
  return { ok: true, redirectTo: "/?konto=geloescht" };
}

/** Ein Sperrgrund, der erst innerhalb der Transaktion aufgefallen ist. */
class LoeschKonflikt extends Error {
  constructor(readonly grund: "verbindlicher Tausch" | "offene Zahlung") {
    super(grund);
  }
}
