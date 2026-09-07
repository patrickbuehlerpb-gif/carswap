import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DealDetail } from "@/components/deal-detail";
import { KontaktKarte } from "@/components/kontakt-karte";
import { SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { getDealKontakte, getDealForUser, getMyReviewForDeal } from "@/lib/queries";
import { currentMonth } from "@/lib/valuation";
import {
  currentDealPayment,
  platformFee,
  stripeConfigured,
  zahlungBrauchbar,
} from "@/lib/payments";

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
  if (!me) redirect(`/konto/anmelden?next=/deals/${encodeURIComponent(id)}`);

  const detail = await getDealForUser(id, me.id);
  if (!detail) notFound();

  const meineBewertung =
    detail.deal.status === "abgeschlossen" ? await getMyReviewForDeal(id, me.id) : null;
  const kontakte = await getDealKontakte(id, me.id);

  /*
   * Dieselbe Zeile, mit der auch abgerechnet wird — nicht einfach die
   * jüngste: nach einem abgebrochenen zweiten Anlauf wäre das die stornierte,
   * und die Seite behauptete dann, das reservierte Geld sei weg.
   */
  const payment = await currentDealPayment(id);
  const geldLiegt = zahlungBrauchbar(payment);

  /*
   * Der Rückkehrparameter sagt nur, woher jemand kommt — nicht, ob Geld liegt.
   * Er steht in einer Adresse, die sich jede und jeder eintippen kann, und
   * selbst nach einer echten Zahlung ist Stripes Rückleitung meist vor unserem
   * Webhook da. Was hier steht, entscheidet deshalb der Zustand der Zahlung;
   * früher stand «liegt jetzt bei uns» allein aufgrund der Adresse — und die
   * Gegenseite hätte darauf ihr Auto übergeben.
   */
  const escrowNotice =
    treuhand === "ok"
      ? geldLiegt
        ? "Danke. Der Betrag ist hinterlegt und liegt jetzt bei uns."
        : "Danke. Wir warten noch auf die Bestätigung der Bank — das dauert meist ein paar " +
          "Sekunden. Lade die Seite gleich neu."
      : treuhand === "abgebrochen"
        ? "Die Einzahlung wurde abgebrochen. Du kannst es jederzeit erneut versuchen."
        : null;

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
        sub="Verhandeln, zusagen, Geld hinterlegen, übergeben. Alles an einem Ort, mit Checkliste für den Halterwechsel."
      />
      <DealDetail
        detail={detail}
        meId={me.id}
        payment={
          payment && {
            status: payment.status,
            amountMinor: payment.amountMinor,
            feeMinor: payment.feeMinor,
            payerId: payment.payerId,
            payeeId: payment.payeeId,
          }
        }
        geldLiegt={geldLiegt}
        escrowFeeMinor={platformFee(Math.round(Math.abs(detail.deal.cashDelta) * 100))}
        paymentsEnabled={stripeConfigured()}
        meineBewertung={meineBewertung}
        escrowNotice={escrowNotice}
        asOf={currentMonth()}
      />
      <KontaktKarte kontakte={kontakte} />
    </div>
  );
}
