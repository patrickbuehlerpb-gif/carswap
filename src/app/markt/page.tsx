import type { Metadata } from "next";
import Link from "next/link";
import { MarketBrowser } from "@/components/market-browser";
import { Card, SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import {
  MARKTPOOL_LIMIT,
  countActiveListings,
  getActiveListings,
  getMyVehicles,
  getWatchlistIds,
} from "@/lib/queries";

export const metadata: Metadata = {
  title: "Marktplatz",
  description:
    "Alle Autos, die zum Tausch stehen. Angemeldet rechnen wir jede Zuzahlung direkt gegen dein eigenes.",
};
export const dynamic = "force-dynamic";

export default async function MarktPage() {
  const me = await getSessionUser();
  const [pool, gesamt, myVehicles, watchlist] = await Promise.all([
    getActiveListings(me?.id),
    countActiveListings(me?.id),
    me ? getMyVehicles(me.id) : Promise.resolve([]),
    me ? getWatchlistIds(me.id) : Promise.resolve([]),
  ]);

  return (
    <div>
      <SectionHead
        title="Marktplatz"
        sub={
          myVehicles.length
            ? "Alle Autos, die zum Tausch stehen. Jede Zuzahlung ist gegen dein ausgewähltes Auto gerechnet. Du siehst also immer, was dich ein Tausch unter dem Strich kostet."
            : "Alle Autos, die zum Tausch stehen. Stell dein eigenes ein, dann rechnen wir jede Zuzahlung direkt dagegen."
        }
      />

      {pool.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-sm text-ink-2">Aktuell steht kein Auto zum Tausch.</p>
          <Link
            href="/inserat/neu"
            className="mt-4 inline-block rounded-lg bg-marke px-5 py-2.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
          >
            Sei der Erste — Auto einstellen
          </Link>
        </Card>
      ) : (
        <>
          {gesamt > pool.length && (
            <p className="mb-4 rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-xs text-ink-2">
              Es stehen {gesamt} Autos zum Tausch. Angezeigt werden die {MARKTPOOL_LIMIT}{" "}
              neuesten; die Filter arbeiten innerhalb dieser Auswahl.
            </p>
          )}
          <MarketBrowser
            pool={pool}
            myVehicles={myVehicles}
            watchlist={watchlist}
            signedIn={Boolean(me)}
          />
        </>
      )}
    </div>
  );
}
