import { expect, test } from "@playwright/test";
import { sql as raw } from "drizzle-orm";
import { connect } from "../scripts/db-connect";
import { eindeutig } from "./hilfen";

/**
 * Dieselbe Seite wird unter zwei Adressen ausgeliefert: unter der eigenen
 * Domain und unter der, die der Anbieter dem Projekt gegeben hat. Für eine
 * Suchmaschine sind das zwei Seiten mit identischem Inhalt, die einander Rang
 * wegnehmen — und die Adresse, unter der die Marke auftreten soll, ist nicht
 * unbedingt die, die gewinnt.
 *
 * Der Verweis auf die kanonische Adresse löst das. Er muss auf genau den
 * Seiten stehen, die auch in der Sitemap stehen; steht er auf einer nicht,
 * fällt es niemandem auf, bis die falsche Adresse indexiert ist.
 */

const angelegt: string[] = [];

test.afterAll(async () => {
  if (!angelegt.length) return;
  const { db, sql } = connect();
  for (const id of angelegt) await db.execute(raw`delete from users where id = ${id}`);
  await sql.end();
});

/** Die Adresse, unter der der Testserver läuft — dieselbe, die SITE_URL nennt. */
function basis(): string {
  return process.env.SITE_URL ?? "http://127.0.0.1:3210";
}

const SEITEN = ["/", "/markt", "/wert", "/wertverlust", "/so-funktionierts", "/agb", "/datenschutz", "/impressum"];

for (const pfad of SEITEN) {
  test(`${pfad} nennt seine kanonische Adresse`, async ({ page }) => {
    await page.goto(pfad);
    const href = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(href, `${pfad} hat keinen canonical`).toBe(`${basis()}${pfad === "/" ? "" : pfad}`);
  });
}

test("die Fahrzeugseite nennt ihre eigene Adresse, nicht die der Startseite", async ({ page }) => {
  const { db, sql } = connect();
  const userId = eindeutig("usr_can");
  const vehicleId = eindeutig("veh_can");
  await db.execute(raw`
    insert into users (id, email, name, password_hash, email_verified_at, location, canton)
    values (${userId}, ${`${userId}@example.invalid`}, 'Kanonisch', 'scrypt$1$1$1$AA$AA', now(), 'Chur', 'GR')`);
  await db.execute(raw`
    insert into vehicles (
      id, owner_id, make, model, first_registration, mileage_km, fuel, body,
      drivetrain, power_ps, list_price_new, condition, service_history, color
    ) values (
      ${vehicleId}, ${userId}, 'Lucid', 'Air', '2022-05-01', 28000, 'elektro', 'limousine',
      'allrad', 480, 110000, 'gut', 'lückenlos scheckheft', 'weiss'
    )`);
  await db.execute(raw`
    insert into listings (id, vehicle_id, owner_id, status)
    values (${eindeutig("lst_can")}, ${vehicleId}, ${userId}, 'aktiv')`);
  await sql.end();
  angelegt.push(userId);

  await page.goto(`/auto/${vehicleId}`);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${basis()}/auto/${vehicleId}`,
  );
});

test("jede Seite aus der Sitemap hat auch einen canonical", async ({ page, request }) => {
  /*
   * Die Liste oben und die Sitemap sind zwei Aufzählungen derselben Sache.
   * Kommt eine Seite dazu und nur eine der beiden wird nachgeführt, fällt es
   * niemandem auf — bis die falsche Adresse indexiert ist. Deshalb wird hier
   * gegen die Sitemap selbst geprüft.
   */
  const xml = await (await request.get("/sitemap.xml")).text();
  const adressen = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(adressen.length).toBeGreaterThan(0);

  /*
   * Ohne die Fahrzeugseiten: Die Sitemap wird mit `revalidate` gerendert und
   * kann deshalb Inserate aus einem früheren Stand nennen, die es in dieser
   * Datenbank nicht mehr gibt — das wäre ein Fehler des Testaufbaus, nicht der
   * Anwendung. Für sie steht die Prüfung oben, mit einem Inserat, das dieser
   * Lauf selbst anlegt.
   */
  const feste = adressen
    .map((a) => new URL(a).pathname)
    .filter((p) => !p.startsWith("/auto/"));
  expect(feste.length).toBeGreaterThan(3);

  for (const pfad of feste) {
    await page.goto(pfad);
    const href = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(href, `${pfad} steht in der Sitemap, hat aber keinen canonical`).toBe(
      `${basis()}${pfad === "/" ? "" : pfad}`,
    );
  }
});
