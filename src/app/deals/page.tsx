import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DealList } from "@/components/deal-list";
import { RingList } from "@/components/ring-list";
import { Card, SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { getDealsForUser, getRingsForUser } from "@/lib/queries";

export const metadata: Metadata = { title: "Tausche" };
export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const me = await getSessionUser();
  if (!me) redirect("/konto/anmelden?next=/deals");

  const [deals, rings] = await Promise.all([getDealsForUser(me.id), getRingsForUser(me.id)]);

  return (
    <div>
      <SectionHead
        title="Deine Tausche"
        sub="Tausche zu zweit und zu dritt an einem Ort. Beide laufen gleich ab: Vorschlag, Zusage, Geld hinterlegen, übergeben. Zu zweit könnt ihr über den Betrag verhandeln, im Ring ergibt er sich aus den Werten der drei Autos."
      />
      {deals.length === 0 && rings.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-sm text-ink-2">Noch keine Tausche.</p>
          <Link
            href="/matches"
            className="mt-4 inline-block rounded-lg bg-marke px-5 py-2.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
          >
            Passende Autos suchen
          </Link>
        </Card>
      ) : (
        <div className="space-y-10">
          {rings.length > 0 && (
            <section>
              <h2 className="mb-1 text-sm font-semibold text-ink">
                Ringtausche <span className="text-ink-3 tabular">({rings.length})</span>
              </h2>
              <p className="mb-3 text-xs text-ink-3">
                Zu dritt: dein Auto geht an die eine Person, du bekommst das der anderen.
              </p>
              <RingList rings={rings} meId={me.id} />
            </section>
          )}
          {deals.length > 0 && (
            <section>
              {rings.length > 0 && (
                <h2 className="mb-3 text-sm font-semibold text-ink">
                  Direkte Tausche <span className="text-ink-3 tabular">({deals.length})</span>
                </h2>
              )}
              <DealList deals={deals} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
