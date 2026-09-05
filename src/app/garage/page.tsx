import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ValueChart } from "@/components/value-chart";
import { VehicleCard } from "@/components/vehicle-card";
import { VehicleVisual } from "@/components/vehicle-visual";
import { Badge, Card, SectionHead, SpecRow } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { chf, dateLabel, km, label } from "@/lib/format";
import { findMatches } from "@/lib/matching";
import {
  getActiveListings,
  getMyListings,
  getMyVehicles,
  getPublicUser,
  getWatchlist,
} from "@/lib/queries";
import { currentMonth, depreciationPerMonth, valuate, valueHistory } from "@/lib/valuation";
import { ResendVerification } from "@/components/account-widgets";

export const metadata: Metadata = { title: "Garage" };
export const dynamic = "force-dynamic";

export default async function GaragePage({
  searchParams,
}: {
  searchParams: Promise<{ willkommen?: string }>;
}) {
  const me = await getSessionUser();
  if (!me) redirect("/konto/anmelden?next=/garage");
  const { willkommen } = await searchParams;

  const asOf = currentMonth();
  const [myVehicles, myListings, watchlist, pool, profile] = await Promise.all([
    getMyVehicles(me.id),
    getMyListings(me.id),
    getWatchlist(me.id),
    getActiveListings(me.id),
    getPublicUser(me.id),
  ]);

  const listingByVehicle = new Map(myListings.map((l) => [l.vehicle.id, l.listing]));
  const total = myVehicles.reduce((s, v) => s + valuate(v, asOf).value, 0);
  const totalLoss = myVehicles.reduce((s, v) => s + depreciationPerMonth(v, asOf), 0);

  return (
    <div className="space-y-10">
      <SectionHead
        title="Deine Garage"
        sub={`${me.name}${me.location ? ` · ${me.location}` : ""} · Mitglied seit ${
          profile ? dateLabel(profile.memberSince) : "heute"
        }`}
        action={
          <Link
            href="/inserat/neu"
            className="rounded-lg bg-marke px-4 py-2 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
          >
            Auto hinzufügen
          </Link>
        }
      />

      {willkommen && (
        <Card className="border-marke/40 bg-marke/20 p-5">
          <h2 className="text-base font-semibold text-ink">Willkommen bei quitt</h2>
          <p className="mt-1 text-sm text-ink-2">
            Stell als Nächstes dein Auto ein. Dann suchen wir passende Tauschpartner für dich.
            Wir haben dir ausserdem eine E-Mail geschickt, um deine Adresse zu bestätigen.
          </p>
        </Card>
      )}

      {!me.emailVerified && <ResendVerification />}

      <Card className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
        <Summary label="Autos" value={String(myVehicles.length)} />
        <Summary label="Gesamtwert" value={chf(total)} />
        <Summary label="Wertverlust / Monat" value={chf(totalLoss)} tone="bad" />
        <Summary
          label="Bewertung"
          value={profile?.rating !== null && profile ? `${profile.rating.toFixed(1)} ★` : "—"}
        />
      </Card>

      {myVehicles.length === 0 ? (
        <Card className="p-12 text-center">
          <h2 className="text-base font-semibold text-ink">Deine Garage ist noch leer</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">
            Sobald dein Auto drin ist, siehst du hier seinen Wertverlauf und passende Tausche.
          </p>
          <Link
            href="/inserat/neu"
            className="mt-5 inline-block rounded-lg bg-marke px-5 py-2.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
          >
            Auto einstellen
          </Link>
        </Card>
      ) : (
        <div className="space-y-8">
          {myVehicles.map((v) => {
            const val = valuate(v, asOf);
            const history = valueHistory(v, 18, 12, asOf);
            const perMonth = depreciationPerMonth(v, asOf);
            const best = findMatches(v, pool, {}).slice(0, 3);
            const listing = listingByVehicle.get(v.id);

            return (
              <Card key={v.id} className="overflow-hidden">
                <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,300px)_1fr]">
                  <div className="min-w-0">
                    <VehicleVisual
                      id={v.id}
                      body={v.body}
                      className="aspect-[16/9] w-full rounded-lg"
                      label={`${v.year} · ${label.fuel(v.fuel)}`}
                    />
                    <div className="mt-4 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-lg display text-ink">
                          {v.make} {v.model}
                        </h3>
                        <p className="truncate text-sm text-ink-3">{v.trim}</p>
                      </div>
                      {listing && (
                        <Badge tone={listing.status === "aktiv" ? "good" : "neutral"}>
                          {listing.status === "aktiv" ? "inseriert" : listing.status}
                        </Badge>
                      )}
                    </div>

                    <div className="mt-4">
                      <SpecRow label="Kilometerstand" value={km(v.mileageKm)} />
                      <SpecRow label="Erstzulassung" value={dateLabel(v.firstRegistration)} />
                      <SpecRow label="Zustand" value={v.condition} />
                      {v.batterySoh != null && (
                        <SpecRow label="Batterie" value={`${v.batterySoh} % SoH`} />
                      )}
                      {v.mfkUntil && <SpecRow label="MFK bis" value={dateLabel(v.mfkUntil)} />}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        href={`/inserat/${v.id}/bearbeiten`}
                        className="rounded-lg border border-line-strong px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                      >
                        Bearbeiten
                      </Link>
                      <Link
                        href={`/auto/${v.id}`}
                        className="rounded-lg border border-line-strong px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                      >
                        Inserat ansehen
                      </Link>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-end gap-8">
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-ink-3">
                          Aktueller Wert
                        </p>
                        <p className="mt-1 text-3xl betrag text-ink">
                          {chf(val.value)}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-3 tabular">
                          {chf(val.low)} – {chf(val.high)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-ink-3">pro Monat</p>
                        <p className="mt-1 text-xl font-semibold tabular text-bad">
                          {chf(perMonth)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-ink-3">
                          vom Neupreis
                        </p>
                        <p className="mt-1 text-xl font-semibold tabular text-ink">
                          {Math.round((val.value / v.listPriceNew) * 100)} %
                        </p>
                      </div>
                    </div>

                    <div className="mt-5">
                      <ValueChart points={history} />
                    </div>

                    {best.length > 0 && (
                      <div className="mt-6 border-t border-line pt-4">
                        <p className="text-[11px] uppercase tracking-wider text-ink-3">
                          Beste Tauschmöglichkeiten
                        </p>
                        <ul className="mt-3 space-y-2">
                          {best.map((m) => (
                            <li key={m.vehicle.id}>
                              <Link
                                href={`/tausch/${m.vehicle.id}?mine=${v.id}`}
                                className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-2.5 transition-colors hover:border-line-strong"
                              >
                                <VehicleVisual
                                  id={m.vehicle.id}
                                  body={m.vehicle.body}
                                  className="h-10 w-16 shrink-0 rounded"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm text-ink">
                                    {m.vehicle.make} {m.vehicle.model}
                                  </span>
                                  <span className="block truncate text-xs text-ink-3">
                                    {m.owner.location || m.owner.name} · Score {m.score}
                                  </span>
                                </span>
                                {m.mutual && <Badge tone="marke">beidseitig</Badge>}
                                <span className="shrink-0 text-right text-sm">
                                  <span className="block text-[10px] uppercase tracking-wider text-ink-3">
                                    {m.cashDelta > 0 ? "du zahlst" : "du erhältst"}
                                  </span>
                                  <span
                                    className={`font-semibold tabular ${
                                      m.cashDelta > 0 ? "text-warn" : "text-good"
                                    }`}
                                  >
                                    {chf(Math.abs(m.cashDelta))}
                                  </span>
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <section>
        <SectionHead
          title="Merkliste"
          sub="Autos, die du dir gemerkt hast. Den Ausgleich rechnen wir laufend neu."
          action={
            <Link href="/markt" className="text-sm text-marke hover:underline">
              Weitere Autos →
            </Link>
          }
        />
        {watchlist.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong p-10 text-center text-sm text-ink-3">
            Noch nichts gemerkt. Auf jedem Inserat findest du oben rechts «merken».
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {watchlist.map((l) => (
              <VehicleCard
                key={l.listing.id}
                vehicle={l.vehicle}
                listing={l.listing}
                owner={l.owner}
                watched
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Summary({ label: l, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="border-b border-line p-5 last:border-0 sm:border-b-0">
      <p className="text-[11px] uppercase tracking-wider text-ink-3">{l}</p>
      <p className={`mt-1 text-2xl betrag ${tone === "bad" ? "text-bad" : "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}
