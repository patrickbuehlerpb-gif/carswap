"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { listings, watchlist } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";

export async function toggleWatchAction(
  listingId: string,
): Promise<{ active?: boolean; error?: string }> {
  const me = await getSessionUser();
  if (!me) return { error: "Bitte zuerst anmelden." };

  const [exists] = await db
    .select({ id: listings.id, vehicleId: listings.vehicleId })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!exists) return { error: "Inserat nicht gefunden." };

  /*
   * Neu zu laden sind alle drei Seiten, auf denen der Zustand steht: die
   * Garage mit der Merkliste, der Marktplatz mit dem Herz auf jeder Karte und
   * die Fahrzeugseite mit dem Knopf. Vorher galt nur die Garage — wer aus dem
   * Marktplatz heraus merkte und zurückging, sah dort weiterhin ein leeres
   * Herz und hielt den Klick für verloren.
   */
  const neuLaden = () => {
    revalidatePath("/garage");
    revalidatePath("/markt");
    revalidatePath(`/auto/${exists.vehicleId}`);
  };

  const existing = await db
    .delete(watchlist)
    .where(and(eq(watchlist.userId, me.id), eq(watchlist.listingId, listingId)))
    .returning({ listingId: watchlist.listingId });

  if (existing.length) {
    neuLaden();
    return { active: false };
  }

  await db.insert(watchlist).values({ userId: me.id, listingId }).onConflictDoNothing();
  neuLaden();
  return { active: true };
}
