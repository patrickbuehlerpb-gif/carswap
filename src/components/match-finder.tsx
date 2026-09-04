"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { VehicleVisual } from "@/components/vehicle-visual";
import { Badge, Card, ScorePill } from "@/components/ui";
import { CURRENT_USER_ID } from "@/lib/data/users";
import { myVehicleIds, requireVehicle } from "@/lib/data/vehicles";
import { chf, km, label, vehicleFullTitle } from "@/lib/format";
import { findMatches, findRingSwaps } from "@/lib/matching";
import type { Body, Fuel } from "@/lib/types";

const MAKES = [
  "Audi", "BMW", "Cupra", "Hyundai", "Kia", "Mercedes-Benz", "Polestar",
  "Porsche", "Skoda", "Tesla", "Toyota", "VW", "Volvo", "Zeekr",
];
const BODIES: Body[] = ["suv", "limousine", "kombi", "kompakt"];
const FUELS: Fuel[] = ["elektro", "hybrid", "benzin", "diesel"];

export function MatchFinder() {
  const [mineId, setMineId] = useState(myVehicleIds[0]);
  const [makes, setMakes] = useState<string[]>(["Zeekr"]);
  const [bodies, setBodies] = useState<Body[]>(["suv"]);
  const [fuels, setFuels] = useState<Fuel[]>(["elektro"]);
  const [tab, setTab] = useState<"direkt" | "ring">("direkt");

  const mine = requireVehicle(mineId);
  const wish = useMemo(() => ({ makes, bodies, fuels }), [makes, bodies, fuels]);

  const matches = useMemo(() => findMatches(mine, { wish }), [mine, wish]);
  // Drei Gruppen, weil genau das den Tauschmarkt beschreibt: beide wollen,
  // nur ich will, oder nur die Gegenseite will.
  const both = matches.filter((m) => m.mutual && m.fitsMyWish);
  const onlyMe = matches.filter((m) => !m.mutual && m.fitsMyWish).slice(0, 6);
  const onlyThem = matches.filter((m) => m.mutual && !m.fitsMyWish).slice(0, 6);
  const rings = useMemo(() => findRingSwaps(mine, wish, CURRENT_USER_ID, 6), [mine, wish]);

  function toggle<T>(arr: T[], set: (v: T[]) => void, v: T) {
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  }

  return (
    <div className="space-y-6">
      {/* Steuerung */}
      <Card className="p-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_1fr]">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-mist-400">Du gibst</p>
            <div className="mt-2 space-y-1.5">
              {myVehicleIds.map((id) => {
                const v = requireVehicle(id);
                const active = id === mineId;
                return (
                  <button
                    key={id}
                    onClick={() => setMineId(id)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                      active
                        ? "border-volt-600/45 bg-volt-500/[0.07]"
                        : "border-ink-700 bg-ink-850 hover:border-ink-600"
                    }`}
                  >
                    <VehicleVisual id={v.id} body={v.body} className="h-11 w-18 shrink-0 rounded-md" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-mist-100">
                        {v.make} {v.model}
                      </span>
                      <span className="block truncate text-xs text-mist-400 tabular">
                        {v.year} · {km(v.mileageKm)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-[11px] uppercase tracking-wider text-mist-400">Du suchst</p>
            <div className="flex flex-wrap gap-1.5">
              {MAKES.map((m) => (
                <Chip key={m} active={makes.includes(m)} onClick={() => toggle(makes, setMakes, m)}>
                  {m}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {BODIES.map((b) => (
                <Chip key={b} active={bodies.includes(b)} onClick={() => toggle(bodies, setBodies, b)}>
                  {label.body(b)}
                </Chip>
              ))}
              <span className="mx-1 w-px bg-ink-700" />
              {FUELS.map((f) => (
                <Chip key={f} active={fuels.includes(f)} onClick={() => toggle(fuels, setFuels, f)}>
                  {label.fuel(f)}
                </Chip>
              ))}
            </div>
            {makes.length === 0 && bodies.length === 0 && fuels.length === 0 && (
              <p className="text-xs text-mist-400">
                Ohne Auswahl werden alle Inserate berücksichtigt.
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-ink-800 bg-ink-900 p-1">
        <TabButton active={tab === "direkt"} onClick={() => setTab("direkt")}>
          Direkter Tausch
          <span className="ml-1.5 text-mist-400 tabular">{both.length}</span>
        </TabButton>
        <TabButton active={tab === "ring"} onClick={() => setTab("ring")}>
          Ringtausch
          <span className="ml-1.5 text-mist-400 tabular">{rings.length}</span>
        </TabButton>
      </div>

      {tab === "direkt" ? (
        <div className="space-y-8">
          <MatchGroup
            title="Beide Seiten wollen"
            sub={`Das Inserat entspricht deiner Suche — und die Gegenseite sucht ausdrücklich ein Fahrzeug wie deinen ${vehicleFullTitle(mine)}. Höchste Abschlusswahrscheinlichkeit.`}
            items={both}
            mineId={mine.id}
            empty="Aktuell keine beidseitige Übereinstimmung. Schau beim Ringtausch — dort löst sich das oft über eine dritte Partei."
          />
          <MatchGroup
            title="Du willst — die Gegenseite hat andere Wünsche"
            sub="Diese Fahrzeuge passen zu deiner Suche, stehen aber auf keiner passenden Wunschliste. Eine Anfrage kann sich trotzdem lohnen, vor allem mit etwas mehr Ausgleich."
            items={onlyMe}
            mineId={mine.id}
            empty="Nichts gefunden, was zu deiner Suche passt. Erweitere die Kriterien."
          />
          <MatchGroup
            title="Die Gegenseite will — du hast anderes gesucht"
            sub="Hier würde dein Fahrzeug sofort genommen. Falls du bei den Suchkriterien flexibel bist, sind das die schnellsten Abschlüsse."
            items={onlyThem}
            mineId={mine.id}
            empty="Niemand sucht ausserhalb deiner Kriterien ein Fahrzeug wie deines."
          />
        </div>
      ) : (
        <section>
          <h3 className="mb-1 text-sm font-semibold text-mist-100">Dreiertausch</h3>
          <p className="mb-4 max-w-3xl text-sm text-mist-400">
            Du gibst dein Fahrzeug an jemanden, der es sucht — und bekommst deines von einer
            dritten Partei. Alle drei Ausgleichszahlungen summieren sich zu null; abgewickelt wird
            über ein gemeinsames Treuhandkonto, sodass keine Partei in Vorleistung geht.
          </p>
          {rings.length === 0 ? (
            <EmptyBox text="Für diese Kombination liess sich kein Ring bilden. Erweitere deine Suchkriterien oder wähle ein anderes Fahrzeug." />
          ) : (
            <ul className="space-y-4">
              {rings.map((r) => (
                <Card key={r.id} as="li" className="p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <ScorePill score={r.score} />
                      <span className="text-sm text-mist-400">Dreiertausch</span>
                    </div>
                    <span
                      className={`text-sm font-semibold tabular ${
                        r.userCashDelta > 0 ? "text-amber-warn" : "text-good"
                      }`}
                    >
                      {r.userCashDelta > 0 ? "Du zahlst " : "Du erhältst "}
                      {chf(Math.abs(r.userCashDelta))}
                    </span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    {r.participants.map((p) => (
                      <div
                        key={p.user.id}
                        className={`rounded-lg border p-3 ${
                          p.user.id === CURRENT_USER_ID
                            ? "border-volt-600/40 bg-volt-500/[0.06]"
                            : "border-ink-700 bg-ink-850"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-4 w-4 rounded-full"
                            style={{ background: p.user.avatarColor }}
                            aria-hidden
                          />
                          <span className="text-xs text-mist-300">
                            {p.user.id === CURRENT_USER_ID ? "Du" : p.user.name}
                          </span>
                          <span className="ml-auto text-[11px] text-mist-400">
                            {p.user.location}
                          </span>
                        </div>
                        <div className="mt-2.5 flex items-center gap-2">
                          <VehicleVisual
                            id={p.gives.id}
                            body={p.gives.body}
                            className="h-9 w-14 shrink-0 rounded"
                          />
                          <span className="text-mist-500">→</span>
                          <VehicleVisual
                            id={p.gets.id}
                            body={p.gets.body}
                            className="h-9 w-14 shrink-0 rounded"
                          />
                        </div>
                        <p className="mt-2 text-xs text-mist-400">
                          gibt <span className="text-mist-200">{p.gives.make} {p.gives.model}</span>
                          , erhält <span className="text-mist-200">{p.gets.make} {p.gets.model}</span>
                        </p>
                        <p
                          className={`mt-1 text-xs font-semibold tabular ${
                            p.cash > 0 ? "text-amber-warn" : p.cash < 0 ? "text-good" : "text-mist-400"
                          }`}
                        >
                          {p.cash > 0 ? `zahlt ${chf(p.cash)}` : p.cash < 0 ? `erhält ${chf(-p.cash)}` : "kein Ausgleich"}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-800 pt-3">
                    <p className="text-xs text-mist-400">
                      Summe aller Ausgleichszahlungen:{" "}
                      <span className="tabular text-mist-200">
                        {chf(r.participants.reduce((s, p) => s + p.cash, 0))}
                      </span>
                    </p>
                    <Link
                      href={`/tausch/${r.participants[0].gets.id}?mine=${mine.id}`}
                      className="rounded-lg border border-ink-600 px-4 py-1.5 text-sm text-mist-200 transition-colors hover:border-volt-600/50 hover:text-volt-400"
                    >
                      Ring anstossen
                    </Link>
                  </div>
                </Card>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function MatchGroup({
  title,
  sub,
  items,
  mineId,
  empty,
}: {
  title: string;
  sub: string;
  items: ReturnType<typeof findMatches>;
  mineId: string;
  empty: string;
}) {
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold text-mist-100">
        {title} <span className="text-mist-400 tabular">({items.length})</span>
      </h3>
      <p className="mb-4 max-w-3xl text-sm text-mist-400">{sub}</p>
      {items.length === 0 ? (
        <EmptyBox text={empty} />
      ) : (
        <ul className="space-y-3">
          {items.map((m) => (
            <MatchRow key={m.vehicle.id} match={m} mineId={mineId} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MatchRow({
  match,
  mineId,
}: {
  match: ReturnType<typeof findMatches>[number];
  mineId: string;
}) {
  const { vehicle, owner, cashDelta: cash, score, reasons, concerns, mutual } = match;
  return (
    <Card as="li" className="p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <Link href={`/fahrzeug/${vehicle.id}`} className="shrink-0">
          <VehicleVisual
            id={vehicle.id}
            body={vehicle.body}
            className="aspect-[16/9] w-full rounded-lg sm:w-52"
          />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link href={`/fahrzeug/${vehicle.id}`}>
                <h4 className="text-[15px] font-semibold text-mist-100 hover:text-volt-400">
                  {vehicle.make} {vehicle.model}
                </h4>
              </Link>
              <p className="text-xs text-mist-400 tabular">
                {vehicle.trim} · {vehicle.year} · {km(vehicle.mileageKm)} · {vehicle.powerPs} PS
              </p>
            </div>
            <div className="flex items-center gap-3">
              {mutual && <Badge tone="volt">beidseitig</Badge>}
              <ScorePill score={score} />
            </div>
          </div>

          <ul className="mt-3 space-y-1">
            {reasons.map((r) => (
              <li key={r} className="flex gap-2 text-xs text-mist-300">
                <span className="text-good" aria-hidden>
                  ✓
                </span>
                {r}
              </li>
            ))}
            {concerns.map((c) => (
              <li key={c} className="flex gap-2 text-xs text-mist-400">
                <span className="text-amber-warn" aria-hidden>
                  !
                </span>
                {c}
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-ink-800 pt-3">
            <p className="text-sm">
              <span className="text-mist-400">
                {cash > 0 ? "Du zahlst " : cash < 0 ? "Du erhältst " : "Ausgleich "}
              </span>
              <span
                className={`font-semibold tabular ${
                  cash > 0 ? "text-amber-warn" : cash < 0 ? "text-good" : "text-mist-200"
                }`}
              >
                {chf(Math.abs(cash))}
              </span>
              <span className="ml-2 text-xs text-mist-400">· {owner.location}</span>
            </p>
            <Link
              href={`/tausch/${vehicle.id}?mine=${mineId}`}
              className="rounded-lg bg-volt-500 px-4 py-1.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-volt-400"
            >
              Tausch durchrechnen
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}

function TabButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors sm:flex-none ${
        active ? "bg-ink-800 text-mist-100" : "text-mist-400 hover:text-mist-200"
      }`}
    >
      {children}
    </button>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-volt-600/50 bg-volt-500/12 text-volt-400"
          : "border-ink-700 bg-ink-850 text-mist-300 hover:border-ink-600 hover:text-mist-100"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-700 p-10 text-center">
      <p className="mx-auto max-w-md text-sm text-mist-400">{text}</p>
    </div>
  );
}
