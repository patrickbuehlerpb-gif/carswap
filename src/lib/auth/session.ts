import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "../db";
import { newId } from "../db/ids";
import { authTokens, sessions, users, type UserRow } from "../db/schema";

const COOKIE = "autotauschen_session";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Ab dieser Restlaufzeit wird die Sitzung beim Zugriff verlängert. */
const REFRESH_BELOW_MS = 25 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Legt eine Sitzung an und setzt das Cookie. Gibt das Klartext-Token zurück. */
export async function createSession(userId: string, userAgent?: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS);

  await db.insert(sessions).values({
    id: newId("ses"),
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: userAgent?.slice(0, 300),
  });

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // maxAge statt eines festen Zeitpunkts: die Middleware zieht die Frist
    // bei jedem Seitenaufruf nach. Ein fester Zeitpunkt liesse das Cookie
    // exakt 30 Tage nach der Anmeldung ablaufen, egal wie aktiv jemand war.
    maxAge: Math.floor(TTL_MS / 1000),
  });
}

export interface SessionUser {
  id: string;
  email: string;
  /** Angefragte neue Adresse, solange der Link dort nicht bestätigt ist. */
  pendingEmail: string | null;
  name: string;
  location: string;
  canton: string;
  avatarColor: string;
  emailVerified: boolean;
  identityVerified: boolean;
  stripeAccountId: string | null;
  stripePayoutsEnabled: boolean;
  isAdmin: boolean;
  /** Von der Betreiberin stillgelegt — anmelden ja, handeln nein. */
  suspended: boolean;
  rating: number | null;
  ratingCount: number;
  swapsCompleted: number;
}

function toSessionUser(u: UserRow): SessionUser {
  return {
    id: u.id,
    email: u.email,
    pendingEmail: u.pendingEmail,
    name: u.name,
    location: u.location,
    canton: u.canton,
    avatarColor: u.avatarColor,
    emailVerified: u.emailVerifiedAt !== null,
    identityVerified: u.identityVerified,
    stripeAccountId: u.stripeAccountId,
    stripePayoutsEnabled: u.stripePayoutsEnabled,
    isAdmin: u.isAdmin,
    suspended: u.suspendedAt !== null,
    rating: u.ratingCount > 0 ? u.ratingSum / u.ratingCount / 10 : null,
    ratingCount: u.ratingCount,
    swapsCompleted: u.swapsCompleted,
  };
}

/**
 * Liest die aktuelle Sitzung. Über `cache()` pro Request nur einmal
 * ausgeführt, auch wenn mehrere Komponenten danach fragen.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Gleitende Verlängerung der Datenbankzeile. Das Cookie selbst zieht die
  // Middleware nach — in einer Serverkomponente lässt es sich nicht setzen.
  const remaining = row.session.expiresAt.getTime() - Date.now();
  if (remaining < REFRESH_BELOW_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + TTL_MS), lastSeenAt: new Date() })
      .where(eq(sessions.id, row.session.id));
  }

  return toSessionUser(row.user);
});

/** Wie getSessionUser, wirft aber, wenn niemand angemeldet ist. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Nicht angemeldet.");
  return user;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  store.delete(COOKIE);
}

/** Meldet alle Geräte ab — z.B. nachdem ein Passwort zurückgesetzt wurde. */
export async function destroyAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Meldet alle anderen Geräte ab; dieses eine bleibt angemeldet.
 *
 * Bewusst so herum, statt alles zu löschen und sofort eine neue Sitzung
 * anzulegen: eine neue Sitzung hiesse ein neues Cookie, und um dasselbe
 * Cookie kümmert sich in derselben Antwort schon die Middleware. Wessen
 * `Set-Cookie` am Ende gewinnt, ist nicht verlässlich — hier gibt es gar
 * nichts erst zu gewinnen.
 */
export async function destroyOtherSessions(userId: string): Promise<number> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  const res = await db
    .delete(sessions)
    .where(
      token
        ? and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashToken(token)))
        : eq(sessions.userId, userId),
    );
  return res.count ?? 0;
}

/** Räumt abgelaufene Sitzungen auf. Wird vom Health-Check angestossen. */
export async function pruneExpiredSessions(): Promise<number> {
  const res = await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return res.count ?? 0;
}

/**
 * Räumt gelegentlich auf, statt einen Hintergrunddienst zu verlangen.
 *
 * Abgelaufene Sitzungen und verbrauchte Einmal-Token sind wertlos, aber sie
 * bleiben stehen: die Anwendung läuft serverlos, es gibt keinen Prozess, der
 * regelmässig etwas tun könnte. Deshalb erledigt es ein kleiner Anteil der
 * Anmeldungen nebenbei — der Aufwand ist ein DELETE über einen Index.
 */
export async function occasionalCleanup(): Promise<void> {
  // Ungefähr jede zwanzigste Anmeldung.
  if (Math.random() > 0.05) return;
  try {
    const [sitzungen] = await Promise.all([
      pruneExpiredSessions(),
      db.delete(authTokens).where(lt(authTokens.expiresAt, new Date())),
    ]);
    if (sitzungen > 0) console.info(`[aufräumen] ${sitzungen} abgelaufene Sitzung(en) entfernt.`);
  } catch (err) {
    // Aufräumen darf keine Anmeldung scheitern lassen.
    console.error("[aufräumen] fehlgeschlagen:", err);
  }
}

export { hashToken };
