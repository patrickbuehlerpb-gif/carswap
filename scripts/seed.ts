import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { connect } from "./db-connect";
import { seedUsers } from "./seed-users";
import { seedListings, seedVehicles } from "./seed-vehicles";

/**
 * Legt Demo-Daten an: zehn Konten, 19 Fahrzeuge mit Inseraten.
 *
 * Nur für Entwicklung und Abnahme gedacht — in einer produktiven Umgebung
 * würden erfundene Inserate echte Nutzer in die Irre führen. Deshalb muss der
 * Aufruf ausdrücklich bestätigt werden.
 */

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "demo-passwort-2026";

function hash(password: string): Promise<string> {
  const N = 32_768;
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, 64, { N, r: 8, p: 1, maxmem: 128 * N * 8 * 2 }, (err, key) =>
      err
        ? reject(err)
        : resolve(
            ["scrypt", N, 8, 1, salt.toString("base64url"), (key as Buffer).toString("base64url")].join("$"),
          ),
    );
  });
}

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error(
      "Dieses Skript schreibt Demo-Daten in die Datenbank hinter DATABASE_URL.\n" +
        "Zum Ausführen mit --confirm aufrufen:\n\n" +
        "  npm run db:seed -- --confirm\n",
    );
    process.exit(1);
  }

  // Demo-Konten haben ein im Repository stehendes Passwort. In Produktion
  // wären sie offene Türen — deshalb nur mit ausdrücklichem zweiten Schalter.
  const produktiv =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  if (produktiv && !process.argv.includes("--auch-in-produktion")) {
    console.error(
      "Diese Umgebung ist als Produktion markiert. Demo-Konten mit bekanntem Passwort\n" +
        "gehören dort nicht hin. Wenn es wirklich sein muss:\n\n" +
        "  npm run db:seed -- --confirm --auch-in-produktion\n",
    );
    process.exit(1);
  }

  const { db, sql, schema } = connect();
  const passwordHash = await hash(DEMO_PASSWORD);

  // Fahrzeughalter ergibt sich aus dem zugehörigen Inserat
  const ownerByVehicle = new Map(seedListings.map((l) => [l.vehicleId, l.ownerId]));

  console.log(`Lege ${seedUsers.length} Konten an …`);
  await db
    .insert(schema.users)
    .values(
      seedUsers.map((u) => ({
        id: u.id,
        email: u.email,
        emailVerifiedAt: new Date(u.memberSince),
        passwordHash,
        name: u.name,
        location: u.location,
        canton: u.canton,
        avatarColor: u.avatarColor,
        // Bewertungen werden als Summe in Zehnteln gehalten
        ratingSum: Math.round(u.rating * 10) * u.ratingCount,
        ratingCount: u.ratingCount,
        swapsCompleted: u.swapsCompleted,
        /*
         * Bewusst hart auf false: Die Ausweisprüfung ist vorbereitet, aber
         * nichts im Produkt setzt sie. Demo-Konten mit dem Abzeichen «Ausweis
         * geprüft» zeigten beim Durchklicken ein Vertrauenssignal, das es in
         * Wirklichkeit nirgends gibt.
         */
        identityVerified: false,
        createdAt: new Date(u.memberSince),
      })),
    )
    .onConflictDoNothing();

  console.log(`Lege ${seedVehicles.length} Fahrzeuge an …`);
  await db
    .insert(schema.vehicles)
    .values(
      seedVehicles.map((v) => {
        const ownerId = ownerByVehicle.get(v.id);
        if (!ownerId) throw new Error(`Fahrzeug ${v.id} hat kein Inserat und damit keinen Halter.`);
        return {
          id: v.id,
          ownerId,
          make: v.make,
          model: v.model,
          trim: v.trim,
          firstRegistration: v.firstRegistration,
          mileageKm: v.mileageKm,
          fuel: v.fuel,
          body: v.body,
          drivetrain: v.drivetrain,
          powerPs: v.powerPs,
          listPriceNew: v.listPriceNew,
          condition: v.condition,
          color: v.color,
          rangeKm: v.rangeKm ?? null,
          batterySoh: v.batterySoh ?? null,
          features: v.features,
          notes: v.notes ?? null,
          defects: v.defects ?? [],
          serviceHistory: v.serviceHistory,
          previousOwners: v.previousOwners,
          accidentFree: v.accidentFree,
          mfkUntil: v.mfkUntil ?? null,
          photos: [],
        };
      }),
    )
    .onConflictDoNothing();

  console.log(`Lege ${seedListings.length} Inserate an …`);
  await db
    .insert(schema.listings)
    .values(
      seedListings.map((l) => ({
        id: l.id,
        vehicleId: l.vehicleId,
        ownerId: l.ownerId,
        wishMakes: l.wish.makes,
        wishBodies: l.wish.bodies,
        wishFuels: l.wish.fuels,
        wishMinYear: l.wish.minYear ?? null,
        wishMaxMileageKm: l.wish.maxMileageKm ?? null,
        wishMaxCashOut: l.wish.maxCashOut ?? null,
        wishNotes: l.wish.notes ?? null,
        askPremium: l.askPremium ?? 0,
        views: l.views,
        status: "aktiv" as const,
        createdAt: new Date(l.createdAt),
      })),
    )
    .onConflictDoNothing();

  console.log(
    `\nFertig. Demo-Anmeldung z.B. ${seedUsers[0].email} mit Passwort «${DEMO_PASSWORD}».`,
  );
  await sql.end();
}

main().catch((err) => {
  console.error("Seed fehlgeschlagen:", err);
  process.exit(1);
});
