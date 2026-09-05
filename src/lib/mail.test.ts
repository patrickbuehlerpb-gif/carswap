import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { siteUrl, siteUrlConfigured } from "@/lib/mail";

/**
 * Die Basisadresse steckt in Mail-Links, in den Rücksprungadressen von Stripe
 * und seit der Linkvorschau auch in metadataBase. Ein ungültiger Wert dort
 * würde beim Rendern werfen — also jede Seite umwerfen, wegen eines
 * Tippfehlers in einer Umgebungsvariablen.
 */
const gemerkt: Record<string, string | undefined> = {};
const SCHLUESSEL = ["SITE_URL", "NEXT_PUBLIC_SITE_URL", "VERCEL_PROJECT_PRODUCTION_URL"];

beforeEach(() => {
  for (const k of SCHLUESSEL) {
    gemerkt[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of SCHLUESSEL) {
    if (gemerkt[k] === undefined) delete process.env[k];
    else process.env[k] = gemerkt[k];
  }
});

describe("Basisadresse", () => {
  it("nimmt eine vollständige Adresse und schneidet den Schrägstrich ab", () => {
    process.env.SITE_URL = "https://quitt.ch/";
    expect(siteUrl()).toBe("https://quitt.ch");
    expect(siteUrlConfigured()).toBe(true);
  });

  it("weist eine Adresse ohne Schema zurück, statt sie durchzureichen", () => {
    process.env.SITE_URL = "quitt.ch";
    expect(siteUrl()).toBe("http://localhost:3000");
    expect(siteUrlConfigured()).toBe(false);
    // Und das Ergebnis lässt sich immer parsen — darauf verlässt sich
    // metadataBase.
    expect(() => new URL(siteUrl())).not.toThrow();
  });

  it("weist ein fremdes Schema zurück", () => {
    process.env.SITE_URL = "ftp://quitt.ch";
    expect(siteUrl()).toBe("http://localhost:3000");
    expect(siteUrlConfigured()).toBe(false);
  });

  it("nimmt ersatzweise die Adresse von Vercel", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "quitt.vercel.app";
    expect(siteUrl()).toBe("https://quitt.vercel.app");
    expect(siteUrlConfigured()).toBe(true);
  });

  it("greift auf Vercel zurück, wenn SITE_URL kaputt ist", () => {
    process.env.SITE_URL = "quitt.ch";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "quitt.vercel.app";
    expect(siteUrl()).toBe("https://quitt.vercel.app");
  });

  it("gibt ohne jede Angabe eine gültige Adresse zurück", () => {
    expect(siteUrl()).toBe("http://localhost:3000");
    expect(siteUrlConfigured()).toBe(false);
    expect(() => new URL(siteUrl())).not.toThrow();
  });
});
