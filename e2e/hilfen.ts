import type { Page } from "@playwright/test";
import { sql as raw } from "drizzle-orm";
import { connect } from "../scripts/db-connect";

/**
 * Gemeinsame Handgriffe der Browserläufe.
 *
 * Vor allem das Registrieren: es stand in sechs Dateien fast gleich da, und
 * jede neue Datei brachte den Lauf näher an die Registrierungssperre. Die
 * zählt pro IP — im Testlauf kommt alles von derselben, was keine echte
 * Nutzerschaft je tut. Der Zähler wird deshalb hier zurückgesetzt, und zwar
 * nur der für Registrierungen: dass die Sperre selbst funktioniert, prüfen
 * die Tests in src/app/actions/auth (dort gegen die Datenbank, nicht gegen
 * den Browser).
 */

export const PASSWORT = "ein sehr langes Testpasswort";

export function eindeutig(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function loescheRegistrierungssperre(): Promise<void> {
  const { db, sql } = connect();
  await db.execute(raw`delete from rate_limits where key like 'signup:%'`);
  await sql.end();
}

export interface KontoOptionen {
  name?: string;
  ort?: string;
  kanton?: string;
}

/** Legt ein Konto über die Oberfläche an und gibt die Adresse zurück. */
export async function registriere(page: Page, opts: KontoOptionen = {}): Promise<string> {
  await loescheRegistrierungssperre();
  const email = `${eindeutig("e2e")}@example.invalid`;
  await page.goto("/konto/registrieren");
  await page.fill('input[name="name"]', opts.name ?? "Testperson");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORT);
  if (opts.ort !== undefined) await page.fill('input[name="location"]', opts.ort);
  if (opts.kanton !== undefined) await page.fill('input[name="canton"]', opts.kanton);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/garage**");
  return email;
}

/** Meldet sich ab — der Knopf steckt im Benutzermenü der Kopfzeile. */
export async function abmelden(page: Page): Promise<void> {
  await page.goto("/garage");
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.getByRole("button", { name: /Abmelden/i }).click();
  await page.waitForURL(/\/(\?.*)?$/);
}

/**
 * Schickt das Anmeldeformular ab, ohne auf das Ergebnis zu warten. Für Fälle,
 * in denen die Anmeldung scheitern soll.
 */
export async function anmeldeVersuch(
  page: Page,
  email: string,
  passwort = PASSWORT,
): Promise<void> {
  await page.goto("/konto/anmelden");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', passwort);
  await page.click('button[type="submit"]');
}

/**
 * Meldet sich an und wartet, bis die Anmeldeseite verlassen ist.
 *
 * Das Warten gehört hierher: ohne es läuft der nächste Schritt gegen die noch
 * offene Anmeldeseite, und der Fehler zeigt sich erst viel später an einer
 * ganz anderen Stelle.
 */
export async function anmelden(page: Page, email: string, passwort = PASSWORT): Promise<void> {
  await anmeldeVersuch(page, email, passwort);
  await page.waitForURL((url) => !url.pathname.startsWith("/konto/anmelden"));
}

/**
 * Entfernt Konten samt allem, was daran hängt (Fahrzeuge, Inserate,
 * Nachrichten — alles über `on delete cascade`).
 *
 * Nötig, weil alle Spec-Dateien sich eine Datenbank teilen, die nur einmal
 * vor dem ganzen Lauf geleert wird. Ein hier angelegtes Inserat steht sonst
 * im Marktplatz der anderen Durchläufe und lässt deren Zählungen scheitern —
 * das ist zweimal passiert, beide Male mit einem Fehlerbild, das nach einem
 * echten Fehler in der Anwendung aussah.
 */
export async function raeumeKontenAuf(kennungen: {
  ids?: string[];
  adressen?: string[];
}): Promise<void> {
  const { ids = [], adressen = [] } = kennungen;
  if (!ids.length && !adressen.length) return;
  const { db, sql } = connect();
  for (const id of ids) await db.execute(raw`delete from users where id = ${id}`);
  for (const email of adressen) await db.execute(raw`delete from users where email = ${email}`);
  await sql.end();
}
