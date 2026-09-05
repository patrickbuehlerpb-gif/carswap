import { expect, test, type Page } from "@playwright/test";

/**
 * Passwort und E-Mail-Adresse im echten Browser wechseln.
 *
 * Beides sind Wege, die im Ernstfall gebraucht werden — verlorenes Passwort,
 * gewechselter Anbieter — und beide berühren die Anmeldung selbst. Ein Fehler
 * darin sperrt jemanden aus seinem Konto aus.
 */

const PASSWORT = "ein sehr langes Testpasswort";
const NEUES_PASSWORT = "ein anderes langes Testpasswort";

function eindeutig(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function registrieren(page: Page): Promise<string> {
  const email = `${eindeutig("e2e")}@example.invalid`;
  await page.goto("/konto/registrieren");
  await page.fill('input[name="name"]', "Nina");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORT);
  await page.fill('input[name="location"]', "Bern");
  await page.fill('input[name="canton"]', "BE");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/garage**");
  return email;
}

async function abmelden(page: Page) {
  await page.goto("/garage");
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.getByRole("button", { name: /Abmelden/i }).click();
  await page.waitForURL(/\/(\?.*)?$/);
}

/** Meldungen der Formulare — nicht der Routen-Ansager von Next, der ebenfalls role=alert trägt. */
function fehler(page: Page) {
  return page.locator('p[role="alert"]');
}

async function anmelden(page: Page, email: string, passwort: string) {
  await page.goto("/konto/anmelden");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', passwort);
  await page.click('button[type="submit"]');
}

test("Passwort ändern und mit dem neuen wieder anmelden", async ({ page }) => {
  const email = await registrieren(page);

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

  await anmelden(page, email, PASSWORT);
  await expect(fehler(page)).toContainText(/stimmt nicht/i);

  await anmelden(page, email, NEUES_PASSWORT);
  await page.waitForURL((url) => !url.pathname.startsWith("/konto/anmelden"));
});

test("Adresswechsel gilt erst nach der Bestätigung", async ({ page }) => {
  const email = await registrieren(page);
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
  await anmelden(page, neu, PASSWORT);
  await expect(fehler(page)).toContainText(/stimmt nicht/i);

  await anmelden(page, email, PASSWORT);
  await page.waitForURL((url) => !url.pathname.startsWith("/konto/anmelden"));

  // Den Wechsel wieder zurücknehmen.
  await page.goto("/konto");
  await page.getByRole("button", { name: /Wechsel abbrechen/i }).click();
  await expect(page.getByText(/Wechsel zu/)).toHaveCount(0);
});
