import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { deals, reviews, users } from "@/lib/db/schema";
import { als, createUser, createVehicle, resetDatabase } from "@/test/fixtures";
import { submitReviewAction } from "@/app/actions/reviews";
import { getMyReviewForDeal, getPublicUser, getReviewsAbout } from "@/lib/queries";

beforeEach(async () => {
  await resetDatabase();
  als(null);
});

async function abgeschlossenerTausch(status: (typeof deals.$inferSelect)["status"] = "abgeschlossen") {
  const a = await createUser("Anna");
  const b = await createUser("Bruno");
  const va = await createVehicle(a);
  const vb = await createVehicle(b);
  const dealId = newId("dl");
  await db.insert(deals).values({
    id: dealId,
    fromVehicleId: va,
    toVehicleId: vb,
    initiatorId: a,
    counterpartyId: b,
    cashDelta: 0,
    status,
  });
  return { a, b, dealId };
}

describe("Bewertung abgeben", () => {
  it("schreibt die Bewertung der Gegenseite zu und rechnet den Schnitt", async () => {
    const { a, b, dealId } = await abgeschlossenerTausch();
    als(a);
    expect((await submitReviewAction(dealId, 4.5, "Alles reibungslos")).error).toBeUndefined();

    const [row] = await db.select().from(reviews).where(eq(reviews.dealId, dealId));
    expect(row.authorId).toBe(a);
    expect(row.subjectId).toBe(b);
    expect(row.stars).toBe(4.5);

    // Der Schnitt hängt an Summe und Anzahl; die Summe liegt in Zehnteln.
    const [konto] = await db.select().from(users).where(eq(users.id, b));
    expect(konto.ratingSum).toBe(45);
    expect(konto.ratingCount).toBe(1);
    expect((await getPublicUser(b))?.rating).toBe(4.5);
  });

  it("mittelt mehrere Bewertungen richtig", async () => {
    const b = await createUser("Bruno");
    for (const [stern, name] of [
      [5, "Anna"],
      [4, "Chiara"],
      [3, "Dario"],
    ] as const) {
      const autor = await createUser(name);
      const va = await createVehicle(autor);
      const vb = await createVehicle(b);
      const dealId = newId("dl");
      await db.insert(deals).values({
        id: dealId,
        fromVehicleId: va,
        toVehicleId: vb,
        initiatorId: autor,
        counterpartyId: b,
        cashDelta: 0,
        status: "abgeschlossen",
      });
      als(autor);
      expect((await submitReviewAction(dealId, stern, "")).error).toBeUndefined();
    }
    expect((await getPublicUser(b))?.rating).toBe(4);
    expect(await getReviewsAbout(b)).toHaveLength(3);
  });

  it("nimmt pro Tausch nur eine Bewertung je Person", async () => {
    const { a, b, dealId } = await abgeschlossenerTausch();
    als(a);
    await submitReviewAction(dealId, 5, "gut");
    const zweite = await submitReviewAction(dealId, 1, "doch nicht");
    expect(zweite.error).toMatch(/bereits bewertet/);

    const [konto] = await db.select().from(users).where(eq(users.id, b));
    expect(konto.ratingCount).toBe(1);
    expect(konto.ratingSum).toBe(50);
  });

  it("hält zwei gleichzeitige Abgaben auseinander", async () => {
    const { a, b, dealId } = await abgeschlossenerTausch();
    als(a);
    const beide = await Promise.all([
      submitReviewAction(dealId, 5, "eins"),
      submitReviewAction(dealId, 5, "zwei"),
    ]);
    expect(beide.filter((r) => !r.error)).toHaveLength(1);
    const [konto] = await db.select().from(users).where(eq(users.id, b));
    expect(konto.ratingCount).toBe(1);
  });

  it("lässt einen laufenden Tausch nicht bewerten", async () => {
    for (const status of ["vorschlag", "angenommen", "treuhand", "storniert"] as const) {
      const { a, dealId } = await abgeschlossenerTausch(status);
      als(a);
      const res = await submitReviewAction(dealId, 5, "");
      expect(res.error, `Status ${status}`).toMatch(/abgeschlossener Tausch/);
      await resetDatabase();
    }
  });

  it("lässt Unbeteiligte nicht bewerten", async () => {
    const { dealId } = await abgeschlossenerTausch();
    const fremd = await createUser("Chiara");
    als(fremd);
    expect((await submitReviewAction(dealId, 5, "")).error).toMatch(/nicht gefunden/);
  });

  it("weist unmögliche Sternzahlen ab", async () => {
    const { a, dealId } = await abgeschlossenerTausch();
    als(a);
    for (const stern of [0, 6, -3, 4.3, Number.NaN]) {
      expect((await submitReviewAction(dealId, stern, "")).error, `${stern} Sterne`).toBeDefined();
    }
    expect(await db.select().from(reviews)).toHaveLength(0);
  });

  it("findet die eigene Bewertung wieder", async () => {
    const { a, dealId } = await abgeschlossenerTausch();
    als(a);
    expect(await getMyReviewForDeal(dealId, a)).toBeNull();
    await submitReviewAction(dealId, 3.5, "geht so");
    expect(await getMyReviewForDeal(dealId, a)).toEqual({ stars: 3.5, body: "geht so" });
  });
});
