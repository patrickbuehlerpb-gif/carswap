"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import {
  connectOnboardingUrl,
  ensureConnectAccount,
  refreshPayoutStatus,
  stripeConfigured,
} from "@/lib/payments";

export interface AccountResult {
  ok?: boolean;
  error?: string;
  notice?: string;
  redirectTo?: string;
}

const profileSchema = z.object({
  name: z.string().trim().min(2, "Bitte den Namen angeben.").max(80),
  location: z.string().trim().max(80),
  canton: z.string().trim().max(2),
  phone: z.string().trim().max(30).optional(),
});

export async function updateProfileAction(
  _prev: AccountResult,
  formData: FormData,
): Promise<AccountResult> {
  const me = await requireUser();
  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    location: formData.get("location") ?? "",
    canton: formData.get("canton") ?? "",
    phone: formData.get("phone") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Eingaben unvollständig." };

  await db
    .update(users)
    .set({
      name: parsed.data.name,
      location: parsed.data.location,
      canton: parsed.data.canton.toUpperCase(),
      phone: parsed.data.phone || null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, me.id));

  revalidatePath("/konto");
  revalidatePath("/garage");
  return { notice: "Profil gespeichert." };
}

/**
 * Startet oder setzt das Stripe-Connect-Onboarding fort. Ohne dieses Konto
 * kann die Gegenseite eine Ausgleichszahlung nicht empfangen.
 */
export async function startPayoutOnboardingAction(): Promise<AccountResult> {
  const me = await requireUser();
  if (!stripeConfigured()) {
    return { error: "Auszahlungen sind auf dieser Installation noch nicht eingerichtet." };
  }
  try {
    const accountId = await ensureConnectAccount(me.id, me.email);
    const url = await connectOnboardingUrl(accountId);
    return { ok: true, redirectTo: url };
  } catch (err) {
    console.error("Connect-Onboarding fehlgeschlagen:", err);
    return { error: "Das Auszahlungskonto konnte nicht angelegt werden. Bitte später erneut." };
  }
}

export async function refreshPayoutStatusAction(): Promise<AccountResult> {
  const me = await requireUser();
  if (!stripeConfigured() || !me.stripeAccountId) return { ok: true };
  try {
    const enabled = await refreshPayoutStatus(me.id);
    revalidatePath("/konto");
    return { ok: true, notice: enabled ? "Auszahlungen sind freigeschaltet." : undefined };
  } catch (err) {
    console.error("Statusabfrage fehlgeschlagen:", err);
    return { error: "Der Status konnte nicht abgefragt werden." };
  }
}
