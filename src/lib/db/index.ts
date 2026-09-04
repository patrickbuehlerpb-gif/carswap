import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL ist nicht gesetzt. Ohne Datenbank kann die Anwendung nicht starten — " +
        "siehe README, Abschnitt «Datenbank».",
    );
  }
  return url;
}

/**
 * In der Entwicklung überlebt die Verbindung den Hot Reload, sonst entstehen
 * bei jedem Speichern neue Pools. In Serverless-Umgebungen bleibt der Pool
 * bewusst klein, weil jede Instanz eine eigene Verbindung hält.
 */
const globalForDb = globalThis as unknown as {
  __carswapSql?: ReturnType<typeof postgres>;
};

const sql =
  globalForDb.__carswapSql ??
  postgres(connectionString(), {
    max: process.env.VERCEL ? 1 : 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // Prepared Statements vertragen sich nicht mit Poolern im Transaction-Mode
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__carswapSql = sql;

export const db = drizzle(sql, { schema });
export { schema, sql };
