import Link from "next/link";
import { ValueChart } from "@/components/value-chart";
import { VehicleCard } from "@/components/vehicle-card";
import { VehicleVisual } from "@/components/vehicle-visual";
import { Badge, Card, SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { chf, km, vehicleFullTitle } from "@/lib/format";
import { findMatches, findRingSwaps } from "@/lib/matching";
import { getActiveListings, getMyVehicles, getPublicUser } from "@/lib/queries";
import type { Vehicle } from "@/lib/types";
import { currentMonth, depreciationPerMonth, valuate, valueHistory } from "@/lib/valuation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const me = await getSessionUser();
  const asOf = currentMonth();

  const [pool, myVehicles, publicMe] = await Promise.all([
    getActiveListings(me?.id),
    me ? getMyVehicles(me.id) : Promise.resolve([]),
    me ? getPublicUser(me.id) : Promise.resolve(null),
  ]);

  const myCar = myVehicles[0] ?? null;
  const matches = myCar ? findMatches(myCar, pool, {}).slice(0, 3) : [];
  const rings =
    myCar && publicMe ? findRingSwaps(myCar, pool, undefined, publicMe, 1) : [];

  // Das Fahrzeug für den Wertverlauf: eigenes zuerst, sonst ein Inserat
  const showcase: Vehicle | null = myCar ?? pool[0]?.vehicle ?? null;
  const evShare = pool.length
    ? Math.round((pool.filter((l) => l.vehicle.fuel === "elektro").length / pool.length) * 100)
    : 0;

  return (
    <div className="space-y-20">
      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-surface card-shadow">
        <div className="absolute inset-0 grid-noise opacity-40" />
        <div
          className="pointer-events-none absolute -right-32 -top-40 h-96 w-96 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, #c2ee3a, transparent 65%)" }}
        />
        <div className="relative grid gap-10 p-7 sm:p-10 lg:grid-cols-[1.1fr_1fr] lg:p-12">
          <div className="flex flex-col justify-center">
            <Badge tone="volt" className="w-fit">
              Direkttausch zwischen Privatpersonen
            </Badge>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight text-ink sm:text-5xl">
              Tausche dein Auto.
              <br />
              <span className="text-volt-ink">Ohne Händlermarge,</span>
              <br />
              ohne Inseratezirkus.
            </h1>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-ink-2">
              Verkaufen und kaufen sind zwei Transaktionen, zwei Preisverhandlungen und zwei
              Enttäuschungen. CarSwap macht daraus eine: Fahrzeug gegen Fahrzeug, die Wertdifferenz
              transparent berechnet und über Treuhand ausgeglichen.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href={me ? (myCar ? "/matches" : "/inserat/neu") : "/konto/registrieren"}
                className="rounded-lg bg-volt px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-volt-hi"
              >
                {me ? (myCar ? "Passende Tausche finden" : "Fahrzeug einstellen") : "Kostenlos starten"}
              </Link>
              <Link
                href="/wert"
                className="rounded-lg border border-line-strong px-5 py-2.5 text-sm font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
              >
                Was ist mein Auto wert?
              </Link>
            </div>
            <dl className="mt-9 grid max-w-md grid-cols-3 gap-6 border-t border-line pt-6">
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-ink-3">Inserate</dt>
                <dd className="mt-1 text-2xl font-semibold tabular text-ink">{pool.length}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-ink-3">davon E-Auto</dt>
                <dd className="mt-1 text-2xl font-semibold tabular text-ink">{evShare} %</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-ink-3">Provision</dt>
                <dd className="mt-1 text-2xl font-semibold tabular text-ink">0 %</dd>
              </div>
            </dl>
          </div>

          {matches[0] && myCar ? (
            <Card className="self-center p-5">
              <p className="text-[11px] uppercase tracking-wider text-ink-3">
                Dein aktueller Bestmatch
              </p>
              <SwapPreview from={myCar} to={matches[0].vehicle} cash={matches[0].cashDelta} />
              <Link
                href={`/tausch/${matches[0].vehicle.id}?mine=${myCar.id}`}
                className="mt-4 block rounded-lg border border-line-strong py-2 text-center text-sm font-medium text-ink-2 transition-colors hover:border-volt-ink/45 hover:text-volt-ink"
              >
                Tausch durchrechnen
              </Link>
            </Card>
          ) : (
            <Card className="self-center p-6">
              <p className="text-[11px] uppercase tracking-wider text-ink-3">So läuft es ab</p>
              <ol className="mt-4 space-y-4">
                {[
                  ["Fahrzeug einstellen", "Daten, Zustand, Wunschliste — die Bewertung entsteht automatisch."],
                  ["Match annehmen", "Wir zeigen nur Tausche, bei denen auch die Gegenseite dich sucht."],
                  ["Treuhand & Übergabe", "Der Ausgleich wird erst nach beidseitiger Bestätigung ausgezahlt."],
                ].map(([title, body], i) => (
                  <li key={title} className="flex gap-3">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-volt text-xs font-semibold text-ink tabular">
                      {i + 1}
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-ink">{title}</span>
                      <span className="block text-sm text-ink-3">{body}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {!me && (
                <Link
                  href="/konto/registrieren"
                  className="mt-5 block rounded-lg bg-volt py-2.5 text-center text-sm font-semibold text-ink transition-colors hover:bg-volt-hi"
                >
                  Konto erstellen
                </Link>
              )}
            </Card>
          )}
        </div>
      </section>

      {/* ---------------- Wertverlauf ---------------- */}
      {showcase && (
        <section>
          <SectionHead
            title="Was ist mein Fahrzeug gerade wert?"
            sub="Kein einzelner Schätzpreis, sondern der Verlauf: woher der Wert kommt, wo er hingeht und wie sicher die Prognose ist."
            action={
              <Link href="/wert" className="text-sm text-volt-ink hover:underline">
                Eigenes Fahrzeug bewerten →
              </Link>
            }
          />
          <ValuationTeaser vehicle={showcase} asOf={asOf} />
        </section>
      )}

      {/* ---------------- Ringtausch ---------------- */}
      {rings.length > 0 && publicMe && (
        <section>
          <SectionHead
            title="Wenn zwei nicht zusammenpassen, helfen drei"
            sub="Das Grundproblem jedes Tauschmarkts: Du willst das Auto von A, aber A will deines nicht. Über einen Ringtausch löst sich das trotzdem auf."
            action={
              <Link href="/matches" className="text-sm text-volt-ink hover:underline">
                Alle Ringtausche →
              </Link>
            }
          />
          <Card className="p-5 sm:p-6">
            <div className="grid gap-4 md:grid-cols-3">
              {rings[0].participants.map((p, i) => (
                <div key={p.user.id} className="relative">
                  <div className="flex items-center gap-2 text-xs text-ink-3">
                    <span
                      className="h-4 w-4 rounded-full"
                      style={{ background: p.user.avatarColor }}
                      aria-hidden
                    />
                    {p.user.id === publicMe.id ? "Du" : p.user.name}
                    {p.user.location && ` · ${p.user.location}`}
                  </div>
                  <VehicleVisual
                    id={p.gives.id}
                    body={p.gives.body}
                    className="mt-2 aspect-[16/9] w-full rounded-lg"
                  />
                  <p className="mt-2 text-sm font-medium text-ink">
                    gibt {p.gives.make} {p.gives.model}
                  </p>
                  <p className="text-xs text-ink-3">
                    erhält {p.gets.make} {p.gets.model}
                  </p>
                  <p
                    className={`mt-1 text-xs font-semibold tabular ${
                      p.cash > 0 ? "text-warn" : p.cash < 0 ? "text-good" : "text-ink-3"
                    }`}
                  >
                    {p.cash > 0 ? "zahlt " : p.cash < 0 ? "erhält " : "kein Ausgleich"}
                    {p.cash !== 0 && chf(Math.abs(p.cash))}
                  </p>
                  {i < 2 && (
                    <span className="absolute -right-3 top-24 hidden text-ink-3 md:block">→</span>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-5 border-t border-line pt-4 text-xs text-ink-3">
              Alle drei Ausgleichszahlungen summieren sich zu null — es fliesst nur Geld zwischen
              den Teilnehmern, nicht aus dem System heraus.
            </p>
          </Card>
        </section>
      )}

      {/* ---------------- Inserate ---------------- */}
      {pool.length > 0 && (
        <section>
          <SectionHead
            title={myCar ? "Aktuell für dich passend" : "Neu auf dem Marktplatz"}
            sub={
              myCar
                ? `Berechnet für deinen ${vehicleFullTitle(myCar)} mit ${km(myCar.mileageKm)}.`
                : "Diese Fahrzeuge stehen gerade zum Tausch."
            }
            action={
              <Link href="/markt" className="text-sm text-volt-ink hover:underline">
                Ganzen Marktplatz ansehen →
              </Link>
            }
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(matches.length ? matches : pool.slice(0, 3).map((e) => ({ ...e, cashDelta: undefined, score: undefined, mutual: false }))).map(
              (m) => (
                <VehicleCard
                  key={m.vehicle.id}
                  vehicle={m.vehicle}
                  listing={m.listing}
                  owner={m.owner}
                  cashDelta={m.cashDelta}
                  score={m.score}
                  mutual={m.mutual}
                />
              ),
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function ValuationTeaser({ vehicle, asOf }: { vehicle: Vehicle; asOf: string }) {
  const valuation = valuate(vehicle, asOf);
  const history = valueHistory(vehicle, 24, 18, asOf);
  const perMonth = depreciationPerMonth(vehicle, asOf);

  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-3">{vehicleFullTitle(vehicle)}</p>
          <p className="mt-1 text-3xl font-semibold tabular text-ink">{chf(valuation.value)}</p>
          <p className="mt-1 text-xs text-ink-3 tabular">
            Realistische Spanne {chf(valuation.low)} – {chf(valuation.high)}
          </p>
        </div>
        <div className="flex gap-6">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-ink-3">Wertverlust</p>
            <p className="mt-1 text-lg font-semibold tabular text-bad">
              {chf(perMonth)}
              <span className="text-xs font-normal text-ink-3"> / Monat</span>
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-ink-3">Vergleichbare</p>
            <p className="mt-1 text-lg font-semibold tabular text-ink">{valuation.comparables}</p>
          </div>
        </div>
      </div>
      <ValueChart points={history} />
    </Card>
  );
}

function SwapPreview({ from, to, cash }: { from: Vehicle; to: Vehicle; cash: number }) {
  return (
    <div className="mt-3 space-y-2">
      <SwapSide vehicle={from} caption="Du gibst" />
      <div className="flex items-center gap-3 py-0.5">
        <div className="h-px flex-1 bg-line" />
        <span
          className={`rounded-md border px-2.5 py-1 text-xs font-semibold tabular ${
            cash > 0
              ? "border-warn/35 bg-warn/12 text-warn"
              : cash < 0
                ? "border-good/35 bg-good/12 text-good"
                : "border-line-strong bg-surface-2 text-ink-2"
          }`}
        >
          {cash > 0 ? "+ " : cash < 0 ? "− " : ""}
          {chf(Math.abs(cash))} {cash > 0 ? "von dir" : cash < 0 ? "an dich" : ""}
        </span>
        <div className="h-px flex-1 bg-line" />
      </div>
      <SwapSide vehicle={to} caption="Du erhältst" highlight />
    </div>
  );
}

function SwapSide({
  vehicle,
  caption,
  highlight,
}: {
  vehicle: Vehicle;
  caption: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-2.5 ${
        highlight ? "border-volt-ink/35 bg-volt/20" : "border-line bg-surface-2"
      }`}
    >
      <VehicleVisual id={vehicle.id} body={vehicle.body} className="h-14 w-24 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wider text-ink-3">{caption}</p>
        <p className="truncate text-sm font-medium text-ink">
          {vehicle.make} {vehicle.model}
        </p>
        <p className="truncate text-xs text-ink-3 tabular">
          {vehicle.year} · {km(vehicle.mileageKm)}
        </p>
      </div>
    </div>
  );
}
