import "server-only";
import { createHash } from "node:crypto";
import { eq, sql as raw } from "drizzle-orm";
import { db } from "../db";
import { rateLimits } from "../db/schema";

/**
 * Der Schlüssel ist der Primärschlüssel einer Textspalte. Roh übernommen
 * liesse sich damit über ein Anmeldeformular eine beliebig lange Zeile
 * erzeugen — jenseits von rund 2700 Byte lehnt der btree-Index das INSERT
 * ab und die Aktion scheitert mit einem unbehandelten Fehler.
 */
function normalizeKey(key: string): string {
  return key.length <= 120 ? key : `h:${createHash("sha256").update(key).digest("hex")}`;
}

export interface LimitResult {
  ok: boolean;
  /** Treffer im laufenden Fenster — ungedeckelt, für abgestufte Reaktionen. */
  count: number;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Zählerbasierte Ratenbegrenzung in der Datenbank. Für eine einzelne
 * Anwendungsinstanz wäre ein Speicher im Prozess schneller, aber auf
 * Serverless läuft jede Anfrage potenziell woanders — deshalb zentral.
 *
 * Das Fenster wird beim ersten Treffer nach Ablauf zurückgesetzt; ein
 * Upsert erledigt Zählen und Zurücksetzen in einer Abfrage.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<LimitResult> {
  const rows = await db
    .insert(rateLimits)
    .values({ key: normalizeKey(key), count: 1, windowStart: new Date() })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: raw`case
          when ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds})
          then 1 else ${rateLimits.count} + 1 end`,
        windowStart: raw`case
          when ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds})
          then now() else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart });

  const row = rows[0];
  const elapsed = (Date.now() - row.windowStart.getTime()) / 1000;
  const retryAfter = Math.max(0, Math.ceil(windowSeconds - elapsed));

  return {
    ok: row.count <= limit,
    count: row.count,
    remaining: Math.max(0, limit - row.count),
    retryAfterSeconds: retryAfter,
  };
}

/**
 * Liest den Zähler, ohne ihn hochzuzählen.
 *
 * Für die Anmeldung ist das der entscheidende Unterschied: würde schon der
 * blosse Versuch zählen, könnte jemand ein fremdes Konto dauerhaft aussperren,
 * indem er es im Minutentakt mit falschen Passwörtern bewirft.
 */
export async function peekRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<LimitResult> {
  const rows = await db
    .select({ count: rateLimits.count, windowStart: rateLimits.windowStart })
    .from(rateLimits)
    .where(eq(rateLimits.key, normalizeKey(key)))
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: true, count: 0, remaining: limit, retryAfterSeconds: 0 };

  const elapsed = (Date.now() - row.windowStart.getTime()) / 1000;
  if (elapsed >= windowSeconds) return { ok: true, count: 0, remaining: limit, retryAfterSeconds: 0 };

  return {
    ok: row.count <= limit,
    count: row.count,
    remaining: Math.max(0, limit - row.count),
    retryAfterSeconds: Math.max(0, Math.ceil(windowSeconds - elapsed)),
  };
}

/** Setzt einen Zähler zurück — etwa nach einer erfolgreichen Anmeldung. */
export async function clearRateLimit(key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, normalizeKey(key)));
}
