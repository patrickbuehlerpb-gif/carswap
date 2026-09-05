import { expect, test } from "@playwright/test";
import { sql as raw } from "drizzle-orm";
import { connect } from "../scripts/db-connect";
import { eindeutig, raeumeKontenAuf, registriere } from "./hilfen";

/**
 * Tag eins — der Marktplatz ist leer.
 *
 * Das ist beim Start kein Sonderfall, sondern der Normalfall: die erste
 * Person, die sich anmeldet, findet nichts vor. Was sie dann liest,
 * entscheidet, ob sie wiederkommt. Vorher stand dort zweierlei Falsches: der
 * Marktplatz forderte «Sei der Erste — Auto einstellen», auch wenn genau das
 * gerade getan worden war, und die Treffer-Seite riet, die Kriterien zu
 * erweitern, obwohl es überhaupt nichts zu filtern gab.
 *
 * Der Lauf prüft beide Zustände am selben Konto: erst ohne eigenes Inserat,
 * dann mit.
 */

let adresse = "";
const angelegt: string[] = [];

test.afterAll(async () => {
  await raeumeKontenAuf({ ids: angelegt, adressen: adresse ? [adresse] : [] });
});

/** Die eigene Kennung — das Inserat wird direkt eingetragen, nicht geklickt. */
async function meineId(email: string): Promise<string> {
  const { db, sql } = connect();
  const rows = await db.execute<{ id: string }>(
    raw`select id from users where email = ${email}`,
  );
  await sql.end();
  const id = rows[0]?.id;
  if (!id) throw new Error(`Kein Konto zu ${email} gefunden.`);
  return id;
}

/**
 * Die Prüfung setzt einen leeren Markt voraus. Bleibt aus einem anderen
 * Durchlauf ein Inserat stehen, schlägt sie sonst mit einem Fehlerbild fehl,
 * das nach einem Fehler in der Anwendung aussieht — deshalb wird die
 * Voraussetzung ausdrücklich benannt.
 */
async function fremdeInserate(meine: string): Promise<number> {
  const { db, sql } = connect();
  const rows = await db.execute<{ n: number }>(
    raw`select count(*)::int as n from listings where status = 'aktiv' and owner_id <> ${meine}`,
  );
  await sql.end();
  return rows[0]?.n ?? 0;
}

async function stelleAutoEin(userId: string): Promise<void> {
  const { db, sql } = connect();
  const vehicleId = eindeutig("veh_t1");
  await db.execute(raw`
    insert into vehicles (
      id, owner_id, make, model, first_registration, mileage_km, fuel, body,
      drivetrain, power_ps, list_price_new, condition, service_history, color
    ) values (
      ${vehicleId}, ${userId}, 'Polestar', 'Erstwagen', '2021-06-01', 41000, 'elektro',
      'kombi', 'allrad', 300, 62000, 'gut', 'lückenlos scheckheft', 'grau'
    )`);
  await db.execute(raw`
    insert into listings (id, vehicle_id, owner_id, status)
    values (${eindeutig("lst_t1")}, ${vehicleId}, ${userId}, 'aktiv')`);
  await sql.end();
}

test("die erste Person bekommt gesagt, woran es liegt", async ({ page }) => {
  adresse = await registriere(page, { name: "Erste", ort: "Chur", kanton: "GR" });
  const userId = await meineId(adresse);
  angelegt.push(userId);

  const fremde = await fremdeInserate(userId);
  expect(
    fremde,
    `Voraussetzung: kein fremdes Inserat im Markt — es stehen ${fremde} drin. ` +
      `Wahrscheinlich hat ein anderer Lauf nicht aufgeräumt.`,
  ).toBe(0);

  // --- Ohne eigenes Auto: die Aufforderung ist richtig ---
  await page.goto("/markt");
  await expect(page.getByText("Aktuell steht kein Auto zum Tausch.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Sei der Erste/ })).toBeVisible();

  await page.goto("/matches");
  await expect(page.getByText("Du hast noch kein Auto eingestellt")).toBeVisible();

  // --- Mit eigenem Inserat: dieselbe Aufforderung wäre eine Zumutung ---
  await stelleAutoEin(userId);

  await page.goto("/markt");
  await expect(page.getByText("Ausser deinem steht noch kein Auto zum Tausch")).toBeVisible();
  await expect(page.getByRole("link", { name: /Sei der Erste/ })).toHaveCount(0);
  // Und das Versprechen, das die Wiederkehr trägt: wir melden uns.
  await expect(page.getByText(/schreiben dir, sobald jemand ein Auto wie deines sucht/)).toBeVisible();

  await page.goto("/matches");
  await expect(page.getByText("Ausser deinem steht noch kein Auto hier")).toBeVisible();
  // Der alte Rat war hier falsch: es gibt nichts, was ein weiterer Filter
  // gefunden hätte.
  await expect(page.getByText(/Erweitere die Kriterien/)).toHaveCount(0);
  await expect(page.getByText(/nicht an deinen Kriterien/)).toBeVisible();
});
