import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DealList } from "@/components/deal-list";
import { Card, SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { getDealsForUser } from "@/lib/queries";

export const metadata: Metadata = { title: "Tausche" };
export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const me = await getSessionUser();
  if (!me) redirect("/konto/anmelden?next=/deals");

  const deals = await getDealsForUser(me.id);

  return (
    <div>
      <SectionHead
        title="Deine Tausche"
        sub="Jeder Vorgang durchläuft dieselben Stationen: Vorschlag, Verhandlung, Zusage, Treuhand und Übergabe. Beträge sind bis zur Zusage jederzeit verhandelbar."
      />
      {deals.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-sm text-ink-2">Noch keine Tauschvorgänge.</p>
          <Link
            href="/matches"
            className="mt-4 inline-block rounded-lg bg-volt px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-volt-hi"
          >
            Passende Fahrzeuge suchen
          </Link>
        </Card>
      ) : (
        <DealList deals={deals} />
      )}
    </div>
  );
}
