import Link from "next/link";
import { ValueChart } from "@/components/value-chart";
import { VehicleCard } from "@/components/vehicle-card";
import { VehicleVisual } from "@/components/vehicle-visual";
import { Badge, Card, SectionHead } from "@/components/ui";
import { listings, requireVehicle } from "@/lib/data/vehicles";
import { CURRENT_USER_ID } from "@/lib/data/users";
import { chf, km, vehicleFullTitle } from "@/lib/format";
import { findMatches, findRingSwaps } from "@/lib/matching";
import { depreciationPerMonth, valuate, valueHistory } from "@/lib/valuation";

export default function HomePage() {
  const myCar = requireVehicle("v-me-1");
  const valuation = valuate(myCar);
  const history = valueHistory(myCar, 24, 18);
  const perMonth = depreciationPerMonth(myCar);

  const matches = findMatches(myCar, {
    wish: { makes: [], bodies: ["suv"], fuels: ["elektro"], minYear: 2024 },
  }).slice(0, 3);

  const rings = findRingSwaps(
    myCar,
    { makes: ["Zeekr"], bodies: ["suv"], fuels: ["elektro"] },
    CURRENT_USER_ID,
    1,
  );

  const evShare = Math.round(
    (listings.filter((l) => requireVehicle(l.vehicleId).fuel === "elektro").length /
      listings.length) *
      100,
  );

  return (
    <div className="space-y-20">
      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden rounded-2xl border border-ink-800 bg-ink-900">
        <div className="absolute inset-0 grid-noise opacity-40" />
        <div
          className="pointer-events-none absolute -right-32 -top-40 h-96 w-96 rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, #c2ee3a, transparent 65%)" }}
        />
        <div className="relative grid gap-10 p-7 sm:p-10 lg:grid-cols-[1.1fr_1fr] lg:p-12">
          <div className="flex flex-col justify-center">
            <Badge tone="volt" className="w-fit">
              Direkttausch zwischen Privatpersonen
            </Badge>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight text-mist-100 sm:text-5xl">
              Tausche dein Auto.
              <br />
              <span className="text-volt-400">Ohne Händlermarge,</span>
              <br />
              ohne Inseratezirkus.
            </h1>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-mist-300">
              Verkaufen und kaufen sind zwei Transaktionen, zwei Preisverhandlungen und zwei
              Enttäuschungen. CarSwap macht daraus eine: Fahrzeug gegen Fahrzeug, die Wertdifferenz
              transparent berechnet und über Treuhand ausgeglichen.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/matches"
                className="rounded-lg bg-volt-500 px-5 py-2.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-volt-400"
              >
                Passende Tausche finden
              </Link>
              <Link
                href="/wert"
                className="rounded-lg border border-ink-600 px-5 py-2.5 text-sm font-medium text-mist-200 transition-colors hover:border-ink-500 hover:text-mist-100"
              >
                Was ist mein Auto wert?
              </Link>
            </div>
            <dl className="mt-9 grid max-w-md grid-cols-3 gap-6 border-t border-ink-800 pt-6">
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-mist-400">Inserate</dt>
                <dd className="mt-1 text-2xl font-semibold tabular text-mist-100">
                  {listings.length}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-mist-400">davon E-Auto</dt>
                <dd className="mt-1 text-2xl font-semibold tabular text-mist-100">{evShare} %</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-mist-400">Ø Ausgleich</dt>
                <dd className="mt-1 text-2xl font-semibold tabular text-mist-100">
                  {chf(
                    matches.reduce((s, m) => s + Math.abs(m.cashDelta), 0) /
                      Math.max(1, matches.length),
                    { compact: true },
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* Tausch-Vorschau */}
          <Card className="self-center p-5">
            <p className="text-[11px] uppercase tracking-wider text-mist-400">
              Dein aktueller Bestmatch
            </p>
            <SwapPreview
              from={myCar}
              to={requireVehicle(matches[0]?.vehicle.id ?? "v-002")}
              cash={matches[0]?.cashDelta ?? 0}
            />
            <Link
              href={`/tausch/${matches[0]?.vehicle.id ?? "v-002"}`}
              className="mt-4 block rounded-lg border border-ink-600 py-2 text-center text-sm font-medium text-mist-200 transition-colors hover:border-volt-600/50 hover:text-volt-400"
            >
              Tausch durchrechnen
            </Link>
          </Card>
        </div>
      </section>

      {/* ---------------- Wertverlauf ---------------- */}
      <section>
        <SectionHead
          title="Was ist mein Fahrzeug gerade wert?"
          sub="Kein einzelner Schätzpreis, sondern der Verlauf: woher der Wert kommt, wo er hingeht und wie sicher die Prognose ist."
          action={
            <Link href="/wert" className="text-sm text-volt-400 hover:text-volt-300">
              Eigenes Fahrzeug bewerten →
            </Link>
          }
        />
        <Card className="p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-mist-400">{vehicleFullTitle(myCar)}</p>
              <p className="mt-1 text-3xl font-semibold tabular text-mist-100">
                {chf(valuation.value)}
              </p>
              <p className="mt-1 text-xs text-mist-400 tabular">
                Realistische Spanne {chf(valuation.low)} – {chf(valuation.high)}
              </p>
            </div>
            <div className="flex gap-6">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-mist-400">
                  Wertverlust
                </p>
                <p className="mt-1 text-lg font-semibold tabular text-bad">
                  {chf(perMonth)}<span className="text-xs font-normal text-mist-400"> / Monat</span>
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-mist-400">Vergleichbare</p>
                <p className="mt-1 text-lg font-semibold tabular text-mist-100">
                  {valuation.comparables}
                </p>
              </div>
            </div>
          </div>
          <ValueChart points={history} />
        </Card>
      </section>

      {/* ---------------- So funktioniert es ---------------- */}
      <section>
        <SectionHead
          title="Drei Schritte, ein Tausch"
          sub="Der Ausgleich läuft über ein Treuhandkonto — das Geld wird erst freigegeben, wenn beide Fahrzeuge übergeben sind."
        />
        <ol className="grid gap-4 md:grid-cols-3">
          {[
            {
              n: "01",
              t: "Fahrzeug einstellen",
              d: "Fahrzeugausweis scannen, Zustand angeben, Wunschliste definieren. Die Bewertung entsteht automatisch aus Alter, Laufleistung, Ausstattung und Marktlage.",
            },
            {
              n: "02",
              t: "Match annehmen",
              d: "Wir zeigen nur Tausche, bei denen auch die Gegenseite dein Auto sucht — inklusive Dreiertausch, wenn es direkt nicht passt.",
            },
            {
              n: "03",
              t: "Treuhand & Übergabe",
              d: "Die Differenz wird hinterlegt, beide Parteien bestätigen die Übergabe, danach erfolgt die Auszahlung. Halterwechsel als Checkliste inklusive.",
            },
          ].map((s) => (
            <Card key={s.n} as="li" className="p-5">
              <span className="text-xs font-semibold tabular text-volt-400">{s.n}</span>
              <h3 className="mt-2 text-base font-semibold text-mist-100">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist-400">{s.d}</p>
            </Card>
          ))}
        </ol>
      </section>

      {/* ---------------- Ringtausch ---------------- */}
      {rings.length > 0 && (
        <section>
          <SectionHead
            title="Wenn zwei nicht zusammenpassen, helfen drei"
            sub="Das Grundproblem jedes Tauschmarkts: Du willst das Auto von A, aber A will deines nicht. Über einen Ringtausch löst sich das trotzdem auf."
            action={
              <Link href="/matches" className="text-sm text-volt-400 hover:text-volt-300">
                Alle Ringtausche →
              </Link>
            }
          />
          <Card className="p-5 sm:p-6">
            <div className="grid gap-4 md:grid-cols-3">
              {rings[0].participants.map((p, i) => (
                <div key={p.user.id} className="relative">
                  <div className="flex items-center gap-2 text-xs text-mist-400">
                    <span
                      className="h-4 w-4 rounded-full"
                      style={{ background: p.user.avatarColor }}
                      aria-hidden
                    />
                    {p.user.id === CURRENT_USER_ID ? "Du" : p.user.name} · {p.user.location}
                  </div>
                  <VehicleVisual
                    id={p.gives.id}
                    body={p.gives.body}
                    className="mt-2 aspect-[16/9] w-full rounded-lg"
                  />
                  <p className="mt-2 text-sm font-medium text-mist-100">
                    gibt {p.gives.make} {p.gives.model}
                  </p>
                  <p className="text-xs text-mist-400">
                    erhält {p.gets.make} {p.gets.model}
                  </p>
                  <p
                    className={`mt-1 text-xs font-semibold tabular ${
                      p.cash > 0 ? "text-amber-warn" : p.cash < 0 ? "text-good" : "text-mist-400"
                    }`}
                  >
                    {p.cash > 0 ? "zahlt " : p.cash < 0 ? "erhält " : "kein Ausgleich"}
                    {p.cash !== 0 && chf(Math.abs(p.cash))}
                  </p>
                  {i < 2 && (
                    <span className="absolute -right-3 top-24 hidden text-mist-500 md:block">→</span>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-5 border-t border-ink-800 pt-4 text-xs text-mist-400">
              Alle drei Ausgleichszahlungen summieren sich zu null — es fliesst nur Geld zwischen
              den Teilnehmern, nicht aus dem System heraus.
            </p>
          </Card>
        </section>
      )}

      {/* ---------------- Top-Matches ---------------- */}
      <section>
        <SectionHead
          title="Aktuell für dich passend"
          sub={`Berechnet für deinen ${vehicleFullTitle(myCar)} mit ${km(myCar.mileageKm)}.`}
          action={
            <Link href="/markt" className="text-sm text-volt-400 hover:text-volt-300">
              Ganzen Marktplatz ansehen →
            </Link>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {matches.map((m) => (
            <VehicleCard
              key={m.vehicle.id}
              vehicle={m.vehicle}
              listing={m.listing}
              cashDelta={m.cashDelta}
              score={m.score}
              mutual={m.mutual}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SwapPreview({
  from,
  to,
  cash,
}: {
  from: ReturnType<typeof requireVehicle>;
  to: ReturnType<typeof requireVehicle>;
  cash: number;
}) {
  return (
    <div className="mt-3 space-y-2">
      <SwapSide vehicle={from} caption="Du gibst" />
      <div className="flex items-center gap-3 py-0.5">
        <div className="h-px flex-1 bg-ink-700" />
        <span
          className={`rounded-md border px-2.5 py-1 text-xs font-semibold tabular ${
            cash > 0
              ? "border-amber-warn/30 bg-amber-warn/10 text-amber-warn"
              : cash < 0
                ? "border-good/30 bg-good/10 text-good"
                : "border-ink-600 bg-ink-800 text-mist-300"
          }`}
        >
          {cash > 0 ? "+ " : cash < 0 ? "− " : ""}
          {chf(Math.abs(cash))} {cash > 0 ? "von dir" : cash < 0 ? "an dich" : ""}
        </span>
        <div className="h-px flex-1 bg-ink-700" />
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
  vehicle: ReturnType<typeof requireVehicle>;
  caption: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-2.5 ${
        highlight ? "border-volt-600/35 bg-volt-500/[0.06]" : "border-ink-700 bg-ink-850"
      }`}
    >
      <VehicleVisual id={vehicle.id} body={vehicle.body} className="h-14 w-24 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wider text-mist-400">{caption}</p>
        <p className="truncate text-sm font-medium text-mist-100">
          {vehicle.make} {vehicle.model}
        </p>
        <p className="truncate text-xs text-mist-400 tabular">
          {vehicle.year} · {km(vehicle.mileageKm)}
        </p>
      </div>
    </div>
  );
}
