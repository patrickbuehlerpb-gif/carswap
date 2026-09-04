import "server-only";
import { sql as raw } from "drizzle-orm";
import { db } from "../db";
import { rateLimits } from "../db/schema";

export interface LimitResult {
  ok: boolean;
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
    .values({ key, count: 1, windowStart: new Date() })
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
    remaining: Math.max(0, limit - row.count),
    retryAfterSeconds: retryAfter,
  };
}
