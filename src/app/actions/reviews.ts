"use server";

import { revalidatePath } from "next/cache";
import { eq, sql as raw } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { deals, reviews, ringLegs, ringSwaps, users } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { suspendedNotice } from "@/lib/auth/guards";

export interface ReviewResult {
  ok?: boolean;
  error?: string;
}

const reviewSchema = z.object({
  // Halbe Sterne, wie in der Oberfläche
  stars: z.coerce.number().min(1).max(5).multipleOf(0.5),
  body: z.string().trim().max(1_000),
});

/**
 * Bewertung nach einem abgeschlossenen Tausch.
 *
 * Nur die beiden Beteiligten, nur einmal pro Tausch und Person, und nur wenn
 * der Tausch tatsächlich durch ist — eine Bewertung ist sonst ein Druckmittel
 * in einer laufenden Verhandlung.
 */
export async function submitReviewAction(
  dealId: string,
  stars: number,
  body: string,
): Promise<ReviewResult> {
  const me = await requireUser();
  const stillgelegt = suspendedNotice(me);
  if (stillgelegt) return { error: stillgelegt };

  const parsed = reviewSchema.safeParse({ stars, body });
  if (!parsed.success) {
    return { error: "Bitte eine Bewertung zwischen 1 und 5 Sternen abgeben." };
  }

  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) return { error: "Tausch nicht gefunden." };
  if (deal.initiatorId !== me.id && deal.counterpartyId !== me.id) {
    return { error: "Tausch nicht gefunden." };
  }
  if (deal.status !== "abgeschlossen") {
    return { error: "Bewerten lässt sich erst ein abgeschlossener Tausch." };
  }

  const subjectId = deal.initiatorId === me.id ? deal.counterpartyId : deal.initiatorId;
  // Der Durchschnitt wird aus Summe und Anzahl gebildet; die Summe liegt in
  // Zehntelsternen, damit sie eine ganze Zahl bleibt.
  const zehntel = Math.round(parsed.data.stars * 10);

  const angelegt = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(reviews)
      .values({
        id: newId("rev"),
        dealId,
        authorId: me.id,
        subjectId,
        stars: parsed.data.stars,
        body: parsed.data.body || null,
      })
      // Der eindeutige Index auf (Tausch, Autor) entscheidet, nicht ein
      // vorgeschaltetes SELECT — sonst käme ein Doppelklick durch.
      .onConflictDoNothing({ target: [reviews.dealId, reviews.authorId] })
      .returning({ id: reviews.id });
    if (!rows.length) return false;

    await tx
      .update(users)
      .set({
        ratingSum: raw`${users.ratingSum} + ${zehntel}`,
        ratingCount: raw`${users.ratingCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, subjectId));
    return true;
  });

  if (!angelegt) return { error: "Du hast diesen Tausch bereits bewertet." };

  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/fahrzeug/${deal.toVehicleId}`);
  revalidatePath(`/fahrzeug/${deal.fromVehicleId}`);
  return { ok: true };
}

/**
 * Bewertung nach einem abgeschlossenen Ringtausch.
 *
 * Anders als beim Zweiertausch bewertet jede Person zwei andere — die, von der
 * sie das Fahrzeug bekommen hat, und die, der sie ihres gegeben hat. Beide
 * Übergaben können völlig verschieden gelaufen sein, deshalb ist es je eine
 * eigene Bewertung.
 */
export async function submitRingReviewAction(
  ringId: string,
  subjectId: string,
  stars: number,
  body: string,
): Promise<ReviewResult> {
  const me = await requireUser();
  const stillgelegt = suspendedNotice(me);
  if (stillgelegt) return { error: stillgelegt };

  const parsed = reviewSchema.safeParse({ stars, body });
  if (!parsed.success) {
    return { error: "Bitte eine Bewertung zwischen 1 und 5 Sternen abgeben." };
  }

  const [ring] = await db.select().from(ringSwaps).where(eq(ringSwaps.id, ringId)).limit(1);
  if (!ring) return { error: "Ringtausch nicht gefunden." };

  const legs = await db.select().from(ringLegs).where(eq(ringLegs.ringId, ringId));
  if (!legs.some((l) => l.userId === me.id)) return { error: "Ringtausch nicht gefunden." };
  if (subjectId === me.id) return { error: "Sich selbst bewertet man nicht." };
  if (!legs.some((l) => l.userId === subjectId)) {
    return { error: "Diese Person gehört nicht zu diesem Ring." };
  }
  if (ring.status !== "abgeschlossen") {
    return { error: "Bewerten lässt sich erst ein abgeschlossener Tausch." };
  }

  const zehntel = Math.round(parsed.data.stars * 10);

  const angelegt = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(reviews)
      .values({
        id: newId("rev"),
        ringId,
        authorId: me.id,
        subjectId,
        stars: parsed.data.stars,
        body: parsed.data.body || null,
      })
      // Der eindeutige Index auf (Ring, Autor, Bewertete) entscheidet, nicht
      // ein vorgeschaltetes SELECT — sonst käme ein Doppelklick durch.
      .onConflictDoNothing({ target: [reviews.ringId, reviews.authorId, reviews.subjectId] })
      .returning({ id: reviews.id });
    if (!rows.length) return false;

    await tx
      .update(users)
      .set({
        ratingSum: raw`${users.ratingSum} + ${zehntel}`,
        ratingCount: raw`${users.ratingCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, subjectId));
    return true;
  });

  if (!angelegt) return { error: "Du hast diese Person zu diesem Ring bereits bewertet." };

  revalidatePath(`/ringe/${ringId}`);
  for (const leg of legs) revalidatePath(`/fahrzeug/${leg.vehicleId}`);
  return { ok: true };
}
