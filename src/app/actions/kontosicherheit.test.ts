import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { authTokens, sessions, users } from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";
import { verifyPassword } from "@/lib/auth/password";
import { als, createUser, resetDatabase } from "@/test/fixtures";

/** Die verschickten Nachrichten mitschreiben — an wen der Link geht, ist hier der Kern. */
const briefe: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/mail", () => ({
  sendMail: async (mail: { to: string; subject: string; text: string }) => {
    briefe.push(mail);
    return { delivered: true };
  },
  siteUrl: () => "https://quitt.test",
  siteUrlConfigured: () => true,
}));

const {
  cancelEmailChangeAction,
  changePasswordAction,
  confirmEmailChange,
  requestEmailChangeAction,
} = await import("@/app/actions/account");

const PW = "richtig-langes-Passwort";

function form(felder: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(felder)) fd.set(k, v);
  return fd;
}

/** Holt den Token aus dem zuletzt an diese Adresse verschickten Link. */
function tokenAus(adresse: string): string {
  const brief = [...briefe].reverse().find((b) => b.to === adresse);
  const treffer = /token=([\w-]+)/.exec(brief?.text ?? "");
  if (!treffer) throw new Error(`Kein Token in der Mail an ${adresse}: ${brief?.text}`);
  return treffer[1];
}

beforeEach(async () => {
  await resetDatabase();
  als(null);
  briefe.length = 0;
});

/** Eine zweite, offene Sitzung — sie muss der Passwortwechsel beseitigen. */
async function zweitesGeraet(userId: string): Promise<void> {
  await db.insert(sessions).values({
    id: newId("ses"),
    userId,
    tokenHash: newId("tok"),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
}

describe("Passwort ändern", () => {
  it("verlangt das aktuelle Passwort", async () => {
    const anna = await createUser("Anna", { password: PW });
    als(anna);

    const res = await changePasswordAction(
      {},
      form({ current: "falsch", password: "neues-langes-Passwort", repeat: "neues-langes-Passwort" }),
    );
    expect(res.error).toMatch(/aktuelle Passwort stimmt nicht/i);

    const [row] = await db.select().from(users).where(eq(users.id, anna));
    expect(await verifyPassword(PW, row.passwordHash)).toBe(true);
  });

  it("setzt das neue Passwort und meldet die anderen Geräte ab", async () => {
    const anna = await createUser("Anna", { password: PW });
    await zweitesGeraet(anna);
    als(anna);

    const res = await changePasswordAction(
      {},
      form({ current: PW, password: "neues-langes-Passwort", repeat: "neues-langes-Passwort" }),
    );
    expect(res.error).toBeUndefined();

    const [row] = await db.select().from(users).where(eq(users.id, anna));
    expect(await verifyPassword("neues-langes-Passwort", row.passwordHash)).toBe(true);
    expect(await verifyPassword(PW, row.passwordHash)).toBe(false);
    expect(await db.select().from(sessions).where(eq(sessions.userId, anna))).toEqual([]);
    expect(briefe.map((b) => b.subject)).toContain("quitt: Passwort geändert");
  });

  it("lehnt ein zu kurzes Passwort ab", async () => {
    const anna = await createUser("Anna", { password: PW });
    als(anna);
    const res = await changePasswordAction({}, form({ current: PW, password: "kurz", repeat: "kurz" }));
    expect(res.error).toMatch(/mindestens 10 Zeichen/i);
  });

  it("lehnt zwei verschiedene Wiederholungen ab", async () => {
    const anna = await createUser("Anna", { password: PW });
    await zweitesGeraet(anna);
    als(anna);
    const res = await changePasswordAction(
      {},
      form({ current: PW, password: "neues-langes-Passwort", repeat: "anderes-langes-Passwort" }),
    );
    expect(res.error).toMatch(/stimmen nicht überein/i);
    expect(await db.select().from(sessions).where(eq(sessions.userId, anna))).toHaveLength(1);
  });
});

describe("E-Mail-Adresse wechseln", () => {
  it("verlangt das Passwort und ändert vorher nichts", async () => {
    const anna = await createUser("Anna", { password: PW, email: "anna@alt.test" });
    als(anna);

    const res = await requestEmailChangeAction(
      {},
      form({ email: "anna@neu.test", current: "falsch" }),
    );
    expect(res.error).toMatch(/Passwort stimmt nicht/i);

    const [row] = await db.select().from(users).where(eq(users.id, anna));
    expect(row.email).toBe("anna@alt.test");
    expect(row.pendingEmail).toBeNull();
    expect(briefe).toEqual([]);
  });

  it("schickt den Link an die NEUE Adresse und warnt die alte", async () => {
    const anna = await createUser("Anna", { password: PW, email: "anna@alt.test" });
    als(anna);

    await requestEmailChangeAction({}, form({ email: "Anna@Neu.test", current: PW }));

    const [row] = await db.select().from(users).where(eq(users.id, anna));
    // Bis zur Bestätigung bleibt die alte Adresse in Kraft.
    expect(row.email).toBe("anna@alt.test");
    expect(row.pendingEmail).toBe("anna@neu.test");

    const empfaenger = briefe.map((b) => b.to);
    expect(empfaenger).toContain("anna@neu.test");
    expect(empfaenger).toContain("anna@alt.test");
    // Der Link darf nur in der Mail an die neue Adresse stehen.
    expect(briefe.find((b) => b.to === "anna@alt.test")!.text).not.toMatch(/token=/);
  });

  it("hängt das Konto erst beim Klick auf den Link um", async () => {
    const anna = await createUser("Anna", { password: PW, email: "anna@alt.test" });
    als(anna);
    await requestEmailChangeAction({}, form({ email: "anna@neu.test", current: PW }));

    const ergebnis = await confirmEmailChange(tokenAus("anna@neu.test"));
    expect(ergebnis).toEqual({ ok: true, email: "anna@neu.test" });

    const [row] = await db.select().from(users).where(eq(users.id, anna));
    expect(row.email).toBe("anna@neu.test");
    expect(row.pendingEmail).toBeNull();
    // Der Klick beweist die Adresse — ein zweiter Bestätigungslauf entfällt.
    expect(row.emailVerifiedAt).not.toBeNull();
  });

  it("lässt denselben Link kein zweites Mal gelten", async () => {
    const anna = await createUser("Anna", { password: PW, email: "anna@alt.test" });
    als(anna);
    await requestEmailChangeAction({}, form({ email: "anna@neu.test", current: PW }));
    const token = tokenAus("anna@neu.test");

    expect((await confirmEmailChange(token)).ok).toBe(true);
    expect(await confirmEmailChange(token)).toEqual({ ok: false, grund: "ungueltig" });
  });

  it("weist eine bereits vergebene Adresse ab", async () => {
    await createUser("Bruno", { email: "bruno@test.test" });
    const anna = await createUser("Anna", { password: PW, email: "anna@alt.test" });
    als(anna);

    const res = await requestEmailChangeAction(
      {},
      form({ email: "bruno@test.test", current: PW }),
    );
    expect(res.error).toMatch(/gehört bereits zu einem Konto/i);
    expect(briefe).toEqual([]);
  });

  it("hängt nicht um, wenn die Adresse zwischenzeitlich vergeben wurde", async () => {
    const anna = await createUser("Anna", { password: PW, email: "anna@alt.test" });
    als(anna);
    await requestEmailChangeAction({}, form({ email: "anna@neu.test", current: PW }));
    const token = tokenAus("anna@neu.test");

    // Jemand anders meldet sich in der Zwischenzeit mit genau dieser Adresse an.
    await createUser("Fremd", { email: "anna@neu.test" });

    expect(await confirmEmailChange(token)).toEqual({ ok: false, grund: "belegt" });
    const [row] = await db.select().from(users).where(eq(users.id, anna));
    expect(row.email).toBe("anna@alt.test");
    expect(row.pendingEmail).toBeNull();
  });

  it("macht den offenen Link beim Abbrechen wertlos", async () => {
    const anna = await createUser("Anna", { password: PW, email: "anna@alt.test" });
    als(anna);
    await requestEmailChangeAction({}, form({ email: "anna@neu.test", current: PW }));
    const token = tokenAus("anna@neu.test");

    await cancelEmailChangeAction();

    const offen = await db
      .select()
      .from(authTokens)
      .where(and(eq(authTokens.userId, anna), isNull(authTokens.usedAt)));
    expect(offen).toEqual([]);
    expect(await confirmEmailChange(token)).toEqual({ ok: false, grund: "ungueltig" });
    const [row] = await db.select().from(users).where(eq(users.id, anna));
    expect(row.email).toBe("anna@alt.test");
    expect(row.pendingEmail).toBeNull();
  });

  it("lässt einen Token ohne offene Anfrage nicht gelten", async () => {
    const anna = await createUser("Anna", { password: PW, email: "anna@alt.test" });
    als(anna);
    await requestEmailChangeAction({}, form({ email: "anna@neu.test", current: PW }));
    const token = tokenAus("anna@neu.test");

    // Die Anfrage wird direkt in der Datenbank zurückgenommen — der Token
    // allein darf nichts bewirken.
    await db.update(users).set({ pendingEmail: null }).where(eq(users.id, anna));

    expect(await confirmEmailChange(token)).toEqual({ ok: false, grund: "ungueltig" });
  });

  it("verlangt eine Anmeldung", async () => {
    als(null);
    await expect(
      requestEmailChangeAction({}, form({ email: "wer@auch.test", current: PW })),
    ).rejects.toThrow(/Nicht angemeldet/);
  });
});
