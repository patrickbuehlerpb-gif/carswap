import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MatchFinder } from "@/components/match-finder";
import { Card, SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { getActiveListings, getMyVehicles, getPublicUser } from "@/lib/queries";

export const metadata: Metadata = { title: "Treffer" };
export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  const me = await getSessionUser();
  if (!me) redirect("/konto/anmelden?next=/matches");

  const [pool, myVehicles, publicMe] = await Promise.all([
    getActiveListings(me.id),
    getMyVehicles(me.id),
    getPublicUser(me.id),
  ]);

  return (
    <div>
      <SectionHead
        title="Passende Tausche"
        sub="Ein Tausch klappt nur, wenn beide wollen. Deshalb zeigen wir dir nicht nur, was dir gefällt, sondern auch, wer dein Auto sucht. Und wenn es zu zweit nicht aufgeht, wer als Dritter dazwischen passt."
      />
      {myVehicles.length === 0 || !publicMe ? (
        <Card className="p-12 text-center">
          <h2 className="text-base font-semibold text-ink">Du hast noch kein Auto eingestellt</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">
            Ohne dein Auto können wir nichts rechnen und nichts vergleichen. Stell es ein, das
            dauert ein paar Minuten.
          </p>
          <Link
            href="/inserat/neu"
            className="mt-5 inline-block rounded-lg bg-marke px-5 py-2.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
          >
            Auto anbieten
          </Link>
        </Card>
      ) : (
        <MatchFinder pool={pool} myVehicles={myVehicles} me={publicMe} />
      )}
    </div>
  );
}
