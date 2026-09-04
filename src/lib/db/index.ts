import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * In der Entwicklung überlebt die Verbindung den Hot Reload, sonst entstehen
 * bei jedem Speichern neue Pools. In Serverless-Umgebungen bleibt der Pool
 * bewusst klein, weil jede Instanz eine eigene Verbindung hält.
 */
const globalForDb = globalThis as unknown as {
  __carswapSql?: ReturnType<typeof postgres>;
  __carswapDb?: Db;
};

/**
 * Modulweiter Zwischenspeicher. Ohne ihn würde der Proxy weiter unten bei
 * jedem Zugriff einen neuen Verbindungspool aufmachen.
 */
let cached: Db | null = null;

function connect(): Db {
  if (cached) return cached;
  if (globalForDb.__carswapDb) {
    cached = globalForDb.__carswapDb;
    return cached;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL ist nicht gesetzt. Ohne Datenbank kann die Anwendung nicht starten — " +
        "siehe README, Abschnitt «Datenbank».",
    );
  }

  const sql =
    globalForDb.__carswapSql ??
    postgres(url, {
      max: process.env.VERCEL ? 1 : 10,
      idle_timeout: 20,
      connect_timeout: 10,
      // Prepared Statements vertragen sich nicht mit Poolern im Transaction-Mode
      prepare: false,
    });

  const instance = drizzle(sql, { schema });
  cached = instance;
  if (process.env.NODE_ENV !== "production") {
    globalForDb.__carswapSql = sql;
    globalForDb.__carswapDb = instance;
  }
  return instance;
}

/**
 * Die Verbindung wird erst beim ersten Zugriff aufgebaut, nicht beim Import.
 * Sonst schlägt schon `next build` fehl, wenn DATABASE_URL noch nicht gesetzt
 * ist — obwohl zur Bauzeit gar keine Abfrage nötig wäre.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const real = connect() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
