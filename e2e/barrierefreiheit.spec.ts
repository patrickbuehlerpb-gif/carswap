import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { registriere } from "./hilfen";

/**
 * Automatische Prüfung auf Barrierefreiheit über die Hauptseiten.
 *
 * axe findet nicht alles — Tastaturbedienung, Fokusreihenfolge und
 * verständliche Beschriftungen bleiben Handarbeit. Was es findet, ist aber
 * durchweg echt: fehlende Beschriftungen, zu schwache Kontraste, falsche
 * Verschachtelung. Als Testlauf verankert, damit es nicht wieder wegrutscht.
 */

async function pruefe(page: Page, pfad: string) {
  await page.goto(pfad);
  const ergebnis = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const befunde = ergebnis.violations.map((v) => ({
    regel: v.id,
    wirkung: v.impact,
    stellen: v.nodes.map((n) => n.target.join(" ")).slice(0, 3),
    hilfe: v.help,
  }));
  expect(befunde, `${pfad}: ${JSON.stringify(befunde, null, 2)}`).toEqual([]);
}

test("öffentliche Seiten sind zugänglich", async ({ page }) => {
  for (const pfad of ["/", "/markt", "/wert", "/so-funktionierts", "/agb", "/datenschutz", "/impressum"]) {
    await pruefe(page, pfad);
  }
});

test("Anmeldung und Registrierung sind zugänglich", async ({ page }) => {
  for (const pfad of ["/konto/anmelden", "/konto/registrieren", "/konto/passwort-vergessen"]) {
    await pruefe(page, pfad);
  }
});

test("die angemeldeten Seiten sind zugänglich", async ({ page }) => {
  await registriere(page, { name: "Prüferin", ort: "Basel", kanton: "BS" });
  for (const pfad of ["/garage", "/konto", "/matches", "/deals", "/markt", "/inserat/neu"]) {
    await pruefe(page, pfad);
  }
});

/**
 * Seitwärts laufender Inhalt ist auf dem Telefon kein Schönheitsfehler: die
 * Seite ruckelt beim Wischen, und was rechts hinausragt — oft gerade der Knopf
 * mit der wichtigsten Handlung — ist nicht mehr zu erreichen. Der Kopfbereich
 * ist dafür der empfindlichste Ort, weil dort Name, Navigation und Knöpfe in
 * einer Zeile stehen; ein längerer Name kann ihn schon sprengen.
 */
async function ohneQuerlauf(page: Page, pfad: string) {
  await page.goto(pfad);
  const mass = await page.evaluate(() => ({
    inhalt: document.documentElement.scrollWidth,
    fenster: document.documentElement.clientWidth,
  }));
  expect(
    mass.inhalt,
    `${pfad}: Inhalt ${mass.inhalt} px breit, Fenster ${mass.fenster} px`,
  ).toBeLessThanOrEqual(mass.fenster);
}

test("die Seite lässt sich auch auf dem Telefon bedienen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  // Erst abgemeldet: da stehen «Konto erstellen» und «Anmelden» im Kopf.
  for (const pfad of ["/", "/markt", "/konto/anmelden"]) {
    await ohneQuerlauf(page, pfad);
  }

  await registriere(page, { name: "Prüferin", ort: "Basel", kanton: "BS" });
  for (const pfad of ["/", "/markt", "/garage", "/konto"]) {
    await pruefe(page, pfad);
    await ohneQuerlauf(page, pfad);
  }
});

/**
 * Was axe nicht sieht: ob die eigengebauten Bedienelemente mit der Tastatur
 * funktionieren. Ein Menü, das sich nur mit der Maus öffnen lässt, besteht
 * jede automatische Prüfung und ist trotzdem unbenutzbar.
 */
test("die eigenen Bedienelemente lassen sich mit der Tastatur bedienen", async ({ page }) => {
  await registriere(page, { name: "Prüferin", ort: "Basel", kanton: "BS" });

  // --- Der Sprunglink ist der erste Halt und führt zum Inhalt ---
  await page.goto("/markt");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Zum Inhalt springen" })).toBeFocused();

  // --- Das Benutzermenü öffnet mit Enter und schliesst mit Escape ---
  const menuKnopf = page.locator('button[aria-haspopup="menu"]').first();
  await menuKnopf.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(menuKnopf).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  // --- Der Schalter für die Treffermeldungen kippt mit der Leertaste ---
  await page.goto("/konto");
  const schalter = page.getByRole("switch", { name: /jemand dein Auto sucht/i });
  await expect(schalter).toHaveAttribute("aria-checked", "true");
  await schalter.focus();
  await page.keyboard.press(" ");
  await expect(schalter).toHaveAttribute("aria-checked", "false");
  // Nach dem Umlegen muss der Fokus auf dem Schalter bleiben. Springt er weg,
  // steht man mit der Tastatur plötzlich am Seitenanfang.
  await expect(schalter).toBeFocused();
  await expect(schalter).toHaveAttribute("aria-busy", "false");
  await page.keyboard.press(" ");
  await expect(schalter).toHaveAttribute("aria-checked", "true");
  await expect(schalter).toBeFocused();

  // Und die Entscheidung überlebt das Neuladen — sie steht in der Datenbank,
  // nicht nur im Browser.
  await page.reload();
  await expect(page.getByRole("switch", { name: /jemand dein Auto sucht/i })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // --- Passwort ändern lässt sich aufklappen, ohne die Maus anzufassen ---
  await page.getByRole("button", { name: "Ändern", exact: true }).last().focus();
  await page.keyboard.press("Enter");
  // Der Knopf heisst jetzt «Abbrechen» — deshalb wird er neu gesucht.
  await expect(page.getByRole("button", { name: "Abbrechen", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.locator('input[name="current"]')).toBeVisible();
  // Und der Fokus liegt weiterhin auf dem Knopf, nicht irgendwo.
  await expect(page.getByRole("button", { name: "Abbrechen", exact: true })).toBeFocused();
});
