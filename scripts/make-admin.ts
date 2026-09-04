import { eq } from "drizzle-orm";
import { connect } from "./db-connect";

/**
 * Macht ein bestehendes Konto zur Betreiberin — oder nimmt das Recht wieder.
 *
 * Bewusst nur über die Kommandozeile: eine Oberfläche dafür wäre ein Ziel,
 * und gebraucht wird sie genau einmal beim Einrichten.
 *
 *   npm run admin -- anna@example.ch
 *   npm run admin -- anna@example.ch --entziehen
 */
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const entziehen = process.argv.includes("--entziehen");
  if (!email || email.startsWith("--")) {
    console.error("Aufruf: npm run admin -- <e-mail> [--entziehen]");
    process.exit(1);
  }

  const { db, sql, schema } = connect();
  try {
    const rows = await db
      .update(schema.users)
      .set({ isAdmin: !entziehen, updatedAt: new Date() })
      .where(eq(schema.users.email, email))
      .returning({ id: schema.users.id, name: schema.users.name });

    if (!rows.length) {
      console.error(`Kein Konto mit der Adresse ${email}.`);
      process.exitCode = 1;
      return;
    }
    console.log(
      entziehen
        ? `${rows[0].name} ist keine Betreiberin mehr.`
        : `${rows[0].name} kann jetzt unter /admin/meldungen die Meldungen sehen.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Fehlgeschlagen:", err);
  process.exit(1);
});
