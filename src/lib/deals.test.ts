import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import {
  dealMessages,
  dealVehicleLocks,
  deals,
  listings,
  payments,
  users,
  vehicles,
} from "@/lib/db/schema";
import { als, createUser, createVehicle, resetDatabase } from "@/test/fixtures";
import {
  acceptDealAction,
  cancelDealAction,
  confirmHandoverAction,
  proposeSwapAction,
  sendDealMessageAction,
  startEscrowAction,
} from "@/app/actions/deals";
import { setListingStatusAction } from "@/app/actions/listings";

/** Stripe wird nicht angesprochen; der Einzug wird nachgebildet. */
vi.mock("@/lib/payments", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/payments")>();
  return {
    ...original,
    stripeConfigured: () => true,
    payoutReady: async (userId: string) => {
      const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return Boolean(rows[0]?.stripePayoutsEnabled);
    },
    captureAndPayout: async (payment: typeof payments.$inferSelect) => {
      if (payment.status === "ausgezahlt") return payment;
      if (payment.status !== "autorisiert" && payment.status !== "eingezogen") {
        throw new original.PaymentStateError(payment.status);
      }
      const rows = await db.select().from(users).where(eq(users.id, payment.payeeId)).limit(1);
      if (!rows[0]?.stripePayoutsEnabled) throw new original.PayoutBlockedError(payment.payeeId);
      const updated = await db
        .update(payments)
        .set({ status: "ausgezahlt", updatedAt: new Date() })
        .where(eq(payments.id, payment.id))
        .returning();
      return updated[0];
    },
    releaseAuthorization: async (payment: typeof payments.$inferSelect) => {
      await db
        .update(payments)
        .set({ status: payment.status === "eingezogen" ? "erstattet" : "storniert" })
        .where(eq(payments.id, payment.id));
    },
  };
});

/** Legt eine hinterlegte Zahlung an, wie sie der Webhook erzeugen würde. */
async function hinterlegeZahlung(
  dealId: string,
  payerId: string,
  payeeId: string,
  amountMinor: number,
  status: (typeof payments.$inferSelect)["status"] = "autorisiert",
) {
  const id = newId("pay");
  await db.insert(payments).values({
    id,
    dealId,
    payerId,
    payeeId,
    amountMinor,
    feeMinor: 0,
    status,
    stripePaymentIntentId: `pi_${id}`,
    authorizedAt: new Date(),
  });
  return id;
}

async function dealRow(id: string) {
  const [row] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  return row;
}

async function ownerOf(vehicleId: string) {
  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  return row.ownerId;
}

beforeEach(async () => {
  await resetDatabase();
  als(null);
});

afterAll(async () => {
  await resetDatabase();
});

/** Zwei Nutzer, zwei Fahrzeuge, ein Vorschlag von A an B. */
async function aufbau(cashDelta = 0, payoutsEnabled = true) {
  const a = await createUser("Anna", { stripeAccountId: "acct_a", stripePayoutsEnabled: payoutsEnabled });
  const b = await createUser("Bruno", { stripeAccountId: "acct_b", stripePayoutsEnabled: payoutsEnabled });
  const va = await createVehicle(a, { make: "Polestar", model: "4" });
  const vb = await createVehicle(b, { make: "Zeekr", model: "7X" });

  als(a);
  const res = await proposeSwapAction({
    fromVehicleId: va,
    toVehicleId: vb,
    cashDelta,
    message: "Interesse?",
  });
  expect(res.error).toBeUndefined();
  return { a, b, va, vb, dealId: res.dealId! };
}

describe("Tausch ohne Ausgleich", () => {
  it("schreibt Fahrzeuge, Inserate und Zähler beim Abschluss um", async () => {
    const { a, b, va, vb, dealId } = await aufbau(0);

    als(b);
    expect((await acceptDealAction(dealId)).error).toBeUndefined();
    expect((await startEscrowAction(dealId)).error).toBeUndefined();
    expect((await dealRow(dealId)).status).toBe("treuhand");

    expect((await confirmHandoverAction(dealId)).error).toBeUndefined();
    als(a);
    expect((await confirmHandoverAction(dealId)).error).toBeUndefined();

    expect((await dealRow(dealId)).status).toBe("abgeschlossen");
    expect(await ownerOf(va)).toBe(b);
    expect(await ownerOf(vb)).toBe(a);

    // Die Inserate wandern mit, sonst wäre das Fahrzeug nie wieder einstellbar
    const [lva] = await db.select().from(listings).where(eq(listings.vehicleId, va));
    const [lvb] = await db.select().from(listings).where(eq(listings.vehicleId, vb));
    expect(lva.ownerId).toBe(b);
    expect(lva.status).toBe("getauscht");
    expect(lvb.ownerId).toBe(a);

    // Sperren gelöst, Zähler genau einmal hoch
    expect(await db.select().from(dealVehicleLocks)).toHaveLength(0);
    const [annaRow] = await db.select().from(users).where(eq(users.id, a));
    expect(annaRow.swapsCompleted).toBe(1);
  });

  it("lässt das eingetauschte Fahrzeug wieder inserieren", async () => {
    const { a, b, va, dealId } = await aufbau(0);
    als(b);
    await acceptDealAction(dealId);
    await startEscrowAction(dealId);
    await confirmHandoverAction(dealId);
    als(a);
    await confirmHandoverAction(dealId);

    // Bruno hat Annas Fahrzeug bekommen und stellt es neu ein
    als(b);
    expect((await setListingStatusAction(va, "aktiv")).error).toBeUndefined();
    const [row] = await db.select().from(listings).where(eq(listings.vehicleId, va));
    expect(row.status).toBe("aktiv");

    // Anna darf das nicht mehr
    als(a);
    expect((await setListingStatusAction(va, "pausiert")).error).toBeDefined();
  });

  it("zählt eine doppelte Bestätigung nur einmal", async () => {
    const { a, b, dealId } = await aufbau(0);
    als(b);
    await acceptDealAction(dealId);
    await startEscrowAction(dealId);
    await confirmHandoverAction(dealId);
    als(a);
    await confirmHandoverAction(dealId);
    await confirmHandoverAction(dealId);
    await confirmHandoverAction(dealId);

    const [annaRow] = await db.select().from(users).where(eq(users.id, a));
    expect(annaRow.swapsCompleted).toBe(1);
    expect((await dealRow(dealId)).status).toBe("abgeschlossen");
  });
});

describe("Fahrzeugsperre", () => {
  it("verhindert eine zweite Zusage für dasselbe Fahrzeug", async () => {
    const { a, b, va, dealId } = await aufbau(0);
    const c = await createUser("Chiara", { stripeAccountId: "acct_c", stripePayoutsEnabled: true });
    const vc = await createVehicle(c, { make: "Kia", model: "EV6" });

    als(a);
    const zweiter = await proposeSwapAction({
      fromVehicleId: va,
      toVehicleId: vc,
      cashDelta: 0,
      message: "Auch Interesse?",
    });
    expect(zweiter.error).toBeUndefined();

    als(b);
    expect((await acceptDealAction(dealId)).error).toBeUndefined();

    als(c);
    const res = await acceptDealAction(zweiter.dealId!);
    expect(res.error).toMatch(/anderen zugesagten Tausch/);
    expect((await dealRow(zweiter.dealId!)).status).not.toBe("angenommen");
  });

  it("gibt das Fahrzeug nach einem Abbruch wieder frei", async () => {
    const { a, b, va, dealId } = await aufbau(0);
    als(b);
    await acceptDealAction(dealId);
    expect(await db.select().from(dealVehicleLocks)).toHaveLength(2);
    expect((await cancelDealAction(dealId)).error).toBeUndefined();
    expect(await db.select().from(dealVehicleLocks)).toHaveLength(0);

    const [row] = await db.select().from(listings).where(eq(listings.vehicleId, va));
    expect(row.status).toBe("aktiv");
    void a;
  });

  it("storniert konkurrierende Vorschläge beim Abschluss", async () => {
    const { a, b, va, dealId } = await aufbau(0);
    const c = await createUser("Chiara");
    const vc = await createVehicle(c, { make: "Kia", model: "EV6" });
    als(a);
    const konkurrenz = await proposeSwapAction({
      fromVehicleId: va,
      toVehicleId: vc,
      cashDelta: 0,
      message: "Alternative",
    });

    als(b);
    await acceptDealAction(dealId);
    await startEscrowAction(dealId);
    await confirmHandoverAction(dealId);
    als(a);
    await confirmHandoverAction(dealId);

    expect((await dealRow(konkurrenz.dealId!)).status).toBe("storniert");
  });
});

describe("Ausgleichszahlung", () => {
  it("schliesst nicht ab, wenn die Zahlung storniert wurde", async () => {
    const { a, b, va, vb, dealId } = await aufbau(4000);
    als(b);
    await acceptDealAction(dealId);
    await hinterlegeZahlung(dealId, a, b, 400_000, "storniert");
    await db
      .update(deals)
      .set({ status: "treuhand", escrowAt: new Date() })
      .where(eq(deals.id, dealId));

    await confirmHandoverAction(dealId);
    als(a);
    const res = await confirmHandoverAction(dealId);

    expect(res.error).toMatch(/nicht mehr gültig/);
    expect((await dealRow(dealId)).status).toBe("angenommen");
    expect(await ownerOf(va)).toBe(a);
    expect(await ownerOf(vb)).toBe(b);
  });

  it("schliesst nicht ab, solange das Auszahlungskonto fehlt", async () => {
    const { a, b, va, dealId } = await aufbau(4000, false);
    als(b);
    await acceptDealAction(dealId);
    await hinterlegeZahlung(dealId, a, b, 400_000, "autorisiert");
    await db
      .update(deals)
      .set({ status: "treuhand", escrowAt: new Date() })
      .where(eq(deals.id, dealId));

    await confirmHandoverAction(dealId);
    als(a);
    const res = await confirmHandoverAction(dealId);

    expect(res.error).toMatch(/Auszahlungskonto/);
    expect((await dealRow(dealId)).status).toBe("treuhand");
    expect(await ownerOf(va)).toBe(a);
  });

  it("wickelt nach einem gescheiterten Anlauf beim zweiten Versuch ab", async () => {
    const { a, b, va, dealId } = await aufbau(4000, false);
    als(b);
    await acceptDealAction(dealId);
    await hinterlegeZahlung(dealId, a, b, 400_000, "autorisiert");
    await db
      .update(deals)
      .set({ status: "treuhand", escrowAt: new Date() })
      .where(eq(deals.id, dealId));
    await confirmHandoverAction(dealId);
    als(a);
    expect((await confirmHandoverAction(dealId)).error).toBeDefined();

    // Bruno richtet sein Auszahlungskonto ein, danach greift derselbe Knopf
    await db.update(users).set({ stripePayoutsEnabled: true }).where(eq(users.id, b));
    expect((await confirmHandoverAction(dealId)).error).toBeUndefined();

    expect((await dealRow(dealId)).status).toBe("abgeschlossen");
    expect(await ownerOf(va)).toBe(b);
    const [pay] = await db.select().from(payments).where(eq(payments.dealId, dealId));
    expect(pay.status).toBe("ausgezahlt");
  });

  it("verweigert die Einzahlung, wenn die Gegenseite kein Auszahlungskonto hat", async () => {
    const { b, dealId } = await aufbau(4000, false);
    als(b);
    await acceptDealAction(dealId);
    als((await dealRow(dealId)).initiatorId);
    const res = await startEscrowAction(dealId);
    expect(res.error).toMatch(/Auszahlungskonto/);
    expect((await dealRow(dealId)).status).toBe("angenommen");
  });
});

describe("Gleichzeitige Zugriffe", () => {
  it("lässt von zwei parallelen Zusagen nur eine durch", async () => {
    const { b, dealId } = await aufbau(0);
    als(b);
    const [erste, zweite] = await Promise.all([
      acceptDealAction(dealId),
      acceptDealAction(dealId),
    ]);
    const erfolge = [erste, zweite].filter((r) => !r.error);
    const fehler = [erste, zweite].find((r) => r.error)?.error ?? "";
    expect(erfolge).toHaveLength(1);
    // Die unterlegene Anfrage muss am Zustandswächter scheitern, nicht erst
    // an der Fahrzeugsperre — sonst prüft der Test den falschen Mechanismus.
    expect(fehler).toMatch(/inzwischen geändert|nicht mehr offen/);
    expect(fehler).not.toMatch(/anderen zugesagten Tausch/);
    expect((await dealRow(dealId)).status).toBe("angenommen");
    expect(await db.select().from(dealVehicleLocks)).toHaveLength(2);
  });

  it("bindet die Zusage nicht an ein gleichzeitig eingegangenes Gegenangebot", async () => {
    const { a, b, dealId } = await aufbau(1000);
    const vorher = (await dealRow(dealId)).cashDelta;

    const [angebot, zusage] = await Promise.all([
      (async () => {
        als(a);
        return await sendDealMessageAction(dealId, "Doch lieber mehr", 9000);
      })(),
      (async () => {
        als(b);
        return await acceptDealAction(dealId);
      })(),
    ]);

    const frisch = await dealRow(dealId);
    if (!zusage.error) {
      // Zusage gewonnen: der Betrag muss der sein, den Bruno gesehen hat.
      expect(frisch.cashDelta).toBe(vorher);
      expect(frisch.status).toBe("angenommen");
    } else {
      // Gegenangebot gewonnen: dann darf keine Zusage entstanden sein.
      expect(angebot.error).toBeUndefined();
      expect(frisch.cashDelta).toBe(9000);
      expect(frisch.status).not.toBe("angenommen");
    }
  });

  it("hält Abbruch und Abschluss auseinander", async () => {
    const { a, b, va, vb, dealId } = await aufbau(0);
    als(b);
    await acceptDealAction(dealId);
    await startEscrowAction(dealId);
    await confirmHandoverAction(dealId);

    // Anna bestätigt, während Bruno im selben Moment abbricht.
    const [abschluss, abbruch] = await Promise.all([
      (async () => {
        als(a);
        return await confirmHandoverAction(dealId);
      })(),
      (async () => {
        als(b);
        return await cancelDealAction(dealId);
      })(),
    ]);

    const status = (await dealRow(dealId)).status;
    expect(["abgeschlossen", "storniert"]).toContain(status);
    if (status === "abgeschlossen") {
      expect(await ownerOf(va)).toBe(b);
      expect(await ownerOf(vb)).toBe(a);
      expect(abschluss.error).toBeUndefined();
      expect(abbruch.error).toBeDefined();
    } else {
      // Abgebrochen heisst: die Fahrzeuge bleiben, wo sie waren.
      expect(await ownerOf(va)).toBe(a);
      expect(await ownerOf(vb)).toBe(b);
      expect(abbruch.error).toBeUndefined();
    }
    expect(await db.select().from(dealVehicleLocks)).toHaveLength(0);
  });
});

describe("Abwicklung", () => {
  /** Bringt einen Tausch in den Zustand, in dem das Geld schon geflossen ist. */
  async function inAbwicklung() {
    const { a, b, va, vb, dealId } = await aufbau(4000);
    als(b);
    await acceptDealAction(dealId);
    await hinterlegeZahlung(dealId, a, b, 400_000, "ausgezahlt");
    await db
      .update(deals)
      .set({
        status: "abwicklung",
        escrowAt: new Date(),
        initiatorConfirmed: true,
        counterpartyConfirmed: true,
      })
      .where(eq(deals.id, dealId));
    return { a, b, va, vb, dealId };
  }

  it("lässt sich nicht abbrechen, während das Geld fliesst", async () => {
    const { b, va, dealId } = await inAbwicklung();
    als(b);
    const res = await cancelDealAction(dealId);
    expect(res.error).toMatch(/nicht mehr möglich/);
    expect((await dealRow(dealId)).status).toBe("abwicklung");
    expect(await ownerOf(va)).not.toBe(b);
  });

  it("holt einen steckengebliebenen Abschluss beim erneuten Bestätigen nach", async () => {
    const { a, b, va, vb, dealId } = await inAbwicklung();
    als(a);
    const res = await confirmHandoverAction(dealId);
    expect(res.error).toBeUndefined();
    expect((await dealRow(dealId)).status).toBe("abgeschlossen");
    expect(await ownerOf(va)).toBe(b);
    expect(await ownerOf(vb)).toBe(a);
    expect(await db.select().from(dealVehicleLocks)).toHaveLength(0);
  });
});

describe("Zustandswächter", () => {
  it("nimmt nach der Zusage kein Gegenangebot mehr an", async () => {
    const { a, b, dealId } = await aufbau(0);
    als(b);
    await acceptDealAction(dealId);
    als(a);
    const res = await sendDealMessageAction(dealId, "Doch lieber weniger", 2000);
    expect(res.error).toBeDefined();
    expect((await dealRow(dealId)).cashDelta).toBe(0);
    expect((await dealRow(dealId)).status).toBe("angenommen");
  });

  it("lässt einen abgeschlossenen Tausch nicht mehr abbrechen", async () => {
    const { a, b, dealId } = await aufbau(0);
    als(b);
    await acceptDealAction(dealId);
    await startEscrowAction(dealId);
    await confirmHandoverAction(dealId);
    als(a);
    await confirmHandoverAction(dealId);

    const res = await cancelDealAction(dealId);
    expect(res.error).toBeDefined();
    expect((await dealRow(dealId)).status).toBe("abgeschlossen");
  });

  it("zählt eine doppelte Bestätigung in der Treuhandphase nur einmal", async () => {
    const { a, dealId } = await aufbau(0);
    const b = (await dealRow(dealId)).counterpartyId;
    als(b);
    await acceptDealAction(dealId);
    await startEscrowAction(dealId);

    // Bruno bestätigt dreimal, Anna hat noch nicht bestätigt.
    await confirmHandoverAction(dealId);
    await confirmHandoverAction(dealId);
    await confirmHandoverAction(dealId);

    const frisch = await dealRow(dealId);
    expect(frisch.status).toBe("treuhand");
    expect(frisch.counterpartyConfirmed).toBe(true);
    expect(frisch.initiatorConfirmed).toBe(false);

    const nachrichten = await db
      .select()
      .from(dealMessages)
      .where(and(eq(dealMessages.dealId, dealId), eq(dealMessages.system, true)));
    const bestaetigungen = nachrichten.filter((m) => m.body.includes("Übergabe bestätigt"));
    expect(bestaetigungen).toHaveLength(1);
    void a;
  });

  it("schliesst nicht ab, wenn die Reservierung älter als die Stripe-Frist ist", async () => {
    const { a, b, va, dealId } = await aufbau(4000);
    als(b);
    await acceptDealAction(dealId);
    const payId = await hinterlegeZahlung(dealId, a, b, 400_000, "autorisiert");
    // Acht Tage alt — Stripe hätte die Reservierung längst verfallen lassen.
    await db
      .update(payments)
      .set({ authorizedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })
      .where(eq(payments.id, payId));
    await db
      .update(deals)
      .set({ status: "treuhand", escrowAt: new Date() })
      .where(eq(deals.id, dealId));

    await confirmHandoverAction(dealId);
    als(a);
    const res = await confirmHandoverAction(dealId);

    expect(res.error).toMatch(/nicht mehr gültig/);
    expect((await dealRow(dealId)).status).toBe("angenommen");
    expect(await ownerOf(va)).toBe(a);
  });

  it("nimmt nicht an, wenn das Fahrzeug in einem Alt-Tausch ohne Sperre hängt", async () => {
    const { a, b, va, dealId } = await aufbau(0);
    const c = await createUser("Chiara");
    const vc = await createVehicle(c);
    als(a);
    const zweiter = await proposeSwapAction({
      fromVehicleId: va,
      toVehicleId: vc,
      cashDelta: 0,
      message: "Alternative",
    });
    // Ein zugesagter Tausch aus der Zeit vor den Sperren: kein Eintrag in
    // deal_vehicle_locks, nur der Status in der deals-Tabelle.
    await db.update(deals).set({ status: "angenommen" }).where(eq(deals.id, dealId));

    als(c);
    const res = await acceptDealAction(zweiter.dealId!);
    expect(res.error).toMatch(/anderen zugesagten Tausch/);
    void b;
  });

  it("verhindert, dass der Anbietende sein eigenes Angebot annimmt", async () => {
    const { a, dealId } = await aufbau(3000);
    als(a);
    const res = await acceptDealAction(dealId);
    expect(res.error).toMatch(/selbst gemacht/);
  });

  it("nimmt kein Inserat an, dessen Fahrzeug den Besitzer gewechselt hat", async () => {
    const { a, b, va, dealId } = await aufbau(0);
    const c = await createUser("Chiara");
    await db.update(vehicles).set({ ownerId: c }).where(eq(vehicles.id, va));
    als(b);
    const res = await acceptDealAction(dealId);
    expect(res.error).toMatch(/Besitzer gewechselt/);
    void a;
  });
});
