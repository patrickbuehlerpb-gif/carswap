import { expect, test } from "@playwright/test";
import { sql as raw } from "drizzle-orm";
import { connect } from "../scripts/db-connect";

/**
 * Der Marktplatz mit vielen Inseraten.
 *
 * Gemessen mit 500 Stück auf einem viermal gedrosselten Gerät kostete es
 * 3,0 Sekunden bis zur ersten Karte und 1,5 Sekunden für jeden Filterklick,
 * solange alle Karten gleichzeitig im DOM standen. Nicht das Rechnen war
 * teuer — die Passung für alle 500 dauert zehn Millisekunden —, sondern das
 * Aufbauen und wieder Abräumen von fünfhundert Kartengerüsten.
 *
 * Deshalb hält dieser Lauf fest, dass immer nur eine Seite im DOM steht. Eine
 * Zeitgrenze wäre die naheliegende Prüfung, aber auf geteilter Hardware
 * schwankt sie zu stark, um etwas zu bedeuten. Die Anzahl der Kartengerüste
 * ist dieselbe Aussage, nur ohne Zufall.
 */

const SEITE = 24;
const ANZAHL = 60;
const angelegt: string[] = [];

function eindeutig(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

test.afterAll(async () => {
  if (!angelegt.length) return;
  const { db, sql } = connect();
  for (const id of angelegt) await db.execute(raw`delete from users where id = ${id}`);
  await sql.end();
});

test.beforeAll(async () => {
  const { db, sql } = connect();
  const marken = ["Aiways", "Lucid", "Rivian", "Fisker"];
  for (let i = 0; i < ANZAHL; i++) {
    const userId = eindeutig(`usr_m${i}`);
    const vehicleId = eindeutig(`veh_m${i}`);
    await db.execute(raw`
      insert into users (id, email, name, password_hash, email_verified_at, location, canton)
      values (${userId}, ${`${userId}@example.invalid`}, ${`Halter ${i}`}, 'scrypt$1$1$1$AA$AA', now(), 'Zug', 'ZG')`);
    await db.execute(raw`
      insert into vehicles (
        id, owner_id, make, model, first_registration, mileage_km, fuel, body,
        drivetrain, power_ps, list_price_new, condition, service_history, color
      ) values (
        ${vehicleId}, ${userId}, ${marken[i % marken.length]}, ${`Typ ${i}`}, '2022-03-01',
        ${20000 + i * 500}, 'elektro', 'suv', 'heck', 210, ${50000 + i * 100}, 'gut',
        'lückenlos scheckheft', 'blau'
      )`);
    await db.execute(raw`
      insert into listings (id, vehicle_id, owner_id, status)
      values (${eindeutig(`lst_m${i}`)}, ${vehicleId}, ${userId}, 'aktiv')`);
    angelegt.push(userId);
  }
  await sql.end();
});

test("zeigt erst eine Seite und lädt den Rest auf Klick nach", async ({ page }) => {
  await page.goto("/markt");

  // Die Zählung nennt alle, im DOM steht nur die erste Seite.
  await expect(page.getByText(/\d+ Inserate/)).toBeVisible();
  await expect(page.locator("article")).toHaveCount(SEITE);

  const knopf = page.getByRole("button", { name: /Weitere \d+ von \d+ zeigen/ });
  await expect(knopf).toBeVisible();
  await knopf.click();
  await expect(page.locator("article")).toHaveCount(SEITE * 2);
});

test("fängt nach einem Filterwechsel wieder von vorn an", async ({ page }) => {
  await page.goto("/markt");
  await page.getByRole("button", { name: /Weitere \d+ von \d+ zeigen/ }).click();
  await expect(page.locator("article")).toHaveCount(SEITE * 2);

  // Ein Filter, der genug übrig lässt, um wieder eine volle Seite zu füllen.
  await page.getByRole("button", { name: "Aiways", exact: true }).first().click();
  await expect(page.locator("article")).toHaveCount(ANZAHL / 4);

  // Und zurück: wieder nur eine Seite, nicht die vorher nachgeladenen zwei.
  await page.getByRole("button", { name: "Aiways", exact: true }).first().click();
  await expect(page.locator("article")).toHaveCount(SEITE);
});

test("kommt ohne Nachladeknopf aus, wenn alles auf eine Seite passt", async ({ page }) => {
  await page.goto("/markt");
  await page.getByRole("button", { name: "Lucid", exact: true }).first().click();
  await expect(page.locator("article")).toHaveCount(ANZAHL / 4);
  await expect(page.getByRole("button", { name: /Weitere/ })).toHaveCount(0);
});
