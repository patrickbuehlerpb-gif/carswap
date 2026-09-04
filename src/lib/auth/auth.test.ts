import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rateLimits, users } from "@/lib/db/schema";
import { checkRateLimit, clearRateLimit, peekRateLimit } from "@/lib/auth/rate-limit";
import { sicheresZiel } from "@/lib/auth/safe-redirect";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { resetDatabase } from "@/test/fixtures";

beforeEach(async () => {
  await resetDatabase();
});

describe("Anmeldeziel", () => {
  it("lässt nur Pfade dieser Seite durch", () => {
    expect(sicheresZiel("/garage")).toBe("/garage");
    expect(sicheresZiel("/deals/dl_1?tab=chat")).toBe("/deals/dl_1?tab=chat");
  });

  it("wehrt den Backslash-Umweg auf eine fremde Domain ab", () => {
    // Browser behandeln bei http/https den Backslash wie einen Schrägstrich.
    expect(sicheresZiel("/\\evil.example")).toBe("/garage");
    expect(sicheresZiel("/\\\\evil.example")).toBe("/garage");
    expect(sicheresZiel("//evil.example")).toBe("/garage");
    expect(sicheresZiel("https://evil.example")).toBe("/garage");
    expect(sicheresZiel("javascript:alert(1)")).toBe("/garage");
    expect(sicheresZiel("")).toBe("/garage");
  });
});

describe("Ratenbegrenzung", () => {
  it("zählt beim Nachsehen nicht mit", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await peekRateLimit("test", 3, 60);
      expect(res.ok).toBe(true);
    }
    expect(await db.select().from(rateLimits)).toHaveLength(0);
  });

  it("zählt beim Vermerken und lässt sich zurücksetzen", async () => {
    for (let i = 0; i < 3; i++) expect((await checkRateLimit("test", 3, 60)).ok).toBe(true);
    expect((await checkRateLimit("test", 3, 60)).ok).toBe(false);
    expect((await peekRateLimit("test", 3, 60)).ok).toBe(false);

    await clearRateLimit("test");
    expect((await peekRateLimit("test", 3, 60)).ok).toBe(true);
  });

  it("verträgt beliebig lange Schlüssel", async () => {
    const lang = `login-mail:${"a".repeat(5000)}`;
    await expect(checkRateLimit(lang, 3, 60)).resolves.toMatchObject({ ok: true });
    const [row] = await db.select().from(rateLimits);
    expect(row.key.length).toBeLessThan(200);
  });
});

describe("Passwörter", () => {
  it("erkennt das richtige Passwort und weist andere ab", async () => {
    const hash = await hashPassword("ein sehr gutes Passwort");
    expect(await verifyPassword("ein sehr gutes Passwort", hash)).toBe(true);
    expect(await verifyPassword("ein sehr gutes passwort", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("liefert für kaputte Hashes false statt zu werfen", async () => {
    for (const kaputt of ["", "geloescht", "scrypt$x$y$z", "a$b$c$d$e$f"]) {
      await expect(verifyPassword("egal", kaputt)).resolves.toBe(false);
    }
  });

  it("erzeugt für dasselbe Passwort verschiedene Hashes", async () => {
    const a = await hashPassword("gleiches Passwort");
    const b = await hashPassword("gleiches Passwort");
    expect(a).not.toBe(b);
    expect(await verifyPassword("gleiches Passwort", b)).toBe(true);
  });

  it("passt ein gelöschtes Konto zu keinem Passwort", async () => {
    // deleteAccountAction setzt genau diesen Wert
    expect(await verifyPassword("irgendwas", "geloescht")).toBe(false);
    void users;
  });
});
