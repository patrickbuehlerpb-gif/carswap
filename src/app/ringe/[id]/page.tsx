import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RingDetail } from "@/components/ring-detail";
import { SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { getMyRingReviews, getRingForUser } from "@/lib/queries";
import { platformFee, stripeConfigured } from "@/lib/payments";
import { ringTransfers } from "@/lib/rings";

export const metadata: Metadata = { title: "Ringtausch" };
export const dynamic = "force-dynamic";

export default async function RingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ treuhand?: string }>;
}) {
  const { id } = await params;
  const { treuhand } = await searchParams;

  const me = await getSessionUser();
  if (!me) redirect(`/konto/anmelden?next=/ringe/${id}`);

  const ring = await getRingForUser(id, me.id);
  if (!ring) notFound();

  // Die Zahlungsgebühr hängt an Umgebungsvariablen und wird deshalb hier
  // gerechnet, nicht im Browser. Je Weg eine — wer zwei Beträge einzahlt,
  // trägt sie zweimal.
  const meineBewertungen =
    ring.status === "abgeschlossen"
      ? Object.fromEntries(await getMyRingReviews(id, me.id))
      : {};

  const gebuehren: Record<string, number> = {};
  for (const t of ringTransfers(
    ring.participants.map((p) => ({ userId: p.user.id, cash: p.cash })),
  )) {
    gebuehren[`${t.payerId}|${t.payeeId}`] = platformFee(Math.round(t.amount * 100));
  }

  return (
    <div>
      <nav className="mb-4 text-sm text-ink-3">
        <Link href="/deals" className="hover:text-ink">
          Tausche
        </Link>
        <span className="mx-2">/</span>
        <span className="text-ink-2">
          {ring.participants.map((p) => `${p.gives.make} ${p.gives.model}`).join(" → ")}
        </span>
      </nav>
      <SectionHead
        title="Ringtausch"
        sub="Drei Parteien, drei Fahrzeuge, ein Vorgang: A gibt an B, B an C, C an A. Der Ring kommt nur zustande, wenn alle drei zusagen — und wird nur abgeschlossen, wenn alle drei die Übergabe bestätigen."
      />
      <RingDetail
        ring={ring}
        meId={me.id}
        feesMinor={gebuehren}
        meineBewertungen={meineBewertungen}
        paymentsEnabled={stripeConfigured()}
        escrowNotice={
          treuhand === "ok"
            ? "Einzahlung bestätigt — der Betrag liegt auf dem Treuhandkonto."
            : treuhand === "abgebrochen"
              ? "Die Einzahlung wurde abgebrochen. Du kannst es jederzeit erneut versuchen."
              : null
        }
      />
    </div>
  );
}
