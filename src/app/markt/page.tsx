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

export const metadata: Metadata = { title: "Marktplatz" };
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
            ? "Alle Fahrzeuge, die zum Tausch stehen. Die Zuzahlung wird laufend gegen dein ausgewähltes Fahrzeug gerechnet — du siehst also immer, was ein Tausch dich unter dem Strich kostet."
            : "Alle Fahrzeuge, die zum Tausch stehen. Sobald du dein eigenes Fahrzeug einstellst, rechnen wir jede Zuzahlung direkt dagegen."
        }
      />

      {pool.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-sm text-ink-2">Aktuell steht kein Fahrzeug zum Tausch.</p>
          <Link
            href="/inserat/neu"
            className="mt-4 inline-block rounded-lg bg-marke px-5 py-2.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
          >
            Sei der Erste — Fahrzeug einstellen
          </Link>
        </Card>
      ) : (
        <>
          {gesamt > pool.length && (
            <p className="mb-4 rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-xs text-ink-2">
              Es stehen {gesamt} Fahrzeuge zum Tausch. Angezeigt werden die {MARKTPOOL_LIMIT}{" "}
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
