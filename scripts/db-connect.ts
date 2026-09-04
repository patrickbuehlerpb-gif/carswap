import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";

/**
 * Verbindung für Kommandozeilen-Skripte. Bewusst getrennt von src/lib/db,
 * weil dort `server-only` importiert wird und das ausserhalb von Next nicht
 * auflösbar ist.
 */
/**
 * Migrationen laufen über eine direkte Verbindung, nicht über den Pooler:
 * DDL im Transaction-Mode eines Poolers ist unzuverlässig. Neon stellt dafür
 * die ungepoolte Adresse bereit.
 */
export function databaseUrl(): string | undefined {
  return (
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    undefined
  );
}

export function connect() {
  const url = databaseUrl();
  if (!url) throw new Error("Keine Datenbank-Adresse gefunden (DATABASE_URL).");
  const sql = postgres(url, { max: 1 });
  return { sql, db: drizzle(sql, { schema }), schema };
}
