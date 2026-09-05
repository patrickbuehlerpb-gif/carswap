import { sql as raw } from "drizzle-orm";
import { connect } from "../scripts/db-connect";

/**
 * Leert die Testdatenbank vor dem Durchlauf.
 *
 * Ohne das schlägt der zweite Lauf fehl: die Ratenbegrenzung für
 * Registrierungen zählt pro IP, und im Test kommt alles von derselben.
 * Der Schutz vor der Entwicklungsdatenbank ist derselbe wie bei den
 * Unit-Tests — der Name muss auf `_test` enden.
 */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Für den Durchlauf wird TEST_DATABASE_URL gebraucht.");

  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/_test$/.test(name)) {
    throw new Error(
      `Der Durchlauf leert alle Tabellen und läuft deshalb nur gegen eine Datenbank, deren ` +
        `Name auf _test endet — "${name}" ist keine.`,
    );
  }

  /*
   * Die geprüfte Adresse muss auch die benutzte sein. `databaseUrl()` in
   * db-connect zieht DATABASE_URL_UNPOOLED und POSTGRES_URL vor — steht dort
   * eine Produktionsdatenbank (bei Neon ist genau das die übliche
   * Einrichtung), liefe das `truncate` unten gegen sie, obwohl die Prüfung
   * oben die harmlose Testadresse gesehen hat. Die Unit-Tests räumen die
   * beiden Variablen aus demselben Grund weg (src/test/setup.ts).
   */
  process.env.DATABASE_URL = url;
  delete process.env.DATABASE_URL_UNPOOLED;
  delete process.env.POSTGRES_URL;
  delete process.env.POSTGRES_URL_NON_POOLING;

  const { db, sql } = connect();
  await db.execute(raw`truncate table
    deal_vehicle_locks, deal_messages, payments, deals, ring_legs, ring_swaps,
    watchlist, reviews, reports, match_notices,
    listings, vehicles, sessions, auth_tokens, rate_limits, webhook_events,
    mail_failures, users
    restart identity cascade`);
  await sql.end();
}
