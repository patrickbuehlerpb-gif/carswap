import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { listings, matchNotices, users, vehicles } from "@/lib/db/schema";
import { createUser, createVehicle, resetDatabase } from "@/test/fixtures";

const briefe: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/mail", () => ({
  sendMail: async (mail: { to: string; subject: string; text: string }) => {
    briefe.push(mail);
    return { delivered: true };
  },
  siteUrl: () => "https://autotauschen.test",
  siteUrlConfigured: () => true,
}));

const { verschickeTreffermeldungen } = await import("@/lib/treffer");

beforeEach(async () => {
  await resetDatabase();
  briefe.length = 0;
});

/**
 * Ein Konto mit bestätigter Adresse und einem aktiven Inserat, das eine
 * Polestar sucht — also genau das, was alle anderen hier anbieten.
 */
async function inserent(name: string, adresse: string): Promise<string> {
  const id = await createUser(name, { email: adresse });
  await createVehicle(id);
  await db.update(listings).set({ wishMakes: ["Polestar"] }).where(eq(listings.ownerId, id));
  return id;
}

function anWen(): string[] {
  return briefe.map((b) => b.to).sort();
}

describe("Treffermeldungen", () => {
  it("meldet beiden Seiten einen beidseitigen Treffer", async () => {
    await inserent("Anna", "anna@test.test");
    await inserent("Bruno", "bruno@test.test");

    const lauf = await verschickeTreffermeldungen();

    expect(lauf).toEqual({ benachrichtigt: 2, gemeldet: 2, fehler: 0 });
    expect(anWen()).toEqual(["anna@test.test", "bruno@test.test"]);
    // Der Text nennt das fremde Auto und führt auf die Seite dazu.
    expect(briefe[0].text).toMatch(/Polestar/);
    expect(briefe[0].text).toMatch(/https:\/\/autotauschen\.test\/auto\//);
  });

  it("meldet denselben Treffer kein zweites Mal", async () => {
    await inserent("Anna", "anna@test.test");
    await inserent("Bruno", "bruno@test.test");

    await verschickeTreffermeldungen();
    briefe.length = 0;

    const zweiter = await verschickeTreffermeldungen();
    expect(zweiter).toEqual({ benachrichtigt: 0, gemeldet: 0, fehler: 0 });
    expect(briefe).toEqual([]);
  });

  it("schreibt nicht an unbestätigte Adressen", async () => {
    const anna = await inserent("Anna", "anna@test.test");
    await inserent("Bruno", "bruno@test.test");
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, anna));

    await verschickeTreffermeldungen();
    expect(anWen()).toEqual(["bruno@test.test"]);
  });

  it("hält sich an den abgeschalteten Schalter", async () => {
    const anna = await inserent("Anna", "anna@test.test");
    await inserent("Bruno", "bruno@test.test");
    await db.update(users).set({ notifyMatches: false }).where(eq(users.id, anna));

    await verschickeTreffermeldungen();
    expect(anWen()).toEqual(["bruno@test.test"]);

    // Und der stillgelegte Treffer darf später nicht nachgereicht werden,
    // sobald der Schalter wieder umgelegt ist — er ist ja nie gemeldet worden.
    expect(
      await db.select().from(matchNotices).where(eq(matchNotices.userId, anna)),
    ).toEqual([]);
  });

  it("schreibt keinem stillgelegten Konto", async () => {
    const anna = await inserent("Anna", "anna@test.test");
    await inserent("Bruno", "bruno@test.test");
    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, anna));

    await verschickeTreffermeldungen();
    expect(anWen()).toEqual(["bruno@test.test"]);
  });

  it("meldet nur, wenn die Gegenseite wirklich so ein Auto sucht", async () => {
    const anna = await inserent("Anna", "anna@test.test");
    await inserent("Bruno", "bruno@test.test");

    // Annas Inserat sucht ausdrücklich etwas anderes: für Bruno ist das
    // Annas Auto keine beidseitige Passung mehr.
    await db
      .update(listings)
      .set({ wishMakes: ["Fiat"] })
      .where(eq(listings.ownerId, anna));

    await verschickeTreffermeldungen();
    expect(anWen()).toEqual(["anna@test.test"]);
  });

  it("meldet nicht das eigene Inserat", async () => {
    const anna = await inserent("Anna", "anna@test.test");
    await createVehicle(anna);

    const lauf = await verschickeTreffermeldungen();
    expect(lauf.benachrichtigt).toBe(0);
    expect(briefe).toEqual([]);
  });

  it("nennt höchstens drei Treffer je Mail und holt den Rest später nach", async () => {
    await inserent("Anna", "anna@test.test");
    for (const name of ["Bruno", "Carla", "Dario", "Elin"]) {
      await inserent(name, `${name.toLowerCase()}@test.test`);
    }

    await verschickeTreffermeldungen();
    const annaMail = briefe.find((b) => b.to === "anna@test.test");
    expect(annaMail!.text.match(/^• /gm)).toHaveLength(3);

    briefe.length = 0;
    await verschickeTreffermeldungen();
    const nachschlag = briefe.find((b) => b.to === "anna@test.test");
    expect(nachschlag!.text.match(/^• /gm)).toHaveLength(1);
  });

  it("lässt pausierte Inserate aus", async () => {
    const anna = await inserent("Anna", "anna@test.test");
    await inserent("Bruno", "bruno@test.test");
    await db.update(listings).set({ status: "pausiert" }).where(eq(listings.ownerId, anna));

    await verschickeTreffermeldungen();
    // Anna ist mit ihrem pausierten Inserat gar nicht mehr im Bestand, und
    // Bruno hat nichts mehr, was zu ihm passt.
    expect(briefe).toEqual([]);
  });

  it("lässt archivierte Fahrzeuge aus", async () => {
    const anna = await inserent("Anna", "anna@test.test");
    await inserent("Bruno", "bruno@test.test");
    await db.update(vehicles).set({ archivedAt: new Date() }).where(eq(vehicles.ownerId, anna));

    await verschickeTreffermeldungen();
    // Annas Auto ist weg, also bekommt sie nichts. Brunos Treffer auf das
    // noch aktive Inserat bleibt bestehen.
    expect(anWen()).toEqual(["bruno@test.test"]);
  });

  it("meldet nichts, wenn die Gegenseite gar nichts gesucht hat", async () => {
    const anna = await inserent("Anna", "anna@test.test");
    await inserent("Bruno", "bruno@test.test");
    // Bruno hat kein Wunschfeld ausgefüllt. Formal passt Annas Auto dann auf
    // alles — aber «Bruno sucht dein Auto» wäre gelogen.
    await db
      .update(listings)
      .set({ wishMakes: [] })
      .where(eq(listings.ownerId, anna));

    await verschickeTreffermeldungen();
    expect(anWen()).toEqual(["anna@test.test"]);
  });

  it("zählt einen blossen Höchstbetrag nicht als Wunsch", async () => {
    const anna = await inserent("Anna", "anna@test.test");
    await inserent("Bruno", "bruno@test.test");
    await db
      .update(listings)
      .set({ wishMakes: [], wishMaxCashOut: 20_000 })
      .where(eq(listings.ownerId, anna));

    await verschickeTreffermeldungen();
    expect(anWen()).toEqual(["anna@test.test"]);
  });

  it("kommt mit einem leeren Markt zurecht", async () => {
    expect(await verschickeTreffermeldungen()).toEqual({
      benachrichtigt: 0,
      gemeldet: 0,
      fehler: 0,
    });
  });
});
