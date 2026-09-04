import { expect, test, type Page } from "@playwright/test";
import { eq, sql as raw } from "drizzle-orm";
import { connect } from "../scripts/db-connect";

/**
 * Der Ringtausch im echten Browser: drei Konten, drei Inserate, ein Vorschlag,
 * drei Zusagen, drei Übergaben und die Bewertungen danach.
 *
 * Damit der Weg ohne Stripe durchläuft, wird der Ausgleich nach den Zusagen
 * direkt in der Testdatenbank auf null gesetzt. Drei Fahrzeuge auf denselben
 * Rappen zu konstruieren geht nicht: die Bewertung streut bewusst je Fahrzeug.
 * Der Geldpfad selbst hat eigene Tests gegen ein Stripe-Doppel.
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
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.getByRole("button", { name: /Abmelden/i }).click();
  await page.waitForURL(/\/(\?.*)?$/);
}

/** Setzt alle Ausgleiche des einzigen Rings in der Testdatenbank auf null. */
async function ausgleichNullen() {
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/carswap_test";
  const { db, sql, schema } = connect();
  try {
    await db.update(schema.ringLegs).set({ cash: 0 });
  } finally {
    await sql.end();
  }
}

/** Hakt die Übergabe-Checkliste ab und bestätigt. */
async function uebergabeBestaetigen(page: Page) {
  // Die Karte erscheint erst, nachdem der Server den Zustandswechsel bestätigt
  // hat — ohne dieses Warten wären die Kästchen noch nicht da.
  await expect(page.getByRole("heading", { name: "Übergabe" })).toBeVisible();
  const haken = page.locator('input[type="checkbox"]');
  await expect(haken.first()).toBeVisible();
  const anzahl = await haken.count();
  for (let i = 0; i < anzahl; i++) await haken.nth(i).check();
  await page.getByRole("button", { name: "Übergabe bestätigen" }).click();
}

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
  await page.getByRole("button", { name: wunschMarke, exact: true }).first().click();

  await page.getByRole("button", { name: /Inserat veröffentlichen/i }).click();
  await page.waitForURL("**/fahrzeug/**");
}

test("drei Konten wickeln einen Ring ab und bewerten sich", async ({ page }) => {
  // Anna gibt einen Polestar, Bruno sucht genau den. Bruno gibt einen BMW,
  // Clara sucht einen BMW. Claras Audi geht zurück an Anna — der klassische
  // Fall, in dem sich zwei Wünsche nur über eine dritte Partei auflösen.
  const anna = await registrieren(page, "Anna Ring");
  await inserieren(page, "Polestar", "4", 68000, "BMW");
  await abmelden(page);

  const bruno = await registrieren(page, "Bruno Ring");
  await inserieren(page, "BMW", "i4", 72000, "Polestar");
  await abmelden(page);

  const clara = await registrieren(page, "Clara Ring");
  await inserieren(page, "Audi", "Q4 e-tron", 60000, "BMW");
  await abmelden(page);

  // --- Anna schlägt den Ring vor ---
  await anmelden(page, anna);
  await page.goto("/matches");
  await page.getByRole("button", { name: /^Ringtausch/ }).click();
  await expect(page.getByRole("heading", { name: "Dreiertausch" })).toBeVisible();

  await page.getByRole("button", { name: "Ring vorschlagen" }).first().click();
  await page.waitForURL("**/ringe/**");
  const ringUrl = page.url();

  await expect(page.getByText("Vorschlag offen").first()).toBeVisible();
  await expect(page.getByText("Bruno Ring").first()).toBeVisible();
  await expect(page.getByText("Clara Ring").first()).toBeVisible();
  // Wer vorschlägt, hat zugesagt — die anderen beiden noch nicht.
  await expect(page.getByText(/Es fehlen noch 2 Zusagen/)).toBeVisible();
  await abmelden(page);

  // --- Bruno sagt zu ---
  await anmelden(page, bruno);
  await page.goto("/deals");
  await expect(page.getByText("Ringtausche").first()).toBeVisible();
  await page.getByRole("link", { name: /Ringtausch:/ }).first().click();
  await page.waitForURL("**/ringe/**");
  await page.getByRole("button", { name: "Zusagen" }).click();
  await expect(page.getByText(/Es fehlen noch 1 Zusage/)).toBeVisible();
  await abmelden(page);

  // --- Clara sagt zu, damit wird der Ring verbindlich ---
  await anmelden(page, clara);
  await page.goto(ringUrl);
  await page.getByRole("button", { name: "Zusagen" }).click();
  // Mit der dritten Zusage ist der Ring verbindlich: die Zusage-Schaltfläche
  // verschwindet, dafür lässt er sich nur noch abbrechen.
  await expect(page.getByRole("button", { name: "Ring abbrechen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zusagen" })).toHaveCount(0);

  // Die drei Fahrzeuge sind jetzt gebunden und stehen nicht mehr im Markt.
  await page.goto("/markt");
  await expect(page.getByText("Polestar 4")).toHaveCount(0);

  // --- Ab hier ohne Ausgleich, damit der Weg ohne Stripe durchläuft ---
  await ausgleichNullen();

  await page.goto(ringUrl);
  await page.getByRole("button", { name: "Weiter zur Übergabe" }).click();
  await uebergabeBestaetigen(page);
  await expect(page.getByText(/Du hast bestätigt/)).toBeVisible();
  await abmelden(page);

  await anmelden(page, anna);
  await page.goto(ringUrl);
  await uebergabeBestaetigen(page);
  await abmelden(page);

  // --- Bruno bestätigt als Letzter: Geld, Halterwechsel, Abschluss ---
  await anmelden(page, bruno);
  await page.goto(ringUrl);
  await uebergabeBestaetigen(page);
  await expect(page.getByText("Der Ring ist abgeschlossen.")).toBeVisible();

  // Bruno hat jetzt Annas Polestar in der Garage.
  await page.goto("/garage");
  await expect(page.getByText("Polestar 4").first()).toBeVisible();

  // --- Und bewertet beide anderen einzeln ---
  await page.goto(ringUrl);
  const bewertungen = page.getByRole("button", { name: "Bewertung abgeben" });
  await expect(bewertungen).toHaveCount(2);
  await bewertungen.first().click();
  await expect(page.getByText(/Deine Bewertung für/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Bewertung abgeben" })).toHaveCount(1);
});
