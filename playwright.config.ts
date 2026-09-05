import { defineConfig } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";

/**
 * Der Durchlauf startet einen eigenen Produktions-Server gegen die
 * Testdatenbank. Er läuft bewusst gegen `next start` und nicht gegen
 * `next dev`: die Middleware, die Sicherheitsrichtlinie und das
 * Serverkomponenten-Verhalten unterscheiden sich zwischen beiden.
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const DATENBANK =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/carswap_test";

/**
 * In dieser Umgebung liegt Chromium schon bereit; Playwright soll es nicht
 * noch einmal herunterladen. Findet sich nichts, greift der normale Weg über
 * die eigene Installation (etwa in der CI).
 */
function vorhandenesChromium(): string | undefined {
  const basis = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!basis || !existsSync(basis)) return undefined;
  const ordner = readdirSync(basis).find((d) => /^chromium-\d+$/.test(d));
  if (!ordner) return undefined;
  const pfad = `${basis}/${ordner}/chrome-linux/chrome`;
  return existsSync(pfad) ? pfad : undefined;
}

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions: { executablePath: vorhandenesChromium() },
    trace: "retain-on-failure",
  },
  webServer: {
    /*
     * `next start` liefert aus, was zuletzt gebaut wurde — nicht den Stand
     * der Dateien. Wer hier direkt `playwright test` aufruft, prüft deshalb
     * womöglich einen alten Build und bekommt ein falsches Grün. `npm run e2e`
     * baut vorher; `npm run e2e:schnell` überspringt das bewusst, wenn seit
     * dem letzten Bauen nichts am Code geändert wurde.
     */
    command: `npm run start -- --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/markt`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: DATENBANK,
      NODE_ENV: "production",
      // Ohne Mailversand greift die Pflicht zur bestätigten Adresse nicht —
      // genau der Zustand, in dem sich der Ablauf ohne Postfach durchspielen
      // lässt.
      SITE_URL: `http://127.0.0.1:${PORT}`,
    },
  },
});
