"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authTokens,
  dealMessages,
  deals,
  listings,
  matchNotices,
  payments,
  reviews,
  ringLegs,
  ringSwaps,
  sessions,
  users,
  vehicles,
  watchlist,
} from "@/lib/db/schema";
import { destroyOtherSessions, destroySession, requireUser } from "@/lib/auth/session";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { consumeToken, issueToken } from "@/lib/auth/tokens";
import { mailConfigured, sendMail, siteUrl } from "@/lib/mail";
import { emailSchema } from "@/lib/validation";
import { deleteBlobs } from "@/lib/blob";
import { checkRateLimit, releaseRateLimit } from "@/lib/auth/rate-limit";
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

/**
 * Schaltet die Treffermeldungen an oder ab.
 *
 * Bewusst ohne Passwortabfrage: das ist eine Einstellung, keine Änderung am
 * Zugang. Und wer sie versehentlich umlegt, legt sie mit demselben Klick
 * wieder zurück.
 */
export async function setMatchNotifyAction(an: boolean): Promise<AccountResult> {
  const me = await requireUser();
  await db
    .update(users)
    .set({ notifyMatches: an, updatedAt: new Date() })
    .where(eq(users.id, me.id));
  /*
   * Bewusst ohne revalidatePath: die Kontoseite wird ohnehin bei jedem Aufruf
   * frisch gerechnet, es gibt also nichts zu verwerfen. Der Aufruf hatte aber
   * eine Wirkung — er ersetzte den Seitenbaum, und damit verlor der Schalter
   * den Fokus. Wer die Seite mit der Tastatur bedient, stand danach wieder
   * am Seitenanfang.
   */
  return {
    ok: true,
    notice: an
      ? "Wir melden dir neue Treffer."
      : "Wir melden dir keine Treffer mehr. Auf der Treffer-Seite siehst du sie weiterhin.",
  };
}

/* ------------------------------------------------------------------ */
/* Passwort und E-Mail-Adresse ändern                                  */
/* ------------------------------------------------------------------ */

/**
 * Liest den gespeicherten Hash und prüft das eingetippte Passwort.
 *
 * Beide Änderungen unten verlangen es. Eine Sitzung allein reicht nicht: wer
 * ein offenes Notebook erwischt, könnte sonst in zwei Klicks das Passwort
 * setzen oder die Adresse umhängen und damit das Konto endgültig übernehmen.
 */
async function passwortStimmt(userId: string, eingabe: string): Promise<boolean> {
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return false;
  return verifyPassword(eingabe, row.passwordHash);
}

export async function changePasswordAction(
  _prev: AccountResult,
  formData: FormData,
): Promise<AccountResult> {
  const me = await requireUser();

  const limit = await checkRateLimit(`pwchange:${me.id}`, 10, 60 * 60);
  if (!limit.ok) return { error: "Zu viele Versuche. Bitte später erneut." };

  const aktuell = String(formData.get("current") ?? "");
  const neu = String(formData.get("password") ?? "");
  const wiederholung = String(formData.get("repeat") ?? "");

  if (!(await passwortStimmt(me.id, aktuell))) {
    return { error: "Das aktuelle Passwort stimmt nicht." };
  }
  const problem = passwordProblem(neu);
  if (problem) return { error: problem };
  if (neu !== wiederholung) return { error: "Die beiden neuen Passwörter stimmen nicht überein." };
  if (neu === aktuell) return { error: "Das neue Passwort ist dasselbe wie das alte." };

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(neu), updatedAt: new Date() })
    .where(eq(users.id, me.id));

  // Wer das Passwort wechselt, will die anderen Sitzungen loswerden — sich
  // dabei selbst hinauszuwerfen wäre aber nur lästig.
  await destroyOtherSessions(me.id);

  await sendMail({
    to: me.email,
    subject: "autotauschen: Passwort geändert",
    text:
      `Hallo ${me.name}\n\n` +
      "Das Passwort deines Kontos wurde soeben geändert, und alle anderen Geräte " +
      "wurden abgemeldet.\n\n" +
      "Warst du das nicht, setze das Passwort sofort neu:\n" +
      `${siteUrl()}/konto/passwort-vergessen\n`,
  });

  revalidatePath("/konto");
  return { notice: "Passwort geändert. Alle anderen Geräte sind abgemeldet." };
}

/**
 * Startet den Adresswechsel. Umgehängt wird erst, wenn der Link an der NEUEN
 * Adresse angeklickt wurde — bis dahin bleibt alles wie es ist.
 */
export async function requestEmailChangeAction(
  _prev: AccountResult,
  formData: FormData,
): Promise<AccountResult> {
  const me = await requireUser();

  const limit = await checkRateLimit(`mailchange:${me.id}`, 5, 60 * 60);
  if (!limit.ok) return { error: "Zu viele Versuche. Bitte später erneut." };

  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Bitte eine gültige E-Mail-Adresse angeben." };
  const neueAdresse = parsed.data;
  const passwort = String(formData.get("current") ?? "");

  if (!(await passwortStimmt(me.id, passwort))) {
    return { error: "Das Passwort stimmt nicht." };
  }
  if (neueAdresse === me.email) {
    return { error: "Das ist bereits deine Adresse." };
  }

  // Vergeben? Dann gleich sagen. Die Registrierung verrät dasselbe, ein
  // schweigendes «Link unterwegs» würde hier nur ratlos machen.
  const [belegt] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, neueAdresse), ne(users.id, me.id)))
    .limit(1);
  if (belegt) return { error: "Diese Adresse gehört bereits zu einem Konto." };

  await db
    .update(users)
    .set({ pendingEmail: neueAdresse, updatedAt: new Date() })
    .where(eq(users.id, me.id));

  const token = await issueToken(me.id, "change_email");
  const zustellung = await sendMail({
    to: neueAdresse,
    subject: "autotauschen: neue E-Mail-Adresse bestätigen",
    text:
      `Hallo ${me.name}\n\n` +
      "Diese Adresse soll künftig zu deinem autotauschen-Konto gehören. Bestätige sie hier:\n" +
      `${siteUrl()}/konto/email-aendern?token=${token}\n\n` +
      "Der Link ist 24 Stunden gültig. Bis dahin bleibt deine bisherige Adresse in Kraft.\n",
  });

  // Die bisherige Adresse erfährt davon — sie ist die einzige Stelle, an der
  // ein unbemerkter Wechsel noch auffallen kann.
  await sendMail({
    to: me.email,
    subject: "autotauschen: Wechsel der E-Mail-Adresse angefragt",
    text:
      `Hallo ${me.name}\n\n` +
      `Für dein Konto wurde ${neueAdresse} als neue Adresse angefragt. Solange der ` +
      "Link dort nicht bestätigt ist, ändert sich nichts.\n\n" +
      "Warst du das nicht, ändere sofort dein Passwort:\n" +
      `${siteUrl()}/konto/passwort-vergessen\n`,
  });

  revalidatePath("/konto");
  // Hier hängt mehr daran als eine Auskunft: Ohne den Link an der neuen
  // Adresse bleibt der Wechsel für immer hängen, und die Person sucht in
  // einem Postfach, in dem nichts ankommen wird.
  if (!zustellung.delivered && mailConfigured()) {
    await releaseRateLimit(`mailchange:${me.id}`);
    return {
      error:
        `Der Bestätigungslink an ${neueAdresse} liess sich nicht zustellen. Die Anfrage ` +
        "steht, deine bisherige Adresse gilt weiter — versuch es später noch einmal oder " +
        "prüfe, ob die neue Adresse stimmt.",
    };
  }
  return {
    notice: `Wir haben einen Bestätigungslink an ${neueAdresse} geschickt. Bis du ihn anklickst, bleibt deine bisherige Adresse gültig.`,
  };
}

/** Nimmt einen angefragten Adresswechsel zurück. */
export async function cancelEmailChangeAction(): Promise<AccountResult> {
  const me = await requireUser();
  await db
    .update(users)
    .set({ pendingEmail: null, updatedAt: new Date() })
    .where(eq(users.id, me.id));
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.userId, me.id),
        eq(authTokens.purpose, "change_email"),
        isNull(authTokens.usedAt),
      ),
    );
  revalidatePath("/konto");
  return { notice: "Der Wechsel wurde abgebrochen." };
}

/**
 * Löst den Link aus der Bestätigungsmail ein.
 *
 * Wird von der Seite /konto/email-aendern aufgerufen, auch ohne Anmeldung:
 * der Link liegt im Postfach der neuen Adresse, und das ist genau der Nachweis,
 * auf den es hier ankommt.
 */
export async function confirmEmailChange(token: string): Promise<
  { ok: true; email: string } | { ok: false; grund: "ungueltig" | "belegt" }
> {
  const userId = await consumeToken(token, "change_email");
  if (!userId) return { ok: false, grund: "ungueltig" };

  const [konto] = await db
    .select({ pendingEmail: users.pendingEmail, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!konto?.pendingEmail) return { ok: false, grund: "ungueltig" };

  // Zwischen Anfrage und Klick kann sich jemand anders mit der Adresse
  // registriert haben. Der eindeutige Index entscheidet, nicht ein SELECT
  // von vorhin.
  let umgehaengt: { email: string }[];
  try {
    umgehaengt = await db
      .update(users)
      .set({
        email: konto.pendingEmail,
        pendingEmail: null,
        // Die Adresse ist durch den Klick belegt — ein zweiter
        // Bestätigungslauf wäre eine Schikane.
        emailVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning({ email: users.email });
  } catch {
    umgehaengt = [];
  }

  if (!umgehaengt.length) {
    await db
      .update(users)
      .set({ pendingEmail: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return { ok: false, grund: "belegt" };
  }

  await sendMail({
    to: konto.email,
    subject: "autotauschen: E-Mail-Adresse geändert",
    text:
      `Hallo ${konto.name}\n\n` +
      `Dein Konto läuft jetzt auf ${konto.pendingEmail}. An diese bisherige Adresse ` +
      "schicken wir nichts mehr.\n\n" +
      "Warst du das nicht, melde dich sofort beim Support.\n",
  });

  return { ok: true, email: umgehaengt[0].email };
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
    gemeldeteTreffer,
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
    db.select().from(matchNotices).where(eq(matchNotices.userId, me.id)),
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
        gemeldeteTreffer,
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
        "Zu deinem Konto läuft noch ein zugesagter Tausch. Der muss erst fertig oder " +
        "abgebrochen sein.",
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
        "Zu deinem Konto läuft noch ein zugesagter Ringtausch. Der muss erst fertig oder " +
        "abgebrochen sein.",
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
        "Zu deinem Konto liegt noch Geld bei uns oder ist unterwegs. Melde dich beim Support. " +
        "Sobald die Zahlung durch oder freigegeben ist, kannst du das Konto löschen.",
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
      await tx.delete(matchNotices).where(eq(matchNotices.userId, me.id));
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
          pendingEmail: null,
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
