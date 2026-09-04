"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ValueChart } from "@/components/value-chart";
import { VehicleVisual } from "@/components/vehicle-visual";
import { Badge, Card } from "@/components/ui";
import { getUser } from "@/lib/data/users";
import { getListingByVehicle, myVehicleIds, requireVehicle } from "@/lib/data/vehicles";
import { chf, km, label, vehicleFullTitle } from "@/lib/format";
import { cashDelta, fitsWish } from "@/lib/matching";
import { useStore } from "@/lib/store";
import { valuate, valueHistory } from "@/lib/valuation";

export function SwapConfigurator({
  targetId,
  defaultMineId,
}: {
  targetId: string;
  defaultMineId?: string;
}) {
  const router = useRouter();
  const { createDeal } = useStore();

  const target = requireVehicle(targetId);
  const listing = getListingByVehicle(targetId);
  const owner = listing ? getUser(listing.ownerId) : null;

  const [mineId, setMineId] = useState(
    defaultMineId && myVehicleIds.includes(defaultMineId) ? defaultMineId : myVehicleIds[0],
  );
  const mine = requireVehicle(mineId);

  const fair = useMemo(
    () => cashDelta(mine, target, listing?.askPremium ?? 0),
    [mine, target, listing],
  );
  const [offer, setOffer] = useState<number | null>(null);
  const current = offer ?? fair.delta;

  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const fit = listing ? fitsWish(listing.wish, mine) : null;
  const theirPayment = -current;
  const withinTheirRange =
    !listing || listing.wish.maxCashOut === undefined || theirPayment <= listing.wish.maxCashOut + 1;

  const spread = Math.abs(current - fair.delta);
  const fairness =
    spread < 500
      ? { tone: "good" as const, text: "Marktgerecht" }
      : current < fair.delta
        ? { tone: "warn" as const, text: `${chf(spread)} unter dem berechneten Ausgleich` }
        : { tone: "info" as const, text: `${chf(spread)} über dem berechneten Ausgleich` };

  const range = Math.max(8_000, Math.round(Math.abs(fair.delta) * 1.6));
  const sliderMin = Math.round((fair.delta - range) / 100) * 100;
  const sliderMax = Math.round((fair.delta + range) / 100) * 100;

  const histMine = useMemo(() => valueHistory(mine, 18, 12), [mine]);
  const histTarget = useMemo(() => valueHistory(target, 18, 12), [target]);

  function send() {
    if (!owner) return;
    setSending(true);
    const deal = createDeal({
      fromVehicleId: mine.id,
      toVehicleId: target.id,
      counterpartyId: owner.id,
      cashDelta: current,
      message:
        message.trim() ||
        `Hallo ${owner.name}, ich biete meinen ${vehicleFullTitle(mine)} im Tausch gegen deinen ${vehicleFullTitle(target)}. ${
          current > 0
            ? `Ich zahle ${chf(current)} drauf.`
            : current < 0
              ? `Ich würde einen Ausgleich von ${chf(Math.abs(current))} erwarten.`
              : "Aus meiner Sicht ist das ein Tausch ohne Ausgleich."
        }`,
    });
    router.push(`/deals/${deal.id}`);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="min-w-0 space-y-6">
        {/* Auswahl des eigenen Fahrzeugs */}
        <Card className="p-5">
          <p className="text-[11px] uppercase tracking-wider text-mist-400">
            Welches Fahrzeug gibst du ab?
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {myVehicleIds.map((id) => {
              const v = requireVehicle(id);
              const active = id === mineId;
              const f = listing ? fitsWish(listing.wish, v) : null;
              return (
                <button
                  key={id}
                  onClick={() => {
                    setMineId(id);
                    setOffer(null);
                  }}
                  className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? "border-volt-600/45 bg-volt-500/[0.07]"
                      : "border-ink-700 bg-ink-850 hover:border-ink-600"
                  }`}
                >
                  <VehicleVisual id={v.id} body={v.body} className="h-12 w-20 shrink-0 rounded-md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-mist-100">
                      {v.make} {v.model}
                    </p>
                    <p className="truncate text-xs text-mist-400 tabular">
                      {chf(valuate(v).value)}
                    </p>
                    {f && (
                      <span className="mt-1 inline-block text-[11px]">
                        {f.ok ? (
                          <span className="text-volt-400">passt zur Wunschliste</span>
                        ) : (
                          <span className="text-mist-400">ausserhalb der Wunschliste</span>
                        )}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Direktvergleich */}
        <Card className="p-5">
          <p className="text-[11px] uppercase tracking-wider text-mist-400">Direktvergleich</p>
          <p className="mt-1 text-[11px] text-mist-500 sm:hidden">
            Tabelle horizontal scrollen für beide Fahrzeuge
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-ink-800">
                  <th className="pb-2 text-left font-medium text-mist-400">Merkmal</th>
                  <th className="pb-2 text-right font-medium text-mist-200">
                    {mine.make} {mine.model}
                  </th>
                  <th className="pb-2 text-right font-medium text-volt-400">
                    {target.make} {target.model}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                <CompareRow label="Baujahr" a={mine.year} b={target.year} better="high" />
                <CompareRow
                  label="Kilometer"
                  a={mine.mileageKm}
                  b={target.mileageKm}
                  format={km}
                  better="low"
                />
                <CompareRow label="Leistung" a={mine.powerPs} b={target.powerPs} format={(n) => `${n} PS`} better="high" />
                <CompareRow
                  label="Reichweite"
                  a={mine.rangeKm ?? 0}
                  b={target.rangeKm ?? 0}
                  format={(n) => (n ? km(n) : "—")}
                  better="high"
                />
                <CompareRow
                  label="Batterie SoH"
                  a={mine.batterySoh ?? 0}
                  b={target.batterySoh ?? 0}
                  format={(n) => (n ? `${n} %` : "—")}
                  better="high"
                />
                <tr>
                  <td className="py-2 text-mist-400">Antrieb</td>
                  <td className="py-2 text-right text-mist-200">{label.drive(mine.drivetrain)}</td>
                  <td className="py-2 text-right text-mist-200">{label.drive(target.drivetrain)}</td>
                </tr>
                <CompareRow
                  label="Marktwert"
                  a={fair.giveValue}
                  b={fair.getValue}
                  format={(n) => chf(n)}
                  better="high"
                />
              </tbody>
            </table>
          </div>
        </Card>

        {/* Wertverlauf beider Fahrzeuge */}
        <Card className="p-5">
          <p className="text-[11px] uppercase tracking-wider text-mist-400">
            Wertentwicklung im Vergleich
          </p>
          <p className="mt-1 text-sm text-mist-400">
            Grün: dein {mine.make} {mine.model}. Blau: der {target.make} {target.model}. Wo die
            Kurven auseinanderlaufen, verschiebt sich auch der faire Ausgleich.
          </p>
          <div className="mt-4">
            <ValueChart
              points={histMine}
              comparePoints={histTarget}
              compareLabel={`${target.make} ${target.model}`}
            />
          </div>
        </Card>
      </div>

      {/* --------------- Angebot --------------- */}
      <div className="min-w-0 space-y-5 lg:sticky lg:top-24 lg:self-start">
        <Card className="p-5">
          <p className="text-[11px] uppercase tracking-wider text-mist-400">Dein Angebot</p>

          <div className="mt-4 rounded-lg border border-ink-700 bg-ink-850 p-4">
            <p className="text-xs text-mist-400">
              {current > 0 ? "Du zahlst zusätzlich" : current < 0 ? "Du erhältst zusätzlich" : "Reiner Tausch"}
            </p>
            <p
              className={`mt-1 text-3xl font-semibold tabular ${
                current > 0 ? "text-amber-warn" : current < 0 ? "text-good" : "text-mist-100"
              }`}
            >
              {chf(Math.abs(current))}
            </p>
            <input
              type="range"
              min={sliderMin}
              max={sliderMax}
              step={100}
              value={current}
              onChange={(e) => setOffer(Number(e.target.value))}
              className="mt-4 w-full accent-volt-500"
              aria-label="Ausgleichszahlung anpassen"
            />
            <div className="flex justify-between text-[11px] text-mist-400 tabular">
              <span>{chf(sliderMin, { compact: true })}</span>
              <span>{chf(sliderMax, { compact: true })}</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <Badge tone={fairness.tone}>{fairness.text}</Badge>
              {offer !== null && (
                <button
                  onClick={() => setOffer(null)}
                  className="text-xs text-mist-400 hover:text-mist-200"
                >
                  zurücksetzen
                </button>
              )}
            </div>
          </div>

          <dl className="mt-4 space-y-2 text-sm">
            <Line label={`Wert ${mine.make} ${mine.model}`} value={chf(fair.giveValue)} />
            <Line label={`Wert ${target.make} ${target.model}`} value={chf(fair.getValue)} />
            {fair.premium > 0 && (
              <Line label="Aufschlag des Inserenten" value={chf(fair.premium)} />
            )}
            <div className="border-t border-ink-800 pt-2">
              <Line
                label="Berechneter Ausgleich"
                value={chf(fair.delta, { sign: true })}
                strong
              />
            </div>
          </dl>

          {listing && (
            <div className="mt-4 space-y-2 border-t border-ink-800 pt-4 text-xs">
              <StatusLine
                ok={!!fit?.ok}
                good={`Dein Fahrzeug entspricht der Wunschliste von ${owner?.name}`}
                bad={fit?.misses[0] ?? "Dein Fahrzeug steht nicht auf der Wunschliste"}
              />
              <StatusLine
                ok={withinTheirRange}
                good="Der Betrag liegt im Rahmen der Gegenseite"
                bad={`${owner?.name} hat angegeben, ${
                  listing.wish.maxCashOut !== undefined && listing.wish.maxCashOut < 0
                    ? `mindestens ${chf(Math.abs(listing.wish.maxCashOut))} erhalten zu wollen`
                    : `höchstens ${chf(listing.wish.maxCashOut ?? 0)} zuzahlen zu wollen`
                }`}
              />
            </div>
          )}

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder={`Nachricht an ${owner?.name ?? "den Besitzer"} — je konkreter, desto eher kommt eine Antwort.`}
            className="mt-4 w-full resize-none rounded-lg border border-ink-700 bg-ink-850 p-3 text-sm text-mist-100 outline-none placeholder:text-mist-500 focus:border-ink-500"
          />

          <button
            onClick={send}
            disabled={sending || !owner}
            className="mt-3 w-full rounded-lg bg-volt-500 py-2.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-volt-400 disabled:opacity-50"
          >
            {sending ? "Wird gesendet …" : "Tauschvorschlag senden"}
          </button>
          <p className="mt-2 text-center text-[11px] text-mist-400">
            Unverbindlich. Geld fliesst erst nach beidseitiger Zusage über das Treuhandkonto.
          </p>
        </Card>

        <Card className="p-5">
          <p className="text-[11px] uppercase tracking-wider text-mist-400">Danach passiert</p>
          <ol className="mt-3 space-y-3 text-sm text-mist-300">
            <li className="flex gap-3">
              <Step n={1} /> {owner?.name ?? "Der Besitzer"} kann annehmen, ablehnen oder ein
              Gegenangebot machen.
            </li>
            <li className="flex gap-3">
              <Step n={2} /> Bei Einigung wird der Ausgleich auf dem Treuhandkonto hinterlegt.
            </li>
            <li className="flex gap-3">
              <Step n={3} /> Nach beidseitiger Übergabebestätigung erfolgt die Auszahlung.
            </li>
          </ol>
          <Link
            href={`/fahrzeug/${target.id}`}
            className="mt-4 block text-sm text-volt-400 hover:text-volt-300"
          >
            Zurück zum Inserat →
          </Link>
        </Card>
      </div>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? "text-mist-200" : "text-mist-400"}>{label}</dt>
      <dd className={`tabular ${strong ? "font-semibold text-mist-100" : "text-mist-200"}`}>
        {value}
      </dd>
    </div>
  );
}

function CompareRow({
  label,
  a,
  b,
  format = (n: number) => String(n),
  better,
}: {
  label: string;
  a: number;
  b: number;
  format?: (n: number) => string;
  better: "high" | "low";
}) {
  const aWins = better === "high" ? a > b : a < b;
  const bWins = better === "high" ? b > a : b < a;
  const missing = a === 0 && b === 0;
  return (
    <tr>
      <td className="py-2 text-mist-400">{label}</td>
      <td className={`py-2 text-right tabular ${!missing && aWins ? "text-good" : "text-mist-200"}`}>
        {format(a)}
      </td>
      <td className={`py-2 text-right tabular ${!missing && bWins ? "text-good" : "text-mist-200"}`}>
        {format(b)}
      </td>
    </tr>
  );
}

function StatusLine({ ok, good, bad }: { ok: boolean; good: string; bad: string }) {
  return (
    <p className={`flex gap-2 ${ok ? "text-good" : "text-amber-warn"}`}>
      <span aria-hidden>{ok ? "✓" : "!"}</span>
      <span className="text-mist-300">{ok ? good : bad}</span>
    </p>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink-700 text-[11px] font-semibold text-mist-200 tabular">
      {n}
    </span>
  );
}
