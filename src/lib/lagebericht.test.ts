import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { deals, listings, payments, reports, ringSwaps } from "@/lib/db/schema";
import { createUser, createVehicle, resetDatabase } from "@/test/fixtures";

const briefe: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/mail", () => ({
  sendMail: async (m: { to: string; subject: string; text: string }) => {
    briefe.push(m);
    return { delivered: true };
  },
  siteUrl: () => "https://autotauschen.test",
  siteUrlConfigured: () => true,
  mailConfigured: () => true,
}));

const { erstelleLagebericht, sammlePunkte } = await import("@/lib/lagebericht");

const TAG = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await resetDatabase();
  briefe.length = 0;
  process.env.OPERATOR_EMAIL = "betrieb@autotauschen.test";
});

async function tauschMitZahlung(opts: {
  status?: (typeof deals.$inferSelect)["status"];
  escrowVor?: number;
  zahlung?: Partial<typeof payments.$inferInsert>;
}) {
  const a = await createUser("Anna");
  const b = await createUser("Bruno");
  const dealId = newId("dl");
  await db.insert(deals).values({
    id: dealId,
    fromVehicleId: await createVehicle(a),
    toVehicleId: await createVehicle(b),
    initiatorId: a,
    counterpartyId: b,
    cashDelta: 4_000,
    status: opts.status ?? "treuhand",
    escrowAt: new Date(Date.now() - (opts.escrowVor ?? 0)),
  });
  if (opts.zahlung) {
    await db.insert(payments).values({
      id: newId("pay"),
      dealId,
      payerId: a,
      payeeId: b,
      amountMinor: 400_000,
      feeMinor: 0,
      status: "eingezogen",
      ...opts.zahlung,
    });
  }
  return { a, b, dealId };
}

describe("Lagebericht", () => {
  it("schweigt, wenn es nichts zu melden gibt", async () => {
    const bericht = await erstelleLagebericht();
    expect(bericht).toEqual({ punkte: [], verschickt: false, grund: "nichts zu melden" });
    expect(briefe).toEqual([]);
  });

  it("meldet eine offene Rückbuchung mit Betrag", async () => {
    await tauschMitZahlung({
      zahlung: {
        status: "ausgezahlt",
        stripeTransferId: "tr_1",
        disputedAt: new Date(),
        disputeStatus: "needs_response",
        disputeAmountMinor: 400_000,
      },
    });

    const bericht = await erstelleLagebericht();
    expect(bericht.verschickt).toBe(true);
    expect(briefe).toHaveLength(1);
    expect(briefe[0].to).toBe("betrieb@autotauschen.test");
    expect(briefe[0].subject).toMatch(/1 Rückbuchung/);
    expect(briefe[0].text).toMatch(/4000\.00 CHF/);
    expect(briefe[0].text).toMatch(/Stripe-Dashboard/);
  });

  it("zählt eine entschiedene Rückbuchung nicht mehr", async () => {
    await tauschMitZahlung({
      zahlung: {
        status: "ausgezahlt",
        stripeTransferId: "tr_1",
        disputedAt: new Date(),
        disputeStatus: "won",
        disputeAmountMinor: 400_000,
      },
    });
    expect(await sammlePunkte()).toEqual([]);
  });

  it("meldet Geld, das eingezogen und nicht weitergeleitet ist", async () => {
    await tauschMitZahlung({ zahlung: { status: "eingezogen" } });
    const punkte = await sammlePunkte();
    expect(punkte.map((p) => p.kurz)).toEqual(["4000.00 CHF liegen"]);
  });

  it("meldet einen Vorgang, der zu lange in der Treuhandphase steht", async () => {
    await tauschMitZahlung({ escrowVor: 5 * TAG });
    const punkte = await sammlePunkte();
    expect(punkte.map((p) => p.kurz)).toEqual(["1 Vorgang/Vorgänge warten"]);
    expect(punkte[0].text).toMatch(/sieben Tagen/);
  });

  it("lässt einen frisch hinterlegten Vorgang in Ruhe", async () => {
    await tauschMitZahlung({ escrowVor: 1 * TAG });
    expect(await sammlePunkte()).toEqual([]);
  });

  it("zählt wartende Ringe mit", async () => {
    const a = await createUser("Anna");
    await db.insert(ringSwaps).values({
      id: newId("ring"),
      initiatorId: a,
      status: "treuhand",
      escrowAt: new Date(Date.now() - 5 * TAG),
    });
    await tauschMitZahlung({ escrowVor: 5 * TAG });
    const punkte = await sammlePunkte();
    expect(punkte.map((p) => p.kurz)).toEqual(["2 Vorgang/Vorgänge warten"]);
  });

  it("meldet offene Beanstandungen, erledigte nicht", async () => {
    const b = await createUser("Bruno");
    const v = await createVehicle(b);
    const [inserat] = await db.select().from(listings).where(eq(listings.vehicleId, v));
    for (const [i, status] of (["offen", "geprüft"] as const).entries()) {
      await db.insert(reports).values({
        id: newId("rep"),
        listingId: inserat.id,
        reporterId: await createUser(`Melder ${i}`),
        reason: "betrugsverdacht",
        status,
      });
    }
    const punkte = await sammlePunkte();
    expect(punkte.map((p) => p.kurz)).toEqual(["1 Meldung(en) offen"]);
  });

  it("nimmt auf, was der Wartungslauf nicht durchbekommen hat", async () => {
    const punkte = await sammlePunkte({
      geprueft: 3,
      abgeschlossen: 1,
      wartetAufKonto: 0,
      festgefahren: 2,
    });
    expect(punkte.map((p) => p.kurz)).toEqual(["2 Abschluss/Abschlüsse hängen"]);
  });

  it("nennt alle Punkte in einer Nachricht", async () => {
    await tauschMitZahlung({ escrowVor: 5 * TAG, zahlung: { status: "eingezogen" } });
    const bericht = await erstelleLagebericht();
    expect(bericht.punkte).toHaveLength(2);
    expect(briefe).toHaveLength(1);
    // Rückbuchungen und liegendes Geld stehen vor allem anderen.
    expect(briefe[0].subject).toBe("autotauschen: 4000.00 CHF liegen, 1 Vorgang/Vorgänge warten");
  });

  it("schickt nichts los, wenn keine Empfängeradresse gesetzt ist", async () => {
    delete process.env.OPERATOR_EMAIL;
    await tauschMitZahlung({ zahlung: { status: "eingezogen" } });

    const bericht = await erstelleLagebericht();
    expect(bericht.verschickt).toBe(false);
    expect(bericht.grund).toBe("keine Empfängeradresse");
    expect(bericht.punkte).toHaveLength(1);
    expect(briefe).toEqual([]);
  });

  it("verschickt beim blossen Sammeln nichts", async () => {
    await tauschMitZahlung({ zahlung: { status: "eingezogen" } });
    await sammlePunkte();
    // Der Health-Check fragt die Lage womöglich im Minutentakt ab.
    expect(briefe).toEqual([]);
  });
});
