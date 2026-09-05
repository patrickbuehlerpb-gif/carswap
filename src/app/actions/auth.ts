"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { users } from "@/lib/db/schema";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { checkRateLimit, clearRateLimit, peekRateLimit } from "@/lib/auth/rate-limit";
import { sicheresZiel } from "@/lib/auth/safe-redirect";
import {
  createSession,
  destroyAllSessions,
  destroySession,
  occasionalCleanup,
} from "@/lib/auth/session";
import { consumeToken, issueToken } from "@/lib/auth/tokens";
import { mailConfigured, sendMail, siteUrl } from "@/lib/mail";
import { emailSchema } from "@/lib/validation";

export interface FormState {
  error?: string;
  notice?: string;
}

/**
 * Erkennungsfarben für Konten. Alle liegen im Bereich der Marke und sind
 * mitteldunkel: auf jeder davon steht die helle Schrift des Kürzels lesbar,
 * und nebeneinander bleiben sie unterscheidbar.
 */
const AVATAR_COLORS = [
  "#0e4c46", "#b0730f", "#6b7f5a", "#8a5a4a", "#4a6b7a",
  "#7a5f8a", "#2c6a3f", "#9a4a52", "#5f6b8a", "#8a7a3a",
];

async function requestContext() {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unbekannt";
  return { ip, userAgent: h.get("user-agent") ?? undefined };
}

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Bitte den Namen angeben.").max(80),
  email: emailSchema,
  password: z.string(),
  location: z.string().trim().max(80).optional().default(""),
  canton: z.string().trim().max(2).optional().default(""),
});

/* ------------------------------------------------------------------ */
/* Registrierung                                                       */
/* ------------------------------------------------------------------ */

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { ip, userAgent } = await requestContext();
  // 15 statt einer engeren Zahl: hinter einer IP steckt in der Schweiz oft
  // ein ganzer Haushalt, ein Büro oder — bei Mobilfunk — ein halbes Quartier.
  // Gegen massenhaftes Anlegen von Konten schützt ohnehin nicht diese Zahl,
  // sondern dass jeder verbindliche Schritt eine bestätigte Adresse verlangt.
  const limit = await checkRateLimit(`signup:${ip}`, 15, 60 * 60);
  if (!limit.ok) {
    return { error: "Zu viele Registrierungsversuche. Bitte später erneut probieren." };
  }

  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    location: formData.get("location") ?? "",
    canton: formData.get("canton") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingaben unvollständig." };
  }

  const pwProblem = passwordProblem(parsed.data.password);
  if (pwProblem) return { error: pwProblem };

  const id = newId("usr");
  // Kein vorgeschaltetes SELECT: zwischen Prüfung und INSERT passt ein
  // zweiter Registrierungsversuch, und der wäre am Unique-Index mit einem
  // unbehandelten Datenbankfehler herausgeflogen. Der Index entscheidet.
  const angelegt = await db
    .insert(users)
    .values({
      id,
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
      location: parsed.data.location,
      canton: parsed.data.canton.toUpperCase(),
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });
  if (!angelegt.length) {
    return { error: "Für diese E-Mail-Adresse gibt es bereits ein Konto." };
  }

  const token = await issueToken(id, "verify_email");
  const zustellung = await sendMail({
    to: parsed.data.email,
    subject: "autotauschen: E-Mail-Adresse bestätigen",
    text:
      `Hallo ${parsed.data.name}\n\n` +
      `Bestätige deine E-Mail-Adresse mit diesem Link:\n` +
      `${siteUrl()}/konto/email-bestaetigen?token=${token}\n\n` +
      `Der Link ist sieben Tage gültig. Wenn du dich nicht registriert hast, ` +
      `kannst du diese Nachricht ignorieren.\n`,
  });

  await createSession(id, userAgent);
  // Die Begrüssung sagt sonst «wir haben dir eine E-Mail geschickt» — auch
  // wenn der Versand gerade abgelehnt hat. Wer dann auf eine Mail wartet, die
  // nie kommt, hält sein Konto für kaputt. Ohne eingerichteten Versand ist
  // nichts gescheitert; das ist der lokale Normalfall.
  const gescheitert = mailConfigured() && !zustellung.delivered;
  redirect(`/garage?willkommen=1${gescheitert ? "&mail=fehler" : ""}`);
}

/* ------------------------------------------------------------------ */
/* Anmeldung                                                           */
/* ------------------------------------------------------------------ */

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { ip, userAgent } = await requestContext();
  // Auf 254 Zeichen begrenzt: der Wert wird gleich als Ratenlimit-Schlüssel
  // verwendet, und der Rest der Anwendung lässt nicht mehr zu.
  const emailRaw = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  // Zwei Riegel, beide an die Herkunft gebunden:
  //   login-ip     — wie viele Versuche kommen von dieser Verbindung?
  //   login-paar   — wie oft hat diese Verbindung genau dieses Konto probiert?
  // Ein Zähler allein auf der Adresse wäre eine Einladung: damit sperrt jeder
  // ein fremdes Konto aus, ohne das Passwort zu kennen.
  const byIp = await checkRateLimit(`login-ip:${ip}`, 20, 15 * 60);
  const paarKey = `login-paar:${ip}|${emailRaw}`;
  const byPaar = await peekRateLimit(paarKey, 8, 15 * 60);
  if (!byIp.ok || !byPaar.ok) {
    return {
      error: `Zu viele Anmeldeversuche von dieser Verbindung. Bitte in ${Math.ceil(
        Math.max(byIp.retryAfterSeconds, byPaar.retryAfterSeconds) / 60,
      )} Minuten erneut versuchen.`,
    };
  }

  const mailKey = `login-mail:${emailRaw}`;
  const fehlversuche = await peekRateLimit(mailKey, 8, 15 * 60);

  const rows = await db.select().from(users).where(eq(users.email, emailRaw)).limit(1);
  const user = rows[0];

  // Auch ohne Treffer einen Hash prüfen, damit die Antwortzeit nicht verrät,
  // ob es das Konto gibt.
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA");

  if (!user || !ok) {
    // Erst jetzt zählen — und nur den Fehlversuch. Beide Zähler laufen mit:
    // der auf dem Paar sperrt, der auf der Adresse bremst.
    await checkRateLimit(paarKey, 8, 15 * 60);
    const stand = await checkRateLimit(mailKey, 8, 15 * 60);
    // Ab dem vierten Fehlversuch wird jede weitere Antwort für diese Adresse
    // spürbar langsamer, und zwar zunehmend. Das bremst Rateversuche, sperrt
    // aber niemanden aus: mit dem richtigen Passwort kommt man sofort durch.
    const bremse = Math.min(3000, Math.max(0, stand.count - 3) * 400);
    if (bremse > 0) await warte(bremse);
    return { error: "E-Mail-Adresse oder Passwort stimmt nicht." };
  }

  // Erfolg löscht beide Zähler, damit ein Tippfehler von gestern nicht nachwirkt.
  if (fehlversuche.count > 0) await clearRateLimit(mailKey);
  if (byPaar.count > 0) await clearRateLimit(paarKey);

  await createSession(user.id, userAgent);
  // Nebenbei aufräumen — es gibt keinen Hintergrunddienst, der das täte.
  await occasionalCleanup();
  redirect(sicheresZiel(next));
}

/** Kurze, absichtliche Verzögerung. */
function warte(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}

/* ------------------------------------------------------------------ */
/* Passwort zurücksetzen                                               */
/* ------------------------------------------------------------------ */

/**
 * Beide Zweige des Passwort-Resets sollen gleich lange dauern. Sonst verrät
 * die Antwortzeit, ob es das Konto gibt — der Treffer-Zweig verschickt eine
 * Mail, der andere kehrt sofort zurück.
 */
async function mitMindestdauer<T>(ms: number, arbeit: Promise<T>): Promise<T> {
  const [ergebnis] = await Promise.all([arbeit, warte(ms)]);
  return ergebnis;
}

export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { ip } = await requestContext();
  const limit = await checkRateLimit(`pwreset:${ip}`, 5, 60 * 60);
  if (!limit.ok) return { error: "Zu viele Anfragen. Bitte später erneut versuchen." };

  const parsed = emailSchema.safeParse(formData.get("email"));
  // Unabhängig vom Ergebnis dieselbe Antwort — sonst liesse sich abfragen,
  // welche Adressen registriert sind.
  const generic: FormState = {
    notice:
      "Wenn zu dieser Adresse ein Konto besteht, ist eine E-Mail mit dem Link zum " +
      "Zurücksetzen unterwegs.",
  };
  if (!parsed.success) return generic;

  return await mitMindestdauer(
    800,
    (async () => {
      const rows = await db.select().from(users).where(eq(users.email, parsed.data)).limit(1);
      const user = rows[0];
      if (user) {
        const token = await issueToken(user.id, "reset_password");
        // Der Mailversand läuft NACH der Antwort. Innerhalb der gemessenen
        // Zeit wäre er ein Netzwerk-Roundtrip von mehreren hundert
        // Millisekunden — und damit ein verlässliches Signal, dass es das
        // Konto gibt, trotz gleichlautender Antwort.
        after(async () => {
          await sendMail({
            to: user.email,
            subject: "autotauschen: Passwort zurücksetzen",
            text:
              `Hallo ${user.name}\n\n` +
              `Setze dein Passwort über diesen Link neu:\n` +
              `${siteUrl()}/konto/passwort-neu?token=${token}\n\n` +
              `Der Link ist eine Stunde gültig. Wenn du das nicht angefordert hast, ` +
              `ändert sich nichts an deinem Konto.\n`,
          });
        });
      }
      return generic;
    })(),
  );
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");

  const problem = passwordProblem(password);
  if (problem) return { error: problem };

  const userId = await consumeToken(token, "reset_password");
  if (!userId) {
    return { error: "Dieser Link ist abgelaufen oder wurde bereits verwendet." };
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Nach einem Passwortwechsel alle Geräte abmelden
  await destroyAllSessions(userId);
  redirect("/konto/anmelden?zurueckgesetzt=1");
}

/* ------------------------------------------------------------------ */
/* E-Mail bestätigen                                                   */
/* ------------------------------------------------------------------ */

export async function verifyEmailToken(token: string): Promise<boolean> {
  const userId = await consumeToken(token, "verify_email");
  if (!userId) return false;
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
  return true;
}

export async function resendVerificationAction(): Promise<FormState> {
  const { getSessionUser } = await import("@/lib/auth/session");
  const user = await getSessionUser();
  if (!user) return { error: "Nicht angemeldet." };
  if (user.emailVerified) return { notice: "Deine Adresse ist bereits bestätigt." };

  const limit = await checkRateLimit(`verify:${user.id}`, 3, 60 * 60);
  if (!limit.ok) return { error: "Zu viele Anfragen. Bitte später erneut versuchen." };

  const token = await issueToken(user.id, "verify_email");
  const zustellung = await sendMail({
    to: user.email,
    subject: "autotauschen: E-Mail-Adresse bestätigen",
    text: `Bestätige deine E-Mail-Adresse:\n${siteUrl()}/konto/email-bestaetigen?token=${token}\n`,
  });
  // «Verschickt» zu melden, obwohl der Versand abgelehnt hat, schickt die
  // Person zum Warten auf etwas, das nicht kommt — und beim nächsten Versuch
  // steht ihr die Ratenbegrenzung im Weg.
  if (!zustellung.delivered && mailConfigured()) {
    return {
      error:
        "Die Mail liess sich gerade nicht zustellen. Versuch es später noch einmal — " +
        "der Fehler ist bei uns vermerkt.",
    };
  }
  return { notice: "Bestätigungslink verschickt." };
}
