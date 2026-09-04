"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ValueChart } from "@/components/value-chart";
import { VehicleVisual } from "@/components/vehicle-visual";
import { Badge, Card } from "@/components/ui";
import { proposeSwapAction } from "@/app/actions/deals";
import { chf, km, label, vehicleFullTitle } from "@/lib/format";
import { cashDelta, fitsWish } from "@/lib/matching";
import type { Listing, User, Vehicle } from "@/lib/types";
import { valuate, valueHistory } from "@/lib/valuation";

export function SwapConfigurator({
  target,
  listing,
  owner,
  myVehicles,
  defaultMineId,
  asOf,
}: {
  target: Vehicle;
  listing: Listing;
  owner: User;
  myVehicles: Vehicle[];
  defaultMineId?: string;
  asOf: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [mineId, setMineId] = useState(
    defaultMineId && myVehicles.some((v) => v.id === defaultMineId)
      ? defaultMineId
      : myVehicles[0].id,
  );
  const mine = myVehicles.find((v) => v.id === mineId) ?? myVehicles[0];

  const fair = useMemo(
    () => cashDelta(mine, target, listing.askPremium ?? 0),
    [mine, target, listing],
  );
  const [offer, setOffer] = useState<number | null>(null);
  const current = offer ?? fair.delta;

  const [message, setMessage] = useState("");

  const fit = fitsWish(listing.wish, mine);
  const theirPayment = -current;
  const withinTheirRange =
    listing.wish.maxCashOut === undefined || theirPayment <= listing.wish.maxCashOut + 1;

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

  const histMine = useMemo(() => valueHistory(mine, 18, 12, asOf), [mine, asOf]);
  const histTarget = useMemo(() => valueHistory(target, 18, 12, asOf), [target, asOf]);

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await proposeSwapAction({
        fromVehicleId: mine.id,
        toVehicleId: target.id,
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
      if (res.dealId) {
        router.push(`/deals/${res.dealId}`);
      } else {
        setError(res.error ?? "Der Vorschlag konnte nicht gesendet werden.");
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="min-w-0 space-y-6">
        {/* Auswahl des eigenen Fahrzeugs */}
        <Card className="p-5">
          <p className="text-[11px] uppercase tracking-wider text-ink-3">
            Welches Fahrzeug gibst du ab?
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {myVehicles.map((v) => {
              const active = v.id === mineId;
              const f = fitsWish(listing.wish, v);
              return (
                <button
                  key={v.id}
                  onClick={() => {
                    setMineId(v.id);
                    setOffer(null);
                  }}
                  className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? "border-volt-ink/40 bg-volt/25"
                      : "border-line bg-surface-2 hover:border-line-strong"
                  }`}
                >
                  <VehicleVisual id={v.id} body={v.body} className="h-12 w-20 shrink-0 rounded-md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {v.make} {v.model}
                    </p>
                    <p className="truncate text-xs text-ink-3 tabular">
                      {chf(valuate(v, asOf).value)}
                    </p>
                    {f && (
                      <span className="mt-1 inline-block text-[11px]">
                        {f.ok ? (
                          <span className="text-volt-ink">passt zur Wunschliste</span>
                        ) : (
                          <span className="text-ink-3">ausserhalb der Wunschliste</span>
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
          <p className="text-[11px] uppercase tracking-wider text-ink-3">Direktvergleich</p>
          <p className="mt-1 text-[11px] text-ink-3 sm:hidden">
            Tabelle horizontal scrollen für beide Fahrzeuge
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="pb-2 text-left font-medium text-ink-3">Merkmal</th>
                  <th className="pb-2 text-right font-medium text-ink-2">
                    {mine.make} {mine.model}
                  </th>
                  <th className="pb-2 text-right font-medium text-volt-ink">
                    {target.make} {target.model}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
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
                  <td className="py-2 text-ink-3">Antrieb</td>
                  <td className="py-2 text-right text-ink-2">{label.drive(mine.drivetrain)}</td>
                  <td className="py-2 text-right text-ink-2">{label.drive(target.drivetrain)}</td>
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
          <p className="text-[11px] uppercase tracking-wider text-ink-3">
            Wertentwicklung im Vergleich
          </p>
          <p className="mt-1 text-sm text-ink-3">
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
          <p className="text-[11px] uppercase tracking-wider text-ink-3">Dein Angebot</p>

          <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4">
            <p className="text-xs text-ink-3">
              {current > 0 ? "Du zahlst zusätzlich" : current < 0 ? "Du erhältst zusätzlich" : "Reiner Tausch"}
            </p>
            <p
              className={`mt-1 text-3xl font-semibold tabular ${
                current > 0 ? "text-warn" : current < 0 ? "text-good" : "text-ink"
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
              className="mt-4 w-full accent-volt-ink"
              aria-label="Ausgleichszahlung anpassen"
            />
            <div className="flex justify-between text-[11px] text-ink-3 tabular">
              <span>{chf(sliderMin, { compact: true })}</span>
              <span>{chf(sliderMax, { compact: true })}</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <Badge tone={fairness.tone}>{fairness.text}</Badge>
              {offer !== null && (
                <button
                  onClick={() => setOffer(null)}
                  className="text-xs text-ink-3 hover:text-ink-2"
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
            <div className="border-t border-line pt-2">
              <Line
                label="Berechneter Ausgleich"
                value={chf(fair.delta, { sign: true })}
                strong
              />
            </div>
          </dl>

          <div className="mt-4 space-y-2 border-t border-line pt-4 text-xs">
            <StatusLine
              ok={fit.ok}
              good={`Dein Fahrzeug entspricht der Wunschliste von ${owner.name}`}
              bad={fit.misses[0] ?? "Dein Fahrzeug steht nicht auf der Wunschliste"}
            />
            <StatusLine
              ok={withinTheirRange}
              good="Der Betrag liegt im Rahmen der Gegenseite"
              bad={`${owner.name} hat angegeben, ${
                listing.wish.maxCashOut !== undefined && listing.wish.maxCashOut < 0
                  ? `mindestens ${chf(Math.abs(listing.wish.maxCashOut))} erhalten zu wollen`
                  : `höchstens ${chf(listing.wish.maxCashOut ?? 0)} zuzahlen zu wollen`
              }`}
            />
          </div>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder={`Nachricht an ${owner.name} — je konkreter, desto eher kommt eine Antwort.`}
            className="mt-4 w-full resize-none rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
          />

          {error && (
            <p role="alert" className="mt-3 rounded-lg border border-bad/35 bg-bad/12 p-3 text-sm text-bad">
              {error}
            </p>
          )}

          <button
            onClick={send}
            disabled={pending}
            className="mt-3 w-full rounded-lg bg-volt py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-volt-hi disabled:opacity-50"
          >
            {pending ? "Wird gesendet …" : "Tauschvorschlag senden"}
          </button>
          <p className="mt-2 text-center text-[11px] text-ink-3">
            Unverbindlich. Geld fliesst erst nach beidseitiger Zusage über das Treuhandkonto.
          </p>
        </Card>

        <Card className="p-5">
          <p className="text-[11px] uppercase tracking-wider text-ink-3">Danach passiert</p>
          <ol className="mt-3 space-y-3 text-sm text-ink-2">
            <li className="flex gap-3">
              <Step n={1} /> {owner.name} kann annehmen, ablehnen oder ein
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
            className="mt-4 block text-sm text-volt-ink hover:text-volt-ink"
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
      <dt className={strong ? "text-ink-2" : "text-ink-3"}>{label}</dt>
      <dd className={`tabular ${strong ? "font-semibold text-ink" : "text-ink-2"}`}>
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
      <td className="py-2 text-ink-3">{label}</td>
      <td className={`py-2 text-right tabular ${!missing && aWins ? "text-good" : "text-ink-2"}`}>
        {format(a)}
      </td>
      <td className={`py-2 text-right tabular ${!missing && bWins ? "text-good" : "text-ink-2"}`}>
        {format(b)}
      </td>
    </tr>
  );
}

function StatusLine({ ok, good, bad }: { ok: boolean; good: string; bad: string }) {
  return (
    <p className={`flex gap-2 ${ok ? "text-good" : "text-warn"}`}>
      <span aria-hidden>{ok ? "✓" : "!"}</span>
      <span className="text-ink-2">{ok ? good : bad}</span>
    </p>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-line-strong text-[11px] font-semibold text-ink-2 tabular">
      {n}
    </span>
  );
}
