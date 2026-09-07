import { expect, test } from "@playwright/test";
import { sql as raw } from "drizzle-orm";
import { connect } from "../scripts/db-connect";
import { abmelden, eindeutig, raeumeKontenAuf, registriere } from "./hilfen";

/**
 * Was nicht mehr zu haben ist, darf die Fahrzeugseite nicht als Angebot
 * zeigen — und was die Betreiberin gesperrt hat, gar nicht mehr.
 *
 * Vorher prüfte die Seite den Zustand des Inserats überhaupt nicht: ein wegen
 * gefälschter Angaben gesperrtes Auto stand unverändert mit Fotos,
 * Beschreibung, Mängelliste und Wunschliste da, unter einer Adresse, die in
 * der Sitemap steht. Und daneben der Knopf «Tausch vorschlagen», der auf eine
 * Seite führte, die mit 404 endet.
 */

const adressen: string[] = [];
const fahrzeuge: string[] = [];

test.afterAll(async () => {
  const { db, sql } = connect();
  for (const id of fahrzeuge) {
    await db.execute(raw`delete from listings where vehicle_id = ${id}`);
    await db.execute(raw`delete from vehicles where id = ${id}`);
  }
  await sql.end();
  await raeumeKontenAuf({ adressen });
});

/** Ein Inserat direkt eintragen — der Weg über das Formular ist hier nicht der Punkt. */
async function stelleEin(email: string, status = "aktiv"): Promise<string> {
  const { db, sql } = connect();
  const vehicleId = eindeutig("veh_sp");
  await db.execute(raw`
    insert into vehicles (
      id, owner_id, make, model, first_registration, mileage_km, fuel, body,
      drivetrain, power_ps, list_price_new, condition, service_history, color, notes
    ) select
      ${vehicleId}, id, 'Lucid', 'Air', '2022-05-01', 28000, 'elektro', 'limousine',
      'allrad', 480, 110000, 'gut', 'lückenlos scheckheft', 'weiss',
      'Geheime Beschreibung des Besitzers'
      from users where email = ${email}`);
  await db.execute(raw`
    insert into listings (id, vehicle_id, owner_id, status)
    select ${eindeutig("lst_sp")}, ${vehicleId}, id, ${status} from users where email = ${email}`);
  await sql.end();
  fahrzeuge.push(vehicleId);
  return vehicleId;
}

async function sperre(vehicleId: string): Promise<void> {
  const { db, sql } = connect();
  await db.execute(raw`
    update listings set status = 'pausiert', blocked_at = now(), blocked_reason = 'Kennzeichen gefälscht'
    where vehicle_id = ${vehicleId}`);
  await sql.end();
}

test("ein gesperrtes Inserat ist für alle ausser dem Besitzer weg", async ({ page }) => {
  const besitzer = await registriere(page, { name: "Bruno", ort: "Chur", kanton: "GR" });
  adressen.push(besitzer);
  const vehicleId = await stelleEin(besitzer);

  await abmelden(page);

  // Vorher: die Seite steht öffentlich, mitsamt der Beschreibung.
  await page.goto(`/auto/${vehicleId}`);
  await expect(page.getByText("Geheime Beschreibung des Besitzers")).toBeVisible();

  await sperre(vehicleId);

  await page.goto(`/auto/${vehicleId}`);
  await expect(page.getByRole("heading", { name: /Diese Seite gibt es nicht/i })).toBeVisible();
  await expect(page.getByText("Geheime Beschreibung des Besitzers")).toHaveCount(0);

  // Auch für ein anderes angemeldetes Konto, nicht nur für Gäste.
  const fremde = await registriere(page, { name: "Fremde", ort: "Zug", kanton: "ZG" });
  adressen.push(fremde);
  await page.goto(`/auto/${vehicleId}`);
  await expect(page.getByRole("heading", { name: /Diese Seite gibt es nicht/i })).toBeVisible();
});

test("ein pausiertes Auto verspricht keinen Tausch mehr", async ({ page }) => {
  const besitzer = await registriere(page, { name: "Paula", ort: "Bern", kanton: "BE" });
  adressen.push(besitzer);
  const vehicleId = await stelleEin(besitzer, "pausiert");
  await abmelden(page);

  const interessent = await registriere(page, { name: "Ivo", ort: "Zug", kanton: "ZG" });
  adressen.push(interessent);

  await page.goto(`/auto/${vehicleId}`);
  // Das Auto bleibt sichtbar — es ist ja nicht gesperrt, nur nicht zu haben.
  await expect(page.getByRole("heading", { name: /Lucid Air/ })).toBeVisible();
  await expect(page.getByText(/pausiert. Es steht gerade nicht zum Tausch/)).toBeVisible();
  // Und genau der Knopf fehlt, der vorher ins Leere führte.
  await expect(page.getByRole("link", { name: "Tausch vorschlagen" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /merken/i })).toHaveCount(0);
});
