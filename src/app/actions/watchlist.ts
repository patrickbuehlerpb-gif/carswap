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
    .select({ id: listings.id })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!exists) return { error: "Inserat nicht gefunden." };

  const existing = await db
    .delete(watchlist)
    .where(and(eq(watchlist.userId, me.id), eq(watchlist.listingId, listingId)))
    .returning({ listingId: watchlist.listingId });

  if (existing.length) {
    revalidatePath("/garage");
    return { active: false };
  }

  await db.insert(watchlist).values({ userId: me.id, listingId }).onConflictDoNothing();
  revalidatePath("/garage");
  return { active: true };
}
