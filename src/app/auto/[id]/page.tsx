import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ValueChart } from "@/components/value-chart";
import { ValuationBreakdown } from "@/components/valuation-breakdown";
import { FotoGalerie } from "@/components/foto-galerie";
import { Badge, Card, SectionHead, SpecRow } from "@/components/ui";
import { WatchButton } from "@/components/watch-button";
import { Sterne } from "@/components/review-form";
import { ReportButton } from "@/components/report-button";
import { getSessionUser } from "@/lib/auth/session";
import {
  countListingView,
  getListingByVehicle,
  getMyVehicles,
  getPublicVehicle,
  getReviewsAbout,
  getVehicle,
  getWatchlistIds,
} from "@/lib/queries";
import { chf, dateLabel, km, label, relativeAge, vehicleFullTitle } from "@/lib/format";
import { cashDelta, fitsWish } from "@/lib/matching";
import {
  currentMonth,
  depreciationPerMonth,
  valuate,
  valueAt,
  valueHistory,
} from "@/lib/valuation";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const v = await getPublicVehicle(id);
  if (!v) return { title: "Auto" };

  const titel = vehicleFullTitle(v);
  const beschreibung = [
    `${v.year}`,
    // km() bringt die Einheit schon mit.
    km(v.mileageKm),
    label.fuel(v.fuel),
    `Wert ${chf(valueAt(v))}`,
  ].join(" · ");

  /*
   * Das erste Foto ist das Vorschaubild. Ohne Foto das Bild der Seite —
   * ausdrücklich genannt, nicht geerbt: sobald eine Seite eigene
   * Open-Graph-Angaben setzt, ersetzen sie die des Layouts vollständig, und
   * das Inserat stünde ganz ohne Vorschau da.
   *
   * Die schematische Silhouette kommt hier bewusst nicht vor. Auf der Seite
   * ist sie ein ehrlicher Platzhalter; in einer Chatvorschau, wo daneben nur
   * «Cupra Born» steht, sähe sie aus wie ein Foto des Autos.
   */
  const foto = v.photos?.[0];

  return {
    title: titel,
    description: beschreibung,
    /*
     * Dieselbe Seite wird unter zwei Adressen ausgeliefert: unter der eigenen
     * Domain und unter der, die der Anbieter dem Projekt gegeben hat. Ohne
     * diesen Verweis sind das für eine Suchmaschine zwei Seiten mit demselben
     * Inhalt, die einander Rang wegnehmen. Aufgelöst wird er gegen
     * `metadataBase`, also gegen SITE_URL.
     */
    alternates: { canonical: `/auto/${v.id}` },
    openGraph: {
      type: "article",
      title: `${titel} — zum Tausch`,
      description: beschreibung,
      images: foto
        ? [{ url: foto.url, width: foto.width, height: foto.height, alt: titel }]
        : [{ url: "/opengraph-image", width: 1200, height: 630, alt: "autotauschen" }],
    },
  };
}

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getSessionUser();
  // Archivierte Autos sieht nur noch, wem sie gehören.
  const vehicle = me ? await getVehicle(id) : await getPublicVehicle(id);
  if (!vehicle) notFound();
  if (vehicle.archivedAt && vehicle.ownerId !== me?.id) notFound();

  const view = await getListingByVehicle(vehicle.id);
  const listing = view?.listing ?? null;
  const owner = view?.owner ?? null;
  const isMine = me?.id === vehicle.ownerId;

  /*
   * Ein gesperrtes Inserat hat die Betreiberin nach einer bestätigten Meldung
   * aus dem Verkehr gezogen. Es blieb hier trotzdem vollständig lesbar — unter
   * einer Adresse, die in der Sitemap steht. Wem es gehört, sieht es weiter;
   * für alle anderen gibt es die Seite nicht mehr.
   */
  if (listing?.blockedAt && !isMine) notFound();

  /*
   * Pausiert, in Verhandlung, getauscht: das Auto steht dann nicht zum Tausch.
   * Vorher zeigte die Seite unverändert «Tausch vorschlagen» — der Knopf führte
   * auf /tausch/<id>, das mit 404 endet. Ein Versprechen, das ins Leere läuft.
   */
  const handelbar = listing?.status === "aktiv";
  const nichtHandelbarGrund =
    !listing || handelbar
      ? null
      : listing.status === "in verhandlung"
        ? "Über dieses Auto wird gerade verhandelt. Kommt der Tausch nicht zustande, steht es wieder zur Verfügung."
        : listing.status === "getauscht"
          ? "Dieses Auto ist getauscht und steht nicht mehr zur Verfügung."
          : "Der Besitzer hat dieses Inserat pausiert. Es steht gerade nicht zum Tausch.";

  const [myVehicles, watchlist, bewertungen] = await Promise.all([
    me && !isMine ? getMyVehicles(me.id) : Promise.resolve([]),
    me ? getWatchlistIds(me.id) : Promise.resolve([]),
    owner ? getReviewsAbout(owner.id, 3) : Promise.resolve([]),
  ]);

  // Aufrufe nur von Fremden zählen
  if (listing && !isMine) await countListingView(listing.id);

  const asOf = currentMonth();
  // Stichtag für relative Zeitangaben — serverseitig gebildet, damit die
  // Angabe nicht mit der Uhr des Browsers auseinanderläuft.
  const heute = new Date().toISOString().slice(0, 10);
  const valuation = valuate(vehicle, asOf);
  const history = valueHistory(vehicle, 24, 18, asOf);
  const perMonth = depreciationPerMonth(vehicle, asOf);

  // Wie würden meine eigenen Autos in den Wunsch des Inserenten passen?
  const offers = myVehicles.map((mine) => {
    const fit = listing ? fitsWish(listing.wish, mine) : null;
    const cash = cashDelta(mine, vehicle, listing?.askPremium ?? 0);
    return { mine, fit, cash };
  });
  const best = offers.filter((o) => o.fit?.ok).sort((a, b) => a.cash.delta - b.cash.delta)[0];

  return (
    <div className="space-y-8">
      <nav className="text-sm text-ink-3">
        <Link href="/markt" className="hover:text-ink-2">
          Marktplatz
        </Link>
        <span className="mx-2">/</span>
        <span className="text-ink-2">{vehicleFullTitle(vehicle)}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        {/* --------------- Linke Spalte --------------- */}
        <div className="min-w-0 space-y-8">
          <div>
            <FotoGalerie
              photos={vehicle.photos ?? []}
              vehicleId={vehicle.id}
              body={vehicle.body}
              alt={`${vehicleFullTitle(vehicle)}, ${vehicle.color}`}
              label={`${vehicle.color} · ${vehicle.year}`}
            />
            <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl display text-ink sm:text-3xl">
                  {vehicle.make} {vehicle.model}
                </h1>
                <p className="mt-1 text-ink-3">{vehicle.trim}</p>
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
                {listing && handelbar && !isMine && (
                  <WatchButton
                    listingId={listing.id}
                    vehicleId={vehicle.id}
                    initialActive={watchlist.includes(listing.id)}
                    signedIn={Boolean(me)}
                  />
                )}
              </div>
            </div>
          </div>

          {vehicle.notes && (
            <Card className="p-5">
              <p className="text-[11px] uppercase tracking-wider text-ink-3">
                Beschreibung des Besitzers
              </p>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{vehicle.notes}</p>
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

              <div className="mt-5 border-t border-line pt-4">
                <p className="text-[11px] uppercase tracking-wider text-ink-3">Ausstattung</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {vehicle.features.map((f) => (
                    <Badge key={f}>{f}</Badge>
                  ))}
                </div>
              </div>

              {vehicle.defects?.length ? (
                <div className="mt-4 border-t border-line pt-4">
                  <p className="text-[11px] uppercase tracking-wider text-ink-3">
                    Angegebene Mängel
                  </p>
                  <ul className="mt-2 space-y-1">
                    {vehicle.defects.map((d) => (
                      <li key={d} className="text-sm text-warn">
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
              sub="Zurück bis zur Erstzulassung, nach vorn 18 Monate."
            />
            <Card className="p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-end gap-8">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-ink-3">Heutiger Wert</p>
                  <p className="mt-1 text-2xl betrag text-ink">
                    {chf(valuation.value)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-ink-3">
                    Wertverlust pro Monat
                  </p>
                  <p className="mt-1 text-2xl betrag text-bad">{chf(perMonth)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-ink-3">
                    Restwertquote
                  </p>
                  <p className="mt-1 text-2xl betrag text-ink">
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
              sub="Jeder Posten steht einzeln da. So könnt ihr über Zahlen reden statt über ein Bauchgefühl."
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
              <Badge tone="marke">Dein Auto</Badge>
              <p className="mt-3 text-sm text-ink-2">
                Dieses Auto steht in deiner Garage. Du kannst es als Tauschobjekt einsetzen.
              </p>
              <Link
                href="/matches"
                className="mt-4 block rounded-lg bg-marke py-2.5 text-center text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
              >
                Passende Tausche anzeigen
              </Link>
              <Link
                href={`/inserat/${vehicle.id}/bearbeiten`}
                className="mt-2 block rounded-lg border border-line-strong py-2.5 text-center text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
              >
                Inserat bearbeiten
              </Link>
            </Card>
          ) : nichtHandelbarGrund ? (
            <Card className="p-5">
              <Badge tone="warn">nicht zu haben</Badge>
              <p className="mt-3 text-sm text-ink-2">{nichtHandelbarGrund}</p>
              <Link
                href="/markt"
                className="mt-4 block rounded-lg border border-line-strong py-2.5 text-center text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
              >
                Andere Autos ansehen
              </Link>
            </Card>
          ) : !me ? (
            <Card className="p-5">
              <p className="text-sm text-ink-2">
                Melde dich an, um einen Tausch vorzuschlagen. Wir berechnen dir dann sofort die
                Wertdifferenz zu deinem eigenen Auto.
              </p>
              <Link
                href={`/konto/registrieren`}
                className="mt-4 block rounded-lg bg-marke py-2.5 text-center text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
              >
                Konto erstellen
              </Link>
              <Link
                href={`/konto/anmelden?next=/auto/${encodeURIComponent(vehicle.id)}`}
                className="mt-2 block py-1 text-center text-sm text-ink-3 hover:text-ink"
              >
                Ich habe schon ein Konto
              </Link>
            </Card>
          ) : myVehicles.length === 0 ? (
            <Card className="p-5">
              <p className="text-sm text-ink-2">
                Für einen Tauschvorschlag brauchst du ein eigenes Auto im Konto.
              </p>
              <Link
                href="/inserat/neu"
                className="mt-4 block rounded-lg bg-marke py-2.5 text-center text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
              >
                Auto einstellen
              </Link>
            </Card>
          ) : (
            <>
              <Card className="p-5">
                <p className="text-[11px] uppercase tracking-wider text-ink-3">
                  Tausch gegen dein Auto
                </p>
                <div className="mt-3 space-y-2">
                  {offers.map((o) => (
                    <div
                      key={o.mine.id}
                      className={`rounded-lg border p-3 ${
                        o.fit?.ok
                          ? "border-marke/35 bg-marke/20"
                          : "border-line bg-surface-2"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium text-ink">
                          {o.mine.make} {o.mine.model}
                        </span>
                        {/*
                          Mit Wort statt Vorzeichen: hier stand «+CHF 2'000»
                          für dieselbe Zuzahlung, die in der Tausch- und
                          Ringliste als «−CHF 2'000» erscheint. Wer das «+»
                          für einen Erlös hielt, fand im Vorgang das Gegenteil.
                          Die Fahrzeugkarte macht es schon so.
                        */}
                        <span className="flex shrink-0 items-baseline gap-1.5">
                          <span className="text-[11px] text-ink-3">
                            {o.cash.delta > 0
                              ? "du zahlst"
                              : o.cash.delta < 0
                                ? "du erhältst"
                                : "Ausgleich"}
                          </span>
                          <span
                            className={`text-sm font-semibold tabular ${
                              o.cash.delta > 0
                                ? "text-warn"
                                : o.cash.delta < 0
                                  ? "text-good"
                                  : "text-ink-2"
                            }`}
                          >
                            {chf(Math.abs(o.cash.delta))}
                          </span>
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-ink-3">
                        {o.fit?.ok
                          ? `${owner?.name ?? "Die Gegenseite"} sucht so ein Auto`
                          : (o.fit?.misses[0] ?? "passt nicht zur Wunschliste")}
                      </p>
                    </div>
                  ))}
                </div>
                <Link
                  href={`/tausch/${vehicle.id}${best ? `?mine=${best.mine.id}` : ""}`}
                  className="mt-4 block rounded-lg bg-marke py-2.5 text-center text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
                >
                  Tausch vorschlagen
                </Link>
                <p className="mt-2 text-center text-[11px] text-ink-3">
                  Unverbindlich — der Betrag ist im nächsten Schritt verhandelbar.
                </p>
              </Card>

              {listing && owner && (
                <Card className="p-5">
                  <div className="flex items-center gap-3">
                    <span
                      className="grid h-10 w-10 place-items-center rounded-full text-sm font-semibold text-onmarke"
                      style={{ background: owner.avatarColor }}
                    >
                      {owner.name.slice(0, 1)}
                    </span>
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium text-ink">
                        {owner.name}
                        {owner.rating !== null && <Sterne value={owner.rating} />}
                      </p>
                      <p className="text-xs text-ink-3">
                        {[owner.location, owner.canton].filter(Boolean).join(", ")}
                        {owner.location && " · "}
                        {owner.swapsCompleted} Tausche ·{" "}
                        {owner.ratingCount > 0
                          ? `${owner.rating?.toFixed(1)} aus ${owner.ratingCount} Bewertungen`
                          : "noch keine Bewertung"}
                      </p>
                    </div>
                    {(owner.emailVerified || owner.identityVerified) && (
                      <span className="ml-auto">
                        <Badge tone="good">
                          {owner.identityVerified ? "Ausweis geprüft" : "E-Mail bestätigt"}
                        </Badge>
                      </span>
                    )}
                  </div>

                  {!isMine && <ReportButton vehicleId={vehicle.id} signedIn={Boolean(me)} />}

                  {bewertungen.length > 0 && (
                    <ul className="mt-4 space-y-3 border-t border-line pt-4">
                      {bewertungen.map((b, i) => (
                        <li key={i} className="text-sm">
                          <div className="flex items-center gap-2">
                            <Sterne value={b.stars} />
                            <span className="text-xs text-ink-3">
                              {b.authorName} · {dateLabel(b.createdAt)}
                            </span>
                          </div>
                          {b.body && <p className="mt-1 text-ink-2">{b.body}</p>}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-4 border-t border-line pt-4">
                    <p className="text-[11px] uppercase tracking-wider text-ink-3">
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
                    <dl className="mt-3 space-y-1 text-xs text-ink-3">
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
                      <p className="mt-3 rounded-md bg-surface-2 p-2.5 text-xs italic text-ink-2">
                        «{listing.wish.notes}»
                      </p>
                    )}
                  </div>

                  <p className="mt-4 border-t border-line pt-3 text-[11px] text-ink-3 tabular">
                    Inseriert {relativeAge(listing.createdAt, heute)} · {listing.views} Aufrufe
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
