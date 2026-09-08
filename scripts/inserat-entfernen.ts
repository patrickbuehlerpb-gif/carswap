import { eq, or } from "drizzle-orm";
import { connect } from "./db-connect";

/**
 * Entfernt ein Inserat samt Fahrzeug aus der Datenbank.
 *
 * Gedacht für Beispieldaten, die vor dem Livegang verschwinden sollen — nicht
 * für den Alltag. Wer sein eigenes Auto zurückzieht, tut das in der Garage;
 * dort wird archiviert statt gelöscht, weil abgeschlossene Tausche das
 * Fahrzeug weiter nennen müssen.
 *
 * Bewusst nur über die Kommandozeile und bewusst zweistufig: ohne `--ja`
 * zeigt das Skript nur, was es täte. Ein Löschbefehl, der sofort losläuft,
 * ist ein Löschbefehl, den man einmal zu oft aufruft.
 *
 *   npm run inserat:weg -- veh_3jt82mm3swzvrfqc
 *   npm run inserat:weg -- veh_3jt82mm3swzvrfqc --ja
 *   npm run inserat:weg -- veh_3jt82mm3swzvrfqc --archivieren --ja
 *
 * Die Datenbank schützt die Geschichte selbst: Fahrzeuge, die in einem Tausch
 * oder einem Ring vorkommen, verweigern das Löschen über den Fremdschlüssel.
 * Diese Fälle fängt das Skript vorher ab und erklärt sie.
 */

const HINWEIS = `Aufruf: npm run inserat:weg -- <fahrzeug-id> [--ja] [--archivieren]

  ohne --ja        zeigt nur, was passieren würde
  --archivieren    stilllegen statt löschen: das Fahrzeug bleibt in der
                   Datenbank, verschwindet aber aus Markt und Garage`;

async function main() {
  const argumente = process.argv.slice(2);
  const ids = argumente.filter((a) => !a.startsWith("--"));
  const wirklich = argumente.includes("--ja");
  const archivieren = argumente.includes("--archivieren");

  if (!ids.length) {
    console.error(HINWEIS);
    process.exit(1);
  }

  const { db, sql, schema } = connect();
  try {
    for (const vehicleId of ids) {
      const [fahrzeug] = await db
        .select()
        .from(schema.vehicles)
        .where(eq(schema.vehicles.id, vehicleId))
        .limit(1);

      if (!fahrzeug) {
        console.error(`✗ ${vehicleId}: kein Fahrzeug mit dieser Kennung.`);
        process.exitCode = 1;
        continue;
      }

      const [besitzer] = await db
        .select({ name: schema.users.name, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, fahrzeug.ownerId))
        .limit(1);

      const [inserat] = await db
        .select({ id: schema.listings.id, status: schema.listings.status })
        .from(schema.listings)
        .where(eq(schema.listings.vehicleId, vehicleId))
        .limit(1);

      // Nicht nur die laufenden: ein abgeschlossener Tausch nennt das Fahrzeug
      // ebenso, und die Datenbank liesse das Löschen dann ohnehin nicht zu.
      const tausche = await db
        .select({ id: schema.deals.id, status: schema.deals.status })
        .from(schema.deals)
        .where(
          or(
            eq(schema.deals.fromVehicleId, vehicleId),
            eq(schema.deals.toVehicleId, vehicleId),
          ),
        );

      const ringe = await db
        .select({ id: schema.ringLegs.id })
        .from(schema.ringLegs)
        .where(eq(schema.ringLegs.vehicleId, vehicleId));

      console.log(
        `\n${vehicleId} — ${fahrzeug.make} ${fahrzeug.model}` +
          `${fahrzeug.trim ? ` ${fahrzeug.trim}` : ""}, ${fahrzeug.firstRegistration}` +
          `, ${fahrzeug.mileageKm.toLocaleString("de-CH")} km` +
          `\n  Besitzer:  ${besitzer ? `${besitzer.name} <${besitzer.email}>` : "unbekannt"}` +
          `\n  Inserat:   ${inserat ? `${inserat.id} (${inserat.status})` : "keines"}` +
          `\n  Fotos:     ${fahrzeug.photos?.length ?? 0}` +
          `\n  Tausche:   ${tausche.length}` +
          `\n  Ringe:     ${ringe.length}`,
      );

      if (!archivieren && (tausche.length || ringe.length)) {
        console.error(
          `✗ ${vehicleId}: kommt in ${tausche.length} Tausch(en) und ${ringe.length} Ring(en) vor.\n` +
            "  Löschen würde die Geschichte dieser Abschlüsse zerreissen — die Datenbank\n" +
            "  lässt es deshalb auch gar nicht zu. Nimm --archivieren.",
        );
        process.exitCode = 1;
        continue;
      }

      if (!wirklich) {
        console.log(
          archivieren
            ? "  → würde stillgelegt (--ja zum Ausführen)"
            : "  → würde gelöscht, mitsamt Inserat und Merkliste (--ja zum Ausführen)",
        );
        continue;
      }

      if (archivieren) {
        await db
          .update(schema.vehicles)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.vehicles.id, vehicleId));
        if (inserat) {
          await db
            .update(schema.listings)
            .set({ status: "pausiert", updatedAt: new Date() })
            .where(eq(schema.listings.id, inserat.id));
        }
        console.log("  ✓ stillgelegt");
        continue;
      }

      // Inserat und Merkliste hängen mit `on delete cascade` daran.
      await db.delete(schema.vehicles).where(eq(schema.vehicles.id, vehicleId));
      console.log("  ✓ gelöscht");

      const rest = await db
        .select({ id: schema.vehicles.id })
        .from(schema.vehicles)
        .where(eq(schema.vehicles.ownerId, fahrzeug.ownerId));
      if (!rest.length && besitzer) {
        console.log(
          `  Hinweis: ${besitzer.name} <${besitzer.email}> hat jetzt kein Fahrzeug mehr.\n` +
            "  Das Konto bleibt bestehen — Konten löscht dieses Skript nicht.",
        );
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Fehlgeschlagen:", err);
  process.exit(1);
});
