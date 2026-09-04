import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connect } from "./db-connect";

async function main() {
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
