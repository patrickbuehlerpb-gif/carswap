import { expect, test, type Page } from "@playwright/test";

/**
 * Der vollständige Ablauf im echten Browser: zwei Konten, zwei Inserate,
 * Vorschlag, Gegenangebot, Zusage, Übergabe und Bewertung.
 *
 * Bewusst ohne Wertdifferenz — dieser Weg kommt ohne Stripe aus und deckt
 * trotzdem die ganze Zustandsmaschine ab. Der Geldpfad selbst hat eigene
 * Tests gegen ein Stripe-Doppel.
 */

const PASSWORT = "ein sehr langes Testpasswort";

function eindeutig(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function registrieren(page: Page, name: string) {
  const email = `${eindeutig("e2e")}@example.invalid`;
  await page.goto("/konto/registrieren");
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORT);
  await page.fill('input[name="location"]', "Zürich");
  await page.fill('input[name="canton"]', "ZH");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/garage**");
  return email;
}

async function anmelden(page: Page, email: string) {
  await page.goto("/konto/anmelden");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORT);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/konto/anmelden"));
}

async function abmelden(page: Page) {
  await page.goto("/garage");
  // Das Abmelden steckt im Benutzermenü der Kopfzeile.
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.getByRole("button", { name: /Abmelden/i }).click();
  await page.waitForURL(/\/(\?.*)?$/);
}

/** Legt ein Inserat an und gibt die Fahrzeug-Adresse zurück. */
async function inserieren(
  page: Page,
  marke: string,
  modell: string,
  neupreis: number,
  wunschMarke: string,
) {
  await page.goto("/inserat/neu");

  const markeFeld = page.getByRole("combobox").first();
  await markeFeld.click();
  await markeFeld.fill(marke);
  await page.getByRole("option", { name: marke, exact: true }).click();

  const modellFeld = page.getByRole("combobox").nth(1);
  await modellFeld.click();
  await modellFeld.fill(modell);
  const treffer = page.getByRole("option", { name: modell, exact: true });
  if (await treffer.count()) await treffer.click();
  else await page.keyboard.press("Tab");

  await page.locator('input[type="month"]').first().fill("2022-06");
  await page.locator('input[type="number"]').first().fill(String(neupreis));

  // Wunschmarke aus der Liste wählen
  await page.getByRole("button", { name: wunschMarke, exact: true }).first().click();

  await page.getByRole("button", { name: /Inserat veröffentlichen/i }).click();
  await page.waitForURL("**/fahrzeug/**");
  return page.url();
}

test("zwei Konten tauschen ein Fahrzeug und bewerten sich", async ({ page }) => {
  test.slow();

  /* ---- Anna inseriert ---- */
  const anna = await registrieren(page, "Anna Test");
  const annasAuto = await inserieren(page, "Polestar", "2", 55_000, "Kia");
  expect(annasAuto).toContain("/fahrzeug/");
  await abmelden(page);

  /* ---- Bruno inseriert und schlägt den Tausch vor ---- */
  const bruno = await registrieren(page, "Bruno Test");
  await inserieren(page, "Kia", "EV6", 55_000, "Polestar");

  await page.goto(annasAuto);
  await expect(page.getByRole("heading", { name: /Polestar/ })).toBeVisible();
  await page.getByRole("link", { name: /Tausch vorschlagen|Tausch anfragen|Vorschlag/i })
    .first()
    .click();
  await page.waitForURL("**/tausch/**");

  // Ausgleich auf null stellen: dieser Weg kommt ohne Stripe aus und deckt
  // trotzdem die ganze Zustandsmaschine ab.
  const regler = page.getByLabel("Ausgleichszahlung anpassen");
  await regler.evaluate((el: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, "0");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.getByText(/Kein Ausgleich|CHF 0/).first()).toBeVisible();

  await page.getByRole("button", { name: /Vorschlag senden|Tausch vorschlagen/i }).first().click();
  await page.waitForURL("**/deals/**");
  const dealUrl = page.url();
  await expect(page.getByText(/Vorschlag offen|In Verhandlung/)).toBeVisible();
  await abmelden(page);

  /* ---- Anna nimmt an ---- */
  await anmelden(page, anna);
  await page.goto(dealUrl);
  await page.getByRole("button", { name: /Angebot annehmen/ }).click();
  await expect(page.getByText("Angenommen")).toBeVisible();

  // Ohne Wertdifferenz führt der Weg direkt zur Übergabe
  await page.getByRole("button", { name: /Weiter zur Übergabe/ }).click();
  await expect(page.getByRole("button", { name: /Übergabe bestätigen/ })).toBeVisible();

  // Checkliste abarbeiten und bestätigen
  for (const box of await page.locator('input[type="checkbox"]').all()) await box.check();
  await page.getByRole("button", { name: /Übergabe bestätigen/ }).click();
  await expect(page.getByText(/Deine Bestätigung ist vermerkt/)).toBeVisible();
  await abmelden(page);

  /* ---- Bruno bestätigt, der Tausch schliesst ab ---- */
  await anmelden(page, bruno);
  await page.goto(dealUrl);
  for (const box of await page.locator('input[type="checkbox"]').all()) await box.check();
  await page.getByRole("button", { name: /Übergabe bestätigen/ }).click();
  await expect(page.getByText(/Tausch abgeschlossen/)).toBeVisible();

  /* ---- Das eingetauschte Fahrzeug steht in Brunos Garage ---- */
  await page.goto("/garage");
  await expect(page.getByText("Polestar").first()).toBeVisible();

  /* ---- Bewertung ---- */
  await page.goto(dealUrl);
  await page.getByRole("button", { name: "4.5" }).click();
  await page.fill("textarea", "Alles reibungslos gelaufen.");
  await page.getByRole("button", { name: /Bewertung abgeben/ }).click();
  await expect(page.getByText("Deine Bewertung")).toBeVisible();
  await expect(page.getByText("Alles reibungslos gelaufen.")).toBeVisible();
});
