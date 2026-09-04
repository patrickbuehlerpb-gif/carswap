import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DealDetail } from "@/components/deal-detail";
import { SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { getDealForUser, getMyReviewForDeal } from "@/lib/queries";
import { db } from "@/lib/db";
import { payments } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { currentMonth } from "@/lib/valuation";
import { platformFee, stripeConfigured } from "@/lib/payments";

export const metadata: Metadata = { title: "Tauschvorgang" };
export const dynamic = "force-dynamic";

export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ treuhand?: string }>;
}) {
  const { id } = await params;
  const { treuhand } = await searchParams;

  const me = await getSessionUser();
  if (!me) redirect(`/konto/anmelden?next=/deals/${id}`);

  const detail = await getDealForUser(id, me.id);
  if (!detail) notFound();

  const meineBewertung =
    detail.deal.status === "abgeschlossen" ? await getMyReviewForDeal(id, me.id) : null;

  const [payment] = await db
    .select({
      status: payments.status,
      amountMinor: payments.amountMinor,
      feeMinor: payments.feeMinor,
      payerId: payments.payerId,
      payeeId: payments.payeeId,
    })
    .from(payments)
    .where(eq(payments.dealId, id))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  return (
    <div>
      <nav className="mb-4 text-sm text-ink-3">
        <Link href="/deals" className="hover:text-ink">
          Tausche
        </Link>
        <span className="mx-2">/</span>
        <span className="text-ink-2">
          {detail.fromVehicle.make} {detail.fromVehicle.model} ⇄ {detail.toVehicle.make}{" "}
          {detail.toVehicle.model}
        </span>
      </nav>
      <SectionHead
        title="Tauschvorgang"
        sub="Verhandlung, Zusage, Treuhand und Übergabe an einem Ort — inklusive Checkliste für den Halterwechsel."
      />
      <DealDetail
        detail={detail}
        meId={me.id}
        payment={payment ?? null}
        escrowFeeMinor={platformFee(Math.round(Math.abs(detail.deal.cashDelta) * 100))}
        paymentsEnabled={stripeConfigured()}
        meineBewertung={meineBewertung}
        escrowNotice={
          treuhand === "ok"
            ? "Einzahlung bestätigt — der Betrag liegt auf dem Treuhandkonto."
            : treuhand === "abgebrochen"
              ? "Die Einzahlung wurde abgebrochen. Du kannst es jederzeit erneut versuchen."
              : null
        }
        asOf={currentMonth()}
      />
    </div>
  );
}
