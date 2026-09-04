import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connect, databaseUrl } from "./db-connect";

async function main() {
  // Beim Build ohne Datenbank (etwa in einer Vorschau ohne Integration) soll
  // der Durchlauf nicht scheitern — die Anwendung meldet den Zustand dann
  // selbst über /api/health.
  if (!databaseUrl()) {
    if (process.argv.includes("--optional")) {
      console.log("Keine Datenbank-Adresse gesetzt — Migration übersprungen.");
      return;
    }
    throw new Error("Keine Datenbank-Adresse gefunden (DATABASE_URL).");
  }

  const { db, sql } = connect();
  console.log("Migrationen werden angewendet …");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Fertig.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration fehlgeschlagen:", err);
  process.exit(1);
});
