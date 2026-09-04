import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";

/**
 * Verbindung für Kommandozeilen-Skripte. Bewusst getrennt von src/lib/db,
 * weil dort `server-only` importiert wird und das ausserhalb von Next nicht
 * auflösbar ist.
 */
export function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ist nicht gesetzt.");
  const sql = postgres(url, { max: 1 });
  return { sql, db: drizzle(sql, { schema }), schema };
}
