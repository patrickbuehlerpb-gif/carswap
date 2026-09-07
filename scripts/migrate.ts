import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql as raw } from "drizzle-orm";
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

  /*
   * Wie weit ist die Datenbank weg?
   *
   * Der Build läuft in derselben Region wie später die Funktionen. Diese eine
   * Zahl beantwortet damit die Frage, die man sonst nur raten kann: Steht die
   * Datenbank neben der Anwendung oder auf einem anderen Kontinent? Bei einer
   * Seite mit drei Abfragen ist der Unterschied zwischen 2 ms und 100 ms je
   * Abfrage der Unterschied zwischen «flüssig» und «hängt».
   *
   * Zweimal messen und den zweiten Wert nehmen: Der erste enthält den
   * Verbindungsaufbau samt TLS-Handschlag.
   */
  for (const durchgang of [1, 2]) {
    const start = Date.now();
    await db.execute(raw`select 1`);
    const ms = Date.now() - start;
    if (durchgang === 2) {
      console.log(
        `Datenbank antwortet in ${ms} ms` +
          (ms > 40
            ? " — das ist weit weg. Läuft die Anwendung in derselben Region wie die Datenbank?"
            : ""),
      );
    }
  }

  console.log("Migrationen werden angewendet …");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Fertig.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration fehlgeschlagen:", err);
  process.exit(1);
});
