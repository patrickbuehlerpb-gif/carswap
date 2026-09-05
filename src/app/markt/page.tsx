import type { Metadata } from "next";
import Link from "next/link";
import { MarketBrowser } from "@/components/market-browser";
import { Card, SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import {
  MARKTPOOL_LIMIT,
  countActiveListings,
  countMyActiveListings,
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
  const [pool, gesamt, myVehicles, watchlist, eigeneAktiv] = await Promise.all([
    getActiveListings(me?.id),
    countActiveListings(me?.id),
    me ? getMyVehicles(me.id) : Promise.resolve([]),
    me ? getWatchlistIds(me.id) : Promise.resolve([]),
    me ? countMyActiveListings(me.id) : Promise.resolve(0),
  ]);

  return (
    <div>
      <SectionHead
        title="Marktplatz"
        sub={
          // Solange nichts dasteht, wäre jede Erklärung zur Zuzahlung ein
          // Versprechen auf eine Rechnung, die es gerade nicht gibt.
          pool.length === 0
            ? "Alle Autos, die zum Tausch stehen."
            : myVehicles.length
              ? "Alle Autos, die zum Tausch stehen. Jede Zuzahlung ist gegen dein ausgewähltes Auto gerechnet. Du siehst also immer, was dich ein Tausch unter dem Strich kostet."
              : "Alle Autos, die zum Tausch stehen. Stell dein eigenes ein, dann rechnen wir jede Zuzahlung direkt dagegen."
        }
      />

      {pool.length === 0 ? (
        /*
         * Tag eins. Der Marktplatz ist am Anfang leer, und wer selbst schon
         * ein Auto eingestellt hat, bekam trotzdem «Sei der Erste» zu lesen —
         * eine Aufforderung zu etwas, das er gerade getan hatte. Die beiden
         * Fälle sagen deshalb Verschiedenes: der eine, was zu tun ist, der
         * andere, dass nichts zu tun ist.
         */
        <Card className="p-12 text-center">
          {eigeneAktiv > 0 ? (
            <>
              {/*
               * Nicht «dein Auto steht hier»: Der Marktplatz zeigt die eigenen
               * Inserate absichtlich nie — deshalb ist er für die erste Person
               * überhaupt leer. Wer hier nach seinem Auto sucht und es nicht
               * findet, hält es für verschwunden.
               */}
              <h2 className="text-base font-semibold text-ink">
                Ausser deinem steht noch kein Auto zum Tausch
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">
                Am Anfang ist ein Marktplatz leer; dagegen hilft kein Filter. Dein eigenes
                Inserat siehst du hier nie — es ist für die anderen da und in deiner{" "}
                <Link href="/garage" className="textlink">
                  Garage
                </Link>{" "}
                zu sehen. Wir rechnen jede Nacht neu und schreiben dir, sobald jemand ein Auto
                wie deines sucht — vorausgesetzt, deine Adresse ist bestätigt und die{" "}
                <Link href="/konto" className="textlink">
                  Treffermeldungen
                </Link>{" "}
                sind an. Du musst hier nicht täglich vorbeischauen.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-2">Aktuell steht kein Auto zum Tausch.</p>
              <Link
                href="/inserat/neu"
                className="mt-4 inline-block rounded-lg bg-marke px-5 py-2.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
              >
                Sei der Erste — Auto einstellen
              </Link>
            </>
          )}
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
