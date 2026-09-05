import { expect, test, type Page } from "@playwright/test";
import { PASSWORT, abmelden, anmeldeVersuch, anmelden, eindeutig, registriere } from "./hilfen";

/**
 * Passwort und E-Mail-Adresse im echten Browser wechseln.
 *
 * Beides sind Wege, die im Ernstfall gebraucht werden — verlorenes Passwort,
 * gewechselter Anbieter — und beide berühren die Anmeldung selbst. Ein Fehler
 * darin sperrt jemanden aus seinem Konto aus.
 */

const NEUES_PASSWORT = "ein anderes langes Testpasswort";

/** Meldungen der Formulare — nicht der Routen-Ansager von Next, der ebenfalls role=alert trägt. */
function fehler(page: Page) {
  return page.locator('p[role="alert"]');
}

test("Passwort ändern und mit dem neuen wieder anmelden", async ({ page }) => {
  const email = await registriere(page, { name: "Nina", ort: "Bern", kanton: "BE" });

  await page.goto("/konto");
  await page.getByRole("button", { name: "Ändern", exact: true }).last().click();

  // Ein falsches aktuelles Passwort ändert nichts.
  await page.fill('input[name="current"]', "das ist nicht das Passwort");
  await page.fill('input[name="password"]', NEUES_PASSWORT);
  await page.fill('input[name="repeat"]', NEUES_PASSWORT);
  await page.getByRole("button", { name: /Passwort ändern/i }).click();
  await expect(fehler(page)).toContainText(/aktuelle Passwort stimmt nicht/i);

  await page.fill('input[name="current"]', PASSWORT);
  await page.fill('input[name="password"]', NEUES_PASSWORT);
  await page.fill('input[name="repeat"]', NEUES_PASSWORT);
  await page.getByRole("button", { name: /Passwort ändern/i }).click();
  await expect(page.locator('p[role="status"]')).toContainText(/Passwort geändert/i);

  // Dieses Gerät bleibt angemeldet.
  await page.goto("/garage");
  await expect(page).toHaveURL(/\/garage/);

  await abmelden(page);

  await anmeldeVersuch(page, email, PASSWORT);
  await expect(fehler(page)).toContainText(/stimmt nicht/i);

  await anmelden(page, email, NEUES_PASSWORT);
});

test("Adresswechsel gilt erst nach der Bestätigung", async ({ page }) => {
  const email = await registriere(page, { name: "Nina", ort: "Bern", kanton: "BE" });
  const neu = `${eindeutig("e2e-neu")}@example.invalid`;

  await page.goto("/konto");
  await page.getByRole("button", { name: "Ändern", exact: true }).first().click();
  await page.fill('input[name="email"]', neu);
  await page.fill('input[name="current"]', PASSWORT);
  await page.getByRole("button", { name: /Link schicken/i }).click();
  await expect(page.getByText(/Wechsel zu/)).toContainText(neu);

  // Bis zum Klick auf den Link bleibt die alte Adresse in Kraft — auch zum
  // Anmelden.
  await page.reload();
  await expect(page.getByText(email).first()).toBeVisible();
  await expect(page.getByText(/Wechsel zu/)).toContainText(neu);

  await abmelden(page);
  await anmeldeVersuch(page, neu, PASSWORT);
  await expect(fehler(page)).toContainText(/stimmt nicht/i);

  await anmelden(page, email, PASSWORT);

  // Den Wechsel wieder zurücknehmen.
  await page.goto("/konto");
  await page.getByRole("button", { name: /Wechsel abbrechen/i }).click();
  await expect(page.getByText(/Wechsel zu/)).toHaveCount(0);
});
