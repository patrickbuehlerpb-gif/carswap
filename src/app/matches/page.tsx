import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MatchFinder } from "@/components/match-finder";
import { Card, SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { getActiveListings, getMyListings, getMyVehicles, getPublicUser } from "@/lib/queries";

export const metadata: Metadata = { title: "Matches" };
export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  const me = await getSessionUser();
  if (!me) redirect("/konto/anmelden?next=/matches");

  const [pool, myVehicles, myListings, publicMe] = await Promise.all([
    getActiveListings(me.id),
    getMyVehicles(me.id),
    getMyListings(me.id),
    getPublicUser(me.id),
  ]);

  const myPremiums = Object.fromEntries(
    myListings.map((l) => [l.listing.vehicleId, l.listing.askPremium ?? 0]),
  );

  return (
    <div>
      <SectionHead
        title="Passende Tausche"
        sub="Ein Tausch kommt nur zustande, wenn beide Seiten wollen. Deshalb wird hier nicht nur gefiltert, was dir gefällt, sondern auch, wer dein Fahrzeug sucht — und wenn es direkt nicht passt, über wen es doch geht."
      />
      {myVehicles.length === 0 || !publicMe ? (
        <Card className="p-12 text-center">
          <h2 className="text-base font-semibold text-ink">Noch kein Fahrzeug hinterlegt</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">
            Das Matching braucht dein Fahrzeug, um Wertdifferenz und Passung zu berechnen. Stelle es
            ein — das dauert wenige Minuten.
          </p>
          <Link
            href="/inserat/neu"
            className="mt-5 inline-block rounded-lg bg-volt px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-volt-hi"
          >
            Fahrzeug anbieten
          </Link>
        </Card>
      ) : (
        <MatchFinder pool={pool} myVehicles={myVehicles} myPremiums={myPremiums} me={publicMe} />
      )}
    </div>
  );
}
