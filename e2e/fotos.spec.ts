import { expect, test } from "@playwright/test";
import { sql as raw } from "drizzle-orm";
import { connect } from "../scripts/db-connect";

/**
 * Auf der Fahrzeugseite standen lange keine Fotos, obwohl man welche
 * hochladen konnte. Dieser Lauf hält beides fest: mit Fotos gibt es eine
 * Galerie, ohne Fotos die Silhouette.
 *
 * Die Bilder selbst laden hier nicht — die Adressen zeigen ins Leere. Geprüft
 * wird der Aufbau der Seite, nicht der Blob-Speicher.
 */

const PASSWORT = "ein sehr langes Testpasswort";
const HOST = "https://beispiel.public.blob.vercel-storage.com";

function eindeutig(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Die angelegten Konten werden am Ende wieder entfernt. Alle Spec-Dateien
 * teilen sich eine Datenbank, die nur einmal vor dem ganzen Lauf geleert wird
 * — ein hier eingefügtes Inserat stünde sonst im Marktplatz der anderen
 * Durchläufe und liesse deren Zählungen scheitern.
 */
const angelegt: string[] = [];

test.afterAll(async () => {
  if (!angelegt.length) return;
  const { db, sql } = connect();
  for (const id of angelegt) {
    await db.execute(raw`delete from users where id = ${id}`);
  }
  await sql.end();
});

async function autoMitFotos(anzahl: number): Promise<string> {
  const { db, sql } = connect();
  const userId = eindeutig("usr_e2e");
  const vehicleId = eindeutig("veh_e2e");
  const listingId = eindeutig("lst_e2e");
  const fotos = Array.from({ length: anzahl }, (_, i) => ({
    url: `${HOST}/foto-${i}.webp`,
    width: 1600,
    height: 900,
  }));

  await db.execute(raw`
    insert into users (id, email, name, password_hash, email_verified_at, location, canton)
    values (${userId}, ${`${userId}@example.invalid`}, 'Fotolieferant', 'scrypt$1$1$1$AA$AA', now(), 'Chur', 'GR')`);
  await db.execute(raw`
    insert into vehicles (
      id, owner_id, make, model, first_registration, mileage_km, fuel, body,
      drivetrain, power_ps, list_price_new, condition, service_history, color, photos
    ) values (
      ${vehicleId}, ${userId}, 'Fisker', 'Ocean', '2023-05-10', 22000, 'elektro', 'suv',
      'heck', 272, 68000, 'gut', 'lückenlos scheckheft', 'blau',
      ${JSON.stringify(fotos)}::jsonb
    )`);
  await db.execute(raw`
    insert into listings (id, vehicle_id, owner_id, status)
    values (${listingId}, ${vehicleId}, ${userId}, 'aktiv')`);
  await sql.end();
  angelegt.push(userId);
  return vehicleId;
}

async function anmelden(page: import("@playwright/test").Page) {
  const email = `${eindeutig("e2e-foto")}@example.invalid`;
  await page.goto("/konto/registrieren");
  await page.fill('input[name="name"]', "Schauende");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORT);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/garage**");
}

test("Fahrzeugseite zeigt die hochgeladenen Fotos", async ({ page }) => {
  const vehicleId = await autoMitFotos(3);
  await anmelden(page);
  await page.goto(`/auto/${vehicleId}`);

  // Das grosse Bild und zwei weitere zur Auswahl.
  await expect(page.getByRole("group", { name: "Weitere Fotos" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Bild \d anzeigen/ })).toHaveCount(3);

  const gross = page.getByRole("img", { name: /Bild 1 von 3/ });
  await expect(gross).toBeVisible();
  // next/image liefert eine skalierte Fassung aus, nicht das Original.
  await expect(gross).toHaveAttribute("src", /\/_next\/image/);

  await page.getByRole("button", { name: "Bild 2 anzeigen" }).click();
  await expect(page.getByRole("img", { name: /Bild 2 von 3/ })).toBeVisible();
});

test("Fahrzeugseite ohne Fotos zeigt die Silhouette statt einer Lücke", async ({ page }) => {
  const vehicleId = await autoMitFotos(0);
  await anmelden(page);
  await page.goto(`/auto/${vehicleId}`);

  await expect(page.getByRole("group", { name: "Weitere Fotos" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Fisker/ })).toBeVisible();
});
