import { readFileSync } from "node:fs";
import { vi } from "vitest";

/**
 * Die Tests leeren zwischen den Fällen sämtliche Tabellen. Sie dürfen deshalb
 * niemals versehentlich auf der Entwicklungs- oder gar Produktionsdatenbank
 * landen. Gesucht wird zuerst TEST_DATABASE_URL; ersatzweise wird
 * DATABASE_URL nur akzeptiert, wenn der Datenbankname auf `_test` endet.
 */
function ladeEnvDatei(datei: string): void {
  try {
    for (const line of readFileSync(datei, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      process.env[match[1]] ??= value;
    }
  } catch {
    // Ohne Datei zählen nur die bereits gesetzten Variablen.
  }
}

ladeEnvDatei(".env.test.local");
ladeEnvDatei(".env.test");

const testUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!testUrl) {
  throw new Error(
    "Für die Tests wird TEST_DATABASE_URL gebraucht (oder DATABASE_URL auf eine Datenbank, " +
      "deren Name auf _test endet). Beispiel: postgres://…/carswap_test",
  );
}

const datenbankName = new URL(testUrl).pathname.replace(/^\//, "");
if (!/_test$/.test(datenbankName)) {
  throw new Error(
    `Die Tests leeren alle Tabellen und laufen deshalb nur gegen eine Datenbank, deren Name auf ` +
      `_test endet — "${datenbankName}" ist keine. Setze TEST_DATABASE_URL.`,
  );
}

// Ab hier arbeiten alle Module gegen die Testdatenbank, nie gegen .env.local.
process.env.DATABASE_URL = testUrl;
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL_UNPOOLED;

/** Wer gerade „angemeldet“ ist. Die Tests setzen das über `als(...)`. */
export const testSession: { userId: string | null } = { userId: null };

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: <T>(fn: T) => fn,
}));

// `after()` läuft in der echten Anwendung nach der Antwort; im Test genügt
// es, die Arbeit sofort zu erledigen.
vi.mock("next/server", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, after: (fn: () => unknown) => void fn() };
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  }),
}));

// Die Aktionen fragen über requireUser(), wer angemeldet ist. Im Test kommt
// die Antwort aus testSession statt aus einem Cookie.
vi.mock("@/lib/auth/session", async () => {
  const { db } = await import("@/lib/db");
  const { users } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  // Dieselbe Form wie die echte SessionUser — sonst prüfen die Tests gegen
  // ein Objekt, das es so nie gibt.
  async function getSessionUser() {
    if (!testSession.userId) return null;
    const rows = await db.select().from(users).where(eq(users.id, testSession.userId)).limit(1);
    const u = rows[0];
    if (!u) return null;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      location: u.location,
      canton: u.canton,
      avatarColor: u.avatarColor,
      emailVerified: u.emailVerifiedAt !== null,
      identityVerified: u.identityVerified,
      stripeAccountId: u.stripeAccountId,
      stripePayoutsEnabled: u.stripePayoutsEnabled,
      isAdmin: u.isAdmin,
    };
  }

  return {
    getSessionUser,
    async requireUser() {
      const user = await getSessionUser();
      if (!user) throw new Error("Nicht angemeldet.");
      return user;
    },
    createSession: async () => {},
    destroySession: async () => {},
    destroyAllSessions: async () => {},
    // Das gelegentliche Aufräumen ist zufallsgesteuert und hätte im Test
    // nichts zu suchen.
    occasionalCleanup: async () => {},
    pruneExpiredSessions: async () => 0,
  };
});
