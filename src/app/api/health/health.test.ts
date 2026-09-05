import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { mailFailures } from "@/lib/db/schema";
import { resetDatabase } from "@/test/fixtures";
import { GET } from "./route";

/**
 * Die Betriebsprüfung entscheidet, ob ein Monitoring Alarm schlägt. Was sie
 * auf «fehler» stellt, muss deshalb ein Betriebsausfall sein — und darf nicht
 * von aussen auslösbar sein: Eine Anmeldung mit erfundener Adresse erzeugt
 * einen Fehlversuch beim Mailversand, und drei davon dürfen nicht die ganze
 * Anwendung als kaputt melden.
 */

async function fehlversuch(systemisch: boolean, vorMinuten = 1) {
  await db.insert(mailFailures).values({
    id: newId("mfl"),
    createdAt: new Date(Date.now() - vorMinuten * 60 * 1000),
    domain: "example.com",
    subject: "autotauschen: E-Mail-Adresse bestätigen",
    reason: systemisch ? "abgelehnt (401)" : "abgelehnt (422)",
    systemic: systemisch,
  });
}

async function pruefen() {
  const res = await GET(new Request("http://localhost/api/health"));
  return { status: res.status, body: (await res.json()) as { status: string; checks: Record<string, string> } };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("Betriebsprüfung", () => {
  it("meldet ok, solange nichts gescheitert ist", async () => {
    const { status, body } = await pruefen();
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.mailversand).not.toContain("Fehlversuch");
  });

  it("nennt jeden Fehlversuch, ohne gleich Alarm zu schlagen", async () => {
    for (let i = 0; i < 5; i++) await fehlversuch(false);

    const { status, body } = await pruefen();
    // Fünf abgewiesene Empfängeradressen sind kein Ausfall der Anwendung.
    expect(status).toBe(200);
    expect(body.checks.mailversand).toContain("5 Fehlversuch(e) in 24 h");
  });

  it("schlägt Alarm, wenn drei Mal unsere Einrichtung abgelehnt wurde", async () => {
    for (let i = 0; i < 3; i++) await fehlversuch(true);

    const { status, body } = await pruefen();
    expect(status).toBe(503);
    expect(body.status).toBe("fehler");
  });

  it("lässt zwei zurückliegende Ausfälle wieder abklingen", async () => {
    // Vor drei Stunden — gemeldet wird es weiter, Alarm ist es keiner mehr.
    for (let i = 0; i < 5; i++) await fehlversuch(true, 3 * 60);

    const { status, body } = await pruefen();
    expect(status).toBe(200);
    expect(body.checks.mailversand).toContain("5 Fehlversuch(e)");
  });
});
