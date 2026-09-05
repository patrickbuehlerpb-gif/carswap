import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql as raw } from "drizzle-orm";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { mailFailures } from "@/lib/db/schema";
import { resetDatabase } from "@/test/fixtures";
import { sendMail } from "@/lib/mail";
import { mailFehler, raeumeAuf } from "@/lib/wartung";

/**
 * Der Mailversand ist die stillste Stelle der Anwendung: Er scheitert, und
 * nach aussen sieht alles normal aus. Diese Prüfungen halten fest, dass ein
 * Fehlversuch überhaupt eine Spur hinterlässt — und dass die Spur wieder
 * verschwindet.
 */

const STUNDE = 60 * 60 * 1000;
const TAG = 24 * STUNDE;

let vorher: Record<string, string | undefined> = {};

beforeEach(async () => {
  await resetDatabase();
  // Die Testdateien teilen sich einen Prozess und damit process.env — was hier
  // gesetzt wird, muss hier auch wieder weg.
  vorher = { key: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM };
  process.env.RESEND_API_KEY = "re_test";
  process.env.MAIL_FROM = "autotauschen <noreply@autotauschen.test>";
});

afterEach(() => {
  // `process.env.X = undefined` schreibt die Zeichenkette "undefined" hinein.
  // Alle Testdateien teilen sich einen Prozess: danach hielte jede folgende
  // Datei den Mailversand für eingerichtet und schösse echte Anfragen an
  // Resend ab. Deshalb löschen statt zuweisen.
  for (const [name, wert] of [
    ["RESEND_API_KEY", vorher.key],
    ["MAIL_FROM", vorher.from],
  ] as const) {
    if (wert === undefined) delete process.env[name];
    else process.env[name] = wert;
  }
  vi.unstubAllGlobals();
});

function antwortet(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("nope", { status })),
  );
}

describe("gescheiterter Mailversand", () => {
  it("hinterlässt eine Spur, wenn der Dienst ablehnt", async () => {
    antwortet(422);
    const res = await sendMail({
      to: "Jemand@Example.COM",
      subject: "autotauschen: E-Mail-Adresse bestätigen",
      text: "…",
    });

    expect(res.delivered).toBe(false);
    const rows = await db.select().from(mailFailures);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("abgelehnt (422)");
    expect(rows[0].subject).toBe("autotauschen: E-Mail-Adresse bestätigen");
  });

  it("merkt sich die Domain, nicht die Adresse", async () => {
    antwortet(500);
    await sendMail({ to: "Jemand@Example.COM", subject: "Betreff", text: "…" });

    const rows = await db.select().from(mailFailures);
    // Für die Diagnose zählt «alles an example.com scheitert». Die ganze
    // Adresse wäre ein Personendatum in einem Fehlerprotokoll.
    expect(rows[0].domain).toBe("example.com");
    expect(JSON.stringify(rows[0])).not.toContain("Jemand");
  });

  it("unterscheidet unsere Einrichtung von einer abgewiesenen Adresse", async () => {
    // 422 heisst: diese Adresse geht nicht. 401 heisst: unser Schlüssel geht
    // nicht — das trifft jede Mail. Nur das Zweite darf die Betriebsprüfung
    // auf Rot stellen, sonst erzeugt sich jeder mit drei erfundenen Adressen
    // ein 503 der ganzen Anwendung.
    antwortet(422);
    await sendMail({ to: "a@b.ch", subject: "Betreff", text: "…" });
    expect((await db.select().from(mailFailures))[0].systemic).toBe(false);

    antwortet(401);
    await sendMail({ to: "a@b.ch", subject: "Betreff", text: "…" });
    const stand = await mailFehler(24);
    expect(stand.anzahl).toBe(2);
    expect(stand.letzteStunde).toBe(2);
    expect(stand.systemischLetzteStunde).toBe(1);
  });

  it("nimmt aus «Name <adresse@domain>» nur die Domain", async () => {
    antwortet(500);
    await sendMail({ to: "Betrieb <ops@Example.CH>", subject: "Betreff", text: "…" });
    await sendMail({ to: "kaputt", subject: "Betreff", text: "…" });

    const rows = await db.select().from(mailFailures).orderBy(mailFailures.createdAt);
    expect(rows.map((r) => r.domain).sort()).toEqual(["example.ch", "unbekannt"]);
    expect(JSON.stringify(rows)).not.toContain("ops");
  });

  it("hält auch einen nicht erreichbaren Dienst fest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await sendMail({ to: "a@b.ch", subject: "Betreff", text: "…" });

    const rows = await db.select().from(mailFailures);
    expect(rows[0].reason).toBe("nicht erreichbar");
  });

  it("vermerkt nichts, solange gar kein Versand eingerichtet ist", async () => {
    // Das ist kein Fehlversuch, sondern der lokale Normalzustand — sonst wäre
    // jede Mail in der Entwicklung ein Eintrag, und die Zahl sagte nichts mehr.
    delete process.env.RESEND_API_KEY;
    const res = await sendMail({ to: "a@b.ch", subject: "Betreff", text: "…" });

    expect(res.delivered).toBe(false);
    expect(await db.select().from(mailFailures)).toHaveLength(0);
  });

  it("wirft den Aufrufer nicht um, wenn das Vermerken selbst scheitert", async () => {
    antwortet(403);
    // Die Tabelle für die Dauer der Prüfung wegnehmen: der Vermerk scheitert
    // dann wirklich, statt dass ein Mock so tut. Die Registrierung darf nicht
    // daran scheitern, dass sich ein Fehler nicht aufschreiben lässt.
    await db.execute(raw`alter table mail_failures rename to mail_failures_weg`);
    try {
      await expect(sendMail({ to: "a@b.ch", subject: "Betreff", text: "…" })).resolves.toEqual({
        delivered: false,
        reason: "Mailversand fehlgeschlagen (403)",
      });
    } finally {
      await db.execute(raw`alter table mail_failures_weg rename to mail_failures`);
    }
  });
});

describe("Auswertung der Fehlversuche", () => {
  async function vermerke(vorMs: number, domain = "example.com") {
    await db.insert(mailFailures).values({
      id: newId("mfl"),
      createdAt: new Date(Date.now() - vorMs),
      domain,
      subject: "Betreff",
      reason: "abgelehnt (422)",
    });
  }

  it("zählt die letzten 24 Stunden und hebt die letzte Stunde hervor", async () => {
    await vermerke(10 * 60 * 1000);
    await vermerke(30 * 60 * 1000, "gmx.ch");
    await vermerke(5 * STUNDE);
    await vermerke(30 * STUNDE); // zu alt

    const stand = await mailFehler(24);
    expect(stand.anzahl).toBe(3);
    expect(stand.letzteStunde).toBe(2);
    expect(stand.domains.sort()).toEqual(["example.com", "gmx.ch"]);
  });

  it("meldet nichts, wenn nichts gescheitert ist", async () => {
    const stand = await mailFehler(24);
    expect(stand).toEqual({
      anzahl: 0,
      letzteStunde: 0,
      systemischLetzteStunde: 0,
      domains: [],
      letzterGrund: undefined,
    });
  });

  it("zählt in der Datenbank, nicht an geladenen Zeilen", async () => {
    // Der Deckel auf die geladenen Zeilen hätte ausgerechnet den Totalausfall
    // verharmlost, für den es diese Zahl gibt.
    for (let i = 0; i < 60; i++) await vermerke(i * 1000, `domain${i % 7}.ch`);

    const stand = await mailFehler(24);
    expect(stand.anzahl).toBe(60);
    expect(stand.letzteStunde).toBe(60);
    expect(stand.domains).toHaveLength(5);
  });

  it("räumt alte Vermerke ab, junge nicht", async () => {
    await vermerke(31 * TAG);
    await vermerke(2 * TAG);

    const ergebnis = await raeumeAuf();
    expect(ergebnis.mailfehler).toBe(1);
    expect(await db.select().from(mailFailures)).toHaveLength(1);
  });
});
