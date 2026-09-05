import { expect, test } from "@playwright/test";
import { connect } from "../scripts/db-connect";
import { sql as raw } from "drizzle-orm";
import { registriere } from "./hilfen";

/**
 * Die Betriebsübersicht ist die einzige Seite, auf der Geldbeträge und
 * fremde E-Mail-Adressen stehen. Dass sie niemand ausser der Betreiberin
 * sieht, gehört deshalb in den Browserlauf und nicht nur in einen Kommentar.
 */

async function zumAdminMachen(email: string): Promise<void> {
  const { db, sql } = connect();
  await db.execute(raw`update users set is_admin = true where email = ${email}`);
  await sql.end();
}

test("Betriebsübersicht bleibt Nicht-Admins verborgen", async ({ page }) => {
  await registriere(page, { name: "Chefin", ort: "Zug", kanton: "ZG" });

  await page.goto("/admin/betrieb");
  await expect(page.getByRole("heading", { name: /Diese Seite gibt es nicht/i })).toBeVisible();

  // Und im Menü taucht sie gar nicht erst auf.
  await page.goto("/garage");
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await expect(page.getByRole("menuitem", { name: "Betrieb" })).toHaveCount(0);
});

test("Betriebsübersicht zeigt der Betreiberin die Zahlen", async ({ page }) => {
  const email = await registriere(page, { name: "Chefin", ort: "Zug", kanton: "ZG" });
  await zumAdminMachen(email);

  await page.goto("/garage");
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.getByRole("menuitem", { name: "Betrieb" }).click();
  await page.waitForURL("**/admin/betrieb");

  await expect(page.getByRole("heading", { name: "Betrieb" })).toBeVisible();
  await expect(page.getByText("Konten", { exact: true })).toBeVisible();
  await expect(page.getByText("Tausche nach Zustand")).toBeVisible();
  // Ohne eingerichtete Zugangsdaten muss die Seite genau das sagen.
  await expect(
    page.getByRole("heading", { name: "Noch nicht eingerichtet" }),
  ).toBeVisible();
});

test("Betriebsübersicht läuft auf dem Telefon nicht über", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = await registriere(page, { name: "Chefin", ort: "Zug", kanton: "ZG" });
  await zumAdminMachen(email);

  await page.goto("/admin/betrieb");
  await expect(page.getByRole("heading", { name: "Betrieb" })).toBeVisible();
  // Die Tabelle «Geld unterwegs» scrollt in ihrem eigenen Kasten; die Seite
  // selbst darf das nicht.
  const breite = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(breite).toBeLessThanOrEqual(391);
});
