import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ValueChart } from "@/components/value-chart";
import { ValuationBreakdown } from "@/components/valuation-breakdown";
import { VehicleVisual } from "@/components/vehicle-visual";
import { Badge, Card, SectionHead, SpecRow } from "@/components/ui";
import { WatchButton } from "@/components/watch-button";
import { getUser } from "@/lib/data/users";
import {
  getListingByVehicle,
  getVehicle,
  myVehicleIds,
  requireVehicle,
  vehicles,
} from "@/lib/data/vehicles";
import { chf, dateLabel, km, label, relativeAge, vehicleFullTitle } from "@/lib/format";
import { cashDelta, fitsWish } from "@/lib/matching";
import { depreciationPerMonth, valuate, valueHistory } from "@/lib/valuation";

export function generateStaticParams() {
  return vehicles.map((v) => ({ id: v.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const v = getVehicle(id);
  return { title: v ? vehicleFullTitle(v) : "Fahrzeug" };
}

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vehicle = getVehicle(id);
  if (!vehicle) notFound();

  const listing = getListingByVehicle(vehicle.id);
  const owner = listing ? getUser(listing.ownerId) : null;
  const valuation = valuate(vehicle);
  const history = valueHistory(vehicle, 24, 18);
  const perMonth = depreciationPerMonth(vehicle);
  const isMine = myVehicleIds.includes(vehicle.id);

  // Wie würden meine eigenen Fahrzeuge in den Wunsch des Inserenten passen?
  const offers = myVehicleIds.map((mid) => {
    const mine = requireVehicle(mid);
    const fit = listing ? fitsWish(listing.wish, mine) : null;
    const cash = cashDelta(mine, vehicle, listing?.askPremium ?? 0);
    return { mine, fit, cash };
  });
  const best = offers.filter((o) => o.fit?.ok).sort((a, b) => a.cash.delta - b.cash.delta)[0];

  return (
    <div className="space-y-8">
      <nav className="text-sm text-mist-400">
        <Link href="/markt" className="hover:text-mist-200">
          Marktplatz
        </Link>
        <span className="mx-2">/</span>
        <span className="text-mist-200">{vehicleFullTitle(vehicle)}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        {/* --------------- Linke Spalte --------------- */}
        <div className="min-w-0 space-y-8">
          <div>
            <VehicleVisual
              id={vehicle.id}
              body={vehicle.body}
              className="aspect-[16/8] w-full rounded-xl border border-ink-800"
              label={`${vehicle.color} · ${vehicle.year}`}
            />
            <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-mist-100 sm:text-3xl">
                  {vehicle.make} {vehicle.model}
                </h1>
                <p className="mt-1 text-mist-400">{vehicle.trim}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {vehicle.accidentFree && <Badge tone="good">unfallfrei</Badge>}
                {vehicle.serviceHistory === "lückenlos scheckheft" && (
                  <Badge tone="good">Scheckheft</Badge>
                )}
                {vehicle.batterySoh !== undefined && (
                  <Badge tone={vehicle.batterySoh >= 95 ? "good" : "warn"}>
                    Batterie {vehicle.batterySoh} %
                  </Badge>
                )}
                {!vehicle.accidentFree && <Badge tone="bad">Vorschaden</Badge>}
                {listing && <WatchButton listingId={listing.id} />}
              </div>
            </div>
          </div>

          {vehicle.notes && (
            <Card className="p-5">
              <p className="text-[11px] uppercase tracking-wider text-mist-400">
                Beschreibung des Besitzers
              </p>
              <p className="mt-2 text-[15px] leading-relaxed text-mist-200">{vehicle.notes}</p>
            </Card>
          )}

          <section>
            <SectionHead title="Technische Daten" />
            <Card className="p-5">
              <div className="grid gap-x-8 sm:grid-cols-2">
                <div>
                  <SpecRow label="Erstzulassung" value={dateLabel(vehicle.firstRegistration)} />
                  <SpecRow label="Kilometerstand" value={km(vehicle.mileageKm)} />
                  <SpecRow label="Antriebsart" value={label.fuel(vehicle.fuel)} />
                  <SpecRow label="Antrieb" value={label.drive(vehicle.drivetrain)} />
                  <SpecRow label="Leistung" value={`${vehicle.powerPs} PS`} />
                  <SpecRow label="Karosserie" value={label.body(vehicle.body)} />
                </div>
                <div>
                  {vehicle.rangeKm && (
                    <SpecRow
                      label={vehicle.fuel === "hybrid" ? "Elektrische Reichweite" : "Reichweite WLTP"}
                      value={km(vehicle.rangeKm)}
                    />
                  )}
                  {vehicle.batterySoh !== undefined && (
                    <SpecRow label="Batteriezustand" value={`${vehicle.batterySoh} % SoH`} />
                  )}
                  <SpecRow label="Zustand" value={vehicle.condition} />
                  <SpecRow label="Serviceheft" value={vehicle.serviceHistory} />
                  <SpecRow label="Halter" value={vehicle.previousOwners} />
                  {vehicle.mfkUntil && <SpecRow label="MFK bis" value={dateLabel(vehicle.mfkUntil)} />}
                </div>
              </div>

              <div className="mt-5 border-t border-ink-800 pt-4">
                <p className="text-[11px] uppercase tracking-wider text-mist-400">Ausstattung</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {vehicle.features.map((f) => (
                    <Badge key={f}>{f}</Badge>
                  ))}
                </div>
              </div>

              {vehicle.defects?.length ? (
                <div className="mt-4 border-t border-ink-800 pt-4">
                  <p className="text-[11px] uppercase tracking-wider text-mist-400">
                    Angegebene Mängel
                  </p>
                  <ul className="mt-2 space-y-1">
                    {vehicle.defects.map((d) => (
                      <li key={d} className="text-sm text-amber-warn">
                        · {d}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          </section>

          <section>
            <SectionHead
              title="Wertverlauf"
              sub="Rückblick bis zur Erstzulassung und Prognose für die kommenden 18 Monate."
            />
            <Card className="p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-end gap-8">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-mist-400">Heutiger Wert</p>
                  <p className="mt-1 text-2xl font-semibold tabular text-mist-100">
                    {chf(valuation.value)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-mist-400">
                    Wertverlust pro Monat
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular text-bad">{chf(perMonth)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-mist-400">
                    Restwertquote
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular text-mist-100">
                    {Math.round((valuation.value / vehicle.listPriceNew) * 100)} %
                  </p>
                </div>
              </div>
              <ValueChart points={history} />
            </Card>
          </section>

          <section>
            <SectionHead
              title="Wie der Wert zustande kommt"
              sub="Jeder Faktor ist einzeln ausgewiesen — so lässt sich über den Preis diskutieren, statt über ein Bauchgefühl."
            />
            <Card className="p-5">
              <ValuationBreakdown vehicle={vehicle} valuation={valuation} />
            </Card>
          </section>
        </div>

        {/* --------------- Rechte Spalte --------------- */}
        <div className="min-w-0 space-y-5 lg:sticky lg:top-24 lg:self-start">
          {isMine ? (
            <Card className="p-5">
              <Badge tone="volt">Dein Fahrzeug</Badge>
              <p className="mt-3 text-sm text-mist-300">
                Dieses Fahrzeug steht in deiner Garage. Du kannst es als Tauschobjekt einsetzen.
              </p>
              <Link
                href="/matches"
                className="mt-4 block rounded-lg bg-volt-500 py-2.5 text-center text-sm font-semibold text-ink-950 transition-colors hover:bg-volt-400"
              >
                Passende Tausche anzeigen
              </Link>
            </Card>
          ) : (
            <>
              <Card className="p-5">
                <p className="text-[11px] uppercase tracking-wider text-mist-400">
                  Tausch gegen dein Fahrzeug
                </p>
                <div className="mt-3 space-y-2">
                  {offers.map((o) => (
                    <div
                      key={o.mine.id}
                      className={`rounded-lg border p-3 ${
                        o.fit?.ok
                          ? "border-volt-600/35 bg-volt-500/[0.06]"
                          : "border-ink-700 bg-ink-850"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium text-mist-100">
                          {o.mine.make} {o.mine.model}
                        </span>
                        <span
                          className={`text-sm font-semibold tabular ${
                            o.cash.delta > 0 ? "text-amber-warn" : "text-good"
                          }`}
                        >
                          {o.cash.delta > 0 ? "+" : "−"}
                          {chf(Math.abs(o.cash.delta))}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-mist-400">
                        {o.fit?.ok
                          ? `${owner?.name} sucht so ein Fahrzeug`
                          : (o.fit?.misses[0] ?? "passt nicht zur Wunschliste")}
                      </p>
                    </div>
                  ))}
                </div>
                <Link
                  href={`/tausch/${vehicle.id}${best ? `?mine=${best.mine.id}` : ""}`}
                  className="mt-4 block rounded-lg bg-volt-500 py-2.5 text-center text-sm font-semibold text-ink-950 transition-colors hover:bg-volt-400"
                >
                  Tausch vorschlagen
                </Link>
                <p className="mt-2 text-center text-[11px] text-mist-400">
                  Unverbindlich — der Betrag ist im nächsten Schritt verhandelbar.
                </p>
              </Card>

              {listing && owner && (
                <Card className="p-5">
                  <div className="flex items-center gap-3">
                    <span
                      className="grid h-10 w-10 place-items-center rounded-full text-sm font-semibold text-ink-950"
                      style={{ background: owner.avatarColor }}
                    >
                      {owner.name.slice(0, 1)}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-mist-100">{owner.name}</p>
                      <p className="text-xs text-mist-400">
                        {owner.location} ({owner.canton}) · {owner.swapsCompleted} Tausche
                      </p>
                    </div>
                    {owner.verified && (
                      <span className="ml-auto">
                        <Badge tone="good">verifiziert</Badge>
                      </span>
                    )}
                  </div>

                  <div className="mt-4 border-t border-ink-800 pt-4">
                    <p className="text-[11px] uppercase tracking-wider text-mist-400">
                      Sucht im Tausch
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {listing.wish.makes.map((m) => (
                        <Badge key={m}>{m}</Badge>
                      ))}
                      {listing.wish.bodies.map((b) => (
                        <Badge key={b} tone="info">
                          {label.body(b)}
                        </Badge>
                      ))}
                      {listing.wish.fuels.map((f) => (
                        <Badge key={f} tone="info">
                          {label.fuel(f)}
                        </Badge>
                      ))}
                    </div>
                    <dl className="mt-3 space-y-1 text-xs text-mist-400">
                      {listing.wish.minYear && <p>Baujahr ab {listing.wish.minYear}</p>}
                      {listing.wish.maxMileageKm && (
                        <p>Höchstens {km(listing.wish.maxMileageKm)}</p>
                      )}
                      {listing.wish.maxCashOut !== undefined && (
                        <p>
                          {listing.wish.maxCashOut >= 0
                            ? `Zahlt bis zu ${chf(listing.wish.maxCashOut)} drauf`
                            : `Erwartet mindestens ${chf(Math.abs(listing.wish.maxCashOut))} Ausgleich`}
                        </p>
                      )}
                    </dl>
                    {listing.wish.notes && (
                      <p className="mt-3 rounded-md bg-ink-850 p-2.5 text-xs italic text-mist-300">
                        «{listing.wish.notes}»
                      </p>
                    )}
                  </div>

                  <p className="mt-4 border-t border-ink-800 pt-3 text-[11px] text-mist-400 tabular">
                    Inseriert {relativeAge(listing.createdAt)} · {listing.views} Aufrufe
                  </p>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
