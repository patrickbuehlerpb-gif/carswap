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

test("gescheiterte Mails stehen ganz oben", async ({ page }) => {
  const email = await registriere(page, { name: "Chefin", ort: "Zug", kanton: "ZG" });
  await zumAdminMachen(email);

  // Ohne Fehlversuch soll auch nichts dastehen — sonst meldete die Seite
  // dauernd einen Ausfall, den es nicht gibt.
  await page.goto("/admin/betrieb");
  await expect(page.getByRole("heading", { name: "Mails kommen nicht an" })).toHaveCount(0);

  const { db, sql } = connect();
  await db.execute(raw`
    insert into mail_failures (id, domain, subject, reason)
    values ('mfl_e2e', 'gmx.ch', 'autotauschen: E-Mail-Adresse bestätigen', 'abgelehnt (422)')`);
  await sql.end();

  try {
    await page.goto("/admin/betrieb");
    await expect(page.getByRole("heading", { name: "Mails kommen nicht an" })).toBeVisible();
    await expect(page.getByText(/gmx\.ch/)).toBeVisible();
  } finally {
    // Bleibt die Zeile nach einem Fehlschlag stehen, scheitert beim nächsten
    // Lauf die erste Erwartung dieses Tests — und das sähe nach einem Fehler
    // in der Anwendung aus statt nach Resten aus dem letzten Durchgang.
    const auf = connect();
    await auf.db.execute(raw`delete from mail_failures where id = 'mfl_e2e'`);
    await auf.sql.end();
  }
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
