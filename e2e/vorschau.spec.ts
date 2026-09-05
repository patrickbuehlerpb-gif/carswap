import { expect, test } from "@playwright/test";
import { sql as raw } from "drizzle-orm";
import { connect } from "../scripts/db-connect";
import { eindeutig, raeumeKontenAuf } from "./hilfen";

/**
 * Was ein Chatprogramm sieht, wenn jemand einen Link weiterschickt.
 *
 * Diese Angaben stehen nur im Kopf der Seite und fallen im Betrieb niemandem
 * auf, wenn sie fehlen — der Absender sieht die Vorschau ja nicht selbst.
 */

const HOST = "https://beispiel.public.blob.vercel-storage.com";
const angelegt: string[] = [];

test.afterAll(async () => {
  await raeumeKontenAuf({ ids: angelegt });
});

async function inseratAnlegen(mitFoto: boolean): Promise<string> {
  const { db, sql } = connect();
  const userId = eindeutig("usr_og");
  const vehicleId = eindeutig("veh_og");
  const fotos = mitFoto
    ? [{ url: `${HOST}/vorschau.webp`, width: 1600, height: 900 }]
    : [];

  await db.execute(raw`
    insert into users (id, email, name, password_hash, email_verified_at, location, canton)
    values (${userId}, ${`${userId}@example.invalid`}, 'Olga', 'scrypt$1$1$1$AA$AA', now(), 'Luzern', 'LU')`);
  await db.execute(raw`
    insert into vehicles (
      id, owner_id, make, model, trim, first_registration, mileage_km, fuel, body,
      drivetrain, power_ps, list_price_new, condition, service_history, color, photos
    ) values (
      ${vehicleId}, ${userId}, 'Cupra', 'Born', 'e-Boost', '2022-06-15', 38000, 'elektro', 'suv',
      'heck', 204, 54000, 'gut', 'lückenlos scheckheft', 'grau', ${JSON.stringify(fotos)}::jsonb
    )`);
  await db.execute(raw`
    insert into listings (id, vehicle_id, owner_id, status)
    values (${eindeutig("lst_og")}, ${vehicleId}, ${userId}, 'aktiv')`);
  await sql.end();
  angelegt.push(userId);
  return vehicleId;
}

/** Liest ein Meta-Feld so aus, wie es ein Chatprogramm täte. */
async function meta(page: import("@playwright/test").Page, feld: string): Promise<string | null> {
  return await page
    .locator(`meta[property="${feld}"], meta[name="${feld}"]`)
    .first()
    .getAttribute("content");
}

test("die Startseite bringt Titel, Beschreibung und ein Bild mit", async ({ page }) => {
  await page.goto("/");
  expect(await meta(page, "og:title")).toContain("quitt");
  expect(await meta(page, "og:site_name")).toBe("quitt");
  expect(await meta(page, "og:locale")).toBe("de_CH");
  expect(await meta(page, "twitter:card")).toBe("summary_large_image");

  const bild = await meta(page, "og:image");
  expect(bild).toBeTruthy();
  // Absolut, nicht relativ: ein Chatprogramm bekommt nur den Link als Text.
  expect(bild!).toMatch(/^https?:\/\//);
  const antwort = await page.request.get(bild!);
  expect(antwort.status()).toBe(200);
  expect(antwort.headers()["content-type"]).toContain("image/png");
});

test("ein Inserat zeigt das Auto, nicht die Startseite", async ({ page }) => {
  const vehicleId = await inseratAnlegen(true);
  await page.goto(`/auto/${vehicleId}`);

  expect(await meta(page, "og:title")).toBe("Cupra Born e-Boost — zum Tausch");
  const beschreibung = await meta(page, "og:description");
  expect(beschreibung).toContain("2022");
  expect(beschreibung).toContain("Elektro");
  // Die Einheit steht genau einmal da.
  expect(beschreibung).toMatch(/38’000 km(?! km)/);
  expect(await meta(page, "og:image")).toBe(`${HOST}/vorschau.webp`);
  expect(await meta(page, "og:type")).toBe("article");
});

test("ein Inserat ohne Foto fällt auf das Bild der Seite zurück", async ({ page }) => {
  const vehicleId = await inseratAnlegen(false);
  await page.goto(`/auto/${vehicleId}`);

  expect(await meta(page, "og:title")).toBe("Cupra Born e-Boost — zum Tausch");
  const bild = await meta(page, "og:image");
  // Nicht die Silhouette: die ist auf der Seite ein ehrlicher Platzhalter,
  // in einer Chatvorschau wäre sie bloss verwirrend.
  expect(bild).toContain("/opengraph-image");
});
