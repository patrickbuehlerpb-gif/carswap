import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { deals, listings, payments, reports, ringSwaps, users } from "@/lib/db/schema";
import { betriebsbild, laufendeMitGeld, neuesteKonten, seitTagen } from "@/lib/betrieb";
import { createUser, createVehicle, resetDatabase } from "@/test/fixtures";

beforeEach(async () => {
  await resetDatabase();
});

async function tausch(
  a: string,
  b: string,
  status: (typeof deals.$inferSelect)["status"],
): Promise<string> {
  const id = newId("dl");
  await db.insert(deals).values({
    id,
    fromVehicleId: await createVehicle(a),
    toVehicleId: await createVehicle(b),
    initiatorId: a,
    counterpartyId: b,
    cashDelta: 0,
    status,
  });
  return id;
}

async function zahlung(
  dealId: string,
  payerId: string,
  payeeId: string,
  amountMinor: number,
  status: (typeof payments.$inferSelect)["status"],
  transfer: string | null = null,
): Promise<string> {
  const id = newId("pay");
  await db.insert(payments).values({
    id,
    dealId,
    payerId,
    payeeId,
    amountMinor,
    feeMinor: Math.round(amountMinor * 0.01),
    status,
    stripeTransferId: transfer,
  });
  return id;
}

describe("Betriebsbild", () => {
  it("zählt Konten ohne die gelöschten Hüllen", async () => {
    const a = await createUser("Anna");
    await createUser("Bruno");
    const weg = await createUser("Weg");
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, weg));
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, a));

    const bild = await betriebsbild();
    expect(bild.konten.gesamt).toBe(2);
    expect(bild.konten.bestaetigt).toBe(1);
    expect(bild.konten.neuDieseWoche).toBe(2);
  });

  it("zählt stillgelegte Konten getrennt", async () => {
    const a = await createUser("Anna");
    await createUser("Bruno");
    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, a));

    const bild = await betriebsbild();
    expect(bild.konten.gesamt).toBe(2);
    expect(bild.konten.stillgelegt).toBe(1);
  });

  it("zählt Inserate nach Zustand", async () => {
    const a = await createUser("Anna");
    const v1 = await createVehicle(a);
    await createVehicle(a);
    await db.update(listings).set({ status: "pausiert" }).where(eq(listings.vehicleId, v1));

    const bild = await betriebsbild();
    expect(bild.inserate).toMatchObject({ aktiv: 1, pausiert: 1, getauscht: 0, gesperrt: 0 });
  });

  it("füllt Zustände ohne Vorkommen mit null auf", async () => {
    const bild = await betriebsbild();
    expect(bild.tausche).toEqual({
      vorschlag: 0,
      verhandlung: 0,
      angenommen: 0,
      treuhand: 0,
      abwicklung: 0,
      abgeschlossen: 0,
      abgelehnt: 0,
      storniert: 0,
    });
    expect(Object.values(bild.ringe).every((n) => n === 0)).toBe(true);
  });

  it("zählt Tausche und Ringe nach Zustand", async () => {
    const a = await createUser("Anna");
    const b = await createUser("Bruno");
    await tausch(a, b, "vorschlag");
    await tausch(a, b, "treuhand");
    await tausch(a, b, "treuhand");
    await db.insert(ringSwaps).values({ id: newId("ring"), initiatorId: a, status: "angenommen" });

    const bild = await betriebsbild();
    expect(bild.tausche.vorschlag).toBe(1);
    expect(bild.tausche.treuhand).toBe(2);
    expect(bild.tausche.abgeschlossen).toBe(0);
    expect(bild.ringe.angenommen).toBe(1);
  });

  it("trennt reserviertes, ausgezahltes und liegengebliebenes Geld", async () => {
    const a = await createUser("Anna");
    const b = await createUser("Bruno");
    const d = await tausch(a, b, "treuhand");
    await zahlung(d, a, b, 100_000, "autorisiert");
    await zahlung(d, a, b, 250_000, "ausgezahlt", "tr_1");
    // Eingezogen, aber nie überwiesen: das ist der gefährliche Zustand.
    await zahlung(d, a, b, 70_000, "eingezogen");
    // Eingezogen und überwiesen zählt nicht als liegengeblieben.
    await zahlung(d, a, b, 30_000, "eingezogen", "tr_2");

    const bild = await betriebsbild();
    expect(bild.geld.reserviertMinor).toBe(100_000);
    expect(bild.geld.ausgezahltMinor).toBe(250_000);
    expect(bild.geld.liegengebliebenAnzahl).toBe(1);
    expect(bild.geld.liegengebliebenMinor).toBe(70_000);
    // Gebühren nur auf dem, was wirklich durch ist.
    expect(bild.geld.gebuehrenMinor).toBe(2_500);
  });

  it("zählt nur offene Meldungen", async () => {
    const b = await createUser("Bruno");
    const v = await createVehicle(b);
    const [inserat] = await db.select().from(listings).where(eq(listings.vehicleId, v));
    // Je Person und Inserat lässt die Datenbank nur eine Meldung zu.
    for (const [i, status] of (["offen", "offen", "geprüft"] as const).entries()) {
      await db.insert(reports).values({
        id: newId("rep"),
        listingId: inserat.id,
        reporterId: await createUser(`Melder ${i}`),
        reason: "betrugsverdacht",
        status,
      });
    }
    expect((await betriebsbild()).offeneMeldungen).toBe(2);
  });

  /**
   * Die Umgebung wird hier ausdrücklich gesetzt und wieder zurückgenommen.
   * Alle Testdateien teilen sich einen Prozess (siehe vitest.config), also
   * auch process.env — eine Prüfung auf «nichts ist gesetzt» hinge sonst
   * daran, welche Datei vorher lief.
   */
  it("nennt, was noch nicht eingerichtet ist", async () => {
    const vorher = { ...process.env };
    for (const k of [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "RESEND_API_KEY",
      "MAIL_FROM",
      "BLOB_READ_WRITE_TOKEN",
      "CRON_SECRET",
      "HEALTH_TOKEN",
      "OPERATOR_NAME",
    ]) {
      delete process.env[k];
    }
    try {
      const fehlt = (await betriebsbild()).nichtEingerichtet.join(" ");
      expect(fehlt).toMatch(/STRIPE_SECRET_KEY/);
      expect(fehlt).toMatch(/RESEND_API_KEY/);
      expect(fehlt).toMatch(/Hintergrundläufe/);
      expect(fehlt).toMatch(/Impressum/);
    } finally {
      Object.assign(process.env, vorher);
    }
  });

  it("meldet nichts, sobald alles gesetzt ist", async () => {
    const vorher = { ...process.env };
    Object.assign(process.env, {
      STRIPE_SECRET_KEY: "sk_test_attrappe",
      STRIPE_WEBHOOK_SECRET: "whsec_attrappe",
      RESEND_API_KEY: "re_attrappe",
      MAIL_FROM: "post@autotauschen.test",
      SITE_URL: "https://autotauschen.test",
      BLOB_READ_WRITE_TOKEN: "blob_attrappe",
      CRON_SECRET: "geheim",
      OPERATOR_NAME: "autotauschen AG",
      OPERATOR_LEGAL_FORM: "AG",
      OPERATOR_ADDRESS: "Bahnhofstrasse 1, 8001 Zürich",
      OPERATOR_UID: "CHE-123.456.789",
      OPERATOR_EMAIL: "hallo@autotauschen.test",
    });
    try {
      expect((await betriebsbild()).nichtEingerichtet).toEqual([]);
    } finally {
      for (const k of Object.keys(process.env)) {
        if (!(k in vorher)) delete process.env[k];
      }
      Object.assign(process.env, vorher);
    }
  });
});

describe("Listen für die Übersicht", () => {
  it("zeigt Geld, das unterwegs ist — ältestes zuerst", async () => {
    const a = await createUser("Anna");
    const b = await createUser("Bruno");
    const d = await tausch(a, b, "treuhand");
    const alt = await zahlung(d, a, b, 100_000, "autorisiert");
    await db
      .update(payments)
      .set({ createdAt: new Date(Date.now() - 5 * 86_400_000) })
      .where(eq(payments.id, alt));
    await zahlung(d, a, b, 50_000, "eingezogen");
    // Abgeschlossenes und storniertes Geld ist nicht mehr unterwegs.
    await zahlung(d, a, b, 90_000, "ausgezahlt", "tr_3");
    await zahlung(d, a, b, 10_000, "storniert");

    const wege = await laufendeMitGeld();
    expect(wege).toHaveLength(2);
    expect(wege[0].id).toBe(alt);
    expect(seitTagen(wege[0].seit)).toBe(5);
  });

  it("zeigt die neuesten Konten zuerst und lässt gelöschte weg", async () => {
    const alt = await createUser("Alt");
    await db
      .update(users)
      .set({ createdAt: new Date(Date.now() - 3 * 86_400_000) })
      .where(eq(users.id, alt));
    const neu = await createUser("Neu");
    const weg = await createUser("Weg");
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, weg));

    const konten = await neuesteKonten();
    expect(konten.map((k) => k.id)).toEqual([neu, alt]);
    expect(konten[0].bestaetigt).toBe(true);
  });
});
