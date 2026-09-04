"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { VehicleVisual } from "@/components/vehicle-visual";
import { STATUS_META } from "@/components/deal-list";
import { Badge, Card } from "@/components/ui";
import { CURRENT_USER_ID, getUser } from "@/lib/data/users";
import { getListingByVehicle, requireVehicle } from "@/lib/data/vehicles";
import { chf, dateLabel, dayMonth, km, vehicleFullTitle } from "@/lib/format";
import { cashDelta } from "@/lib/matching";
import { useStore } from "@/lib/store";
import type { DealStatus } from "@/lib/types";

const STEPS: DealStatus[] = ["vorschlag", "verhandlung", "angenommen", "treuhand", "abgeschlossen"];

const HANDOVER_TASKS = [
  "Fahrzeugausweise beidseitig geprüft",
  "Probefahrt und Zustandskontrolle erfolgt",
  "Kaufverträge (zwei Richtungen) unterschrieben",
  "Halterwechsel beim Strassenverkehrsamt gemeldet",
  "Versicherung auf das neue Fahrzeug umgeschrieben",
  "Schlüssel, Ladekabel und Serviceheft übergeben",
];

export function DealDetail({ id }: { id: string }) {
  const { deals, hydrated, addMessage, setDealStatus } = useStore();
  const search = useSearchParams();
  const deal = deals.find((d) => d.id === id);

  const [text, setText] = useState("");
  const [counter, setCounter] = useState<number | null>(null);
  const [tasks, setTasks] = useState<string[]>([]);
  const [escrowNote, setEscrowNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Rückkehr aus dem Stripe-Checkout
  const escrowParam = search.get("escrow");
  useEffect(() => {
    if (escrowParam === "ok" && deal && deal.status === "angenommen") {
      setDealStatus(deal.id, "treuhand");
      setEscrowNote("Einzahlung bestätigt — der Betrag liegt auf dem Treuhandkonto.");
    } else if (escrowParam === "abgebrochen") {
      setEscrowNote("Die Einzahlung wurde abgebrochen. Du kannst es jederzeit erneut versuchen.");
    }
  }, [escrowParam, deal, setDealStatus]);

  const view = useMemo(() => {
    if (!deal) return null;
    const from = requireVehicle(deal.fromVehicleId);
    const to = requireVehicle(deal.toVehicleId);
    const iAmInitiator = deal.initiatorId === CURRENT_USER_ID;
    return {
      from,
      to,
      iAmInitiator,
      other: getUser(iAmInitiator ? deal.counterpartyId : deal.initiatorId),
      iGive: iAmInitiator ? from : to,
      iGet: iAmInitiator ? to : from,
      myCash: iAmInitiator ? deal.cashDelta : -deal.cashDelta,
    };
  }, [deal]);

  if (!hydrated) {
    return <div className="h-96 animate-pulse rounded-xl border border-ink-800 bg-ink-900" />;
  }

  if (!deal || !view) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm text-mist-300">Dieser Tauschvorgang existiert nicht (mehr).</p>
        <Link href="/deals" className="mt-3 inline-block text-sm text-volt-400">
          Zurück zur Übersicht →
        </Link>
      </Card>
    );
  }

  const { from, to, other, iGive, iGet, myCash, iAmInitiator } = view;
  const listing = getListingByVehicle(to.id);
  const fair = cashDelta(from, to, listing?.askPremium ?? 0);
  const spread = deal.cashDelta - fair.delta;
  const meta = STATUS_META[deal.status];
  const stepIndex = STEPS.indexOf(deal.status);
  const active = !["abgeschlossen", "abgelehnt"].includes(deal.status);
  const allTasksDone = tasks.length === HANDOVER_TASKS.length;

  async function depositEscrow() {
    if (!deal) return;
    setBusy(true);
    setEscrowNote(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: deal.id,
          amount: Math.abs(deal.cashDelta),
          label: `Ausgleich ${vehicleFullTitle(from)} ⇄ ${vehicleFullTitle(to)}`,
        }),
      });
      const data = (await res.json()) as { mode?: string; url?: string; error?: string };
      if (data.mode === "live" && data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.error) {
        setEscrowNote(data.error);
      } else {
        setDealStatus(deal.id, "treuhand");
        setEscrowNote(
          "Demo-Modus: Es ist kein Stripe-Schlüssel hinterlegt, die Einzahlung wurde simuliert.",
        );
      }
    } catch {
      setEscrowNote("Die Verbindung zum Zahlungsdienst ist fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  function send() {
    if (!text.trim() && counter === null) return;
    addMessage(deal!.id, text.trim() || "Neues Angebot.", counter ?? undefined);
    setText("");
    setCounter(null);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="min-w-0 space-y-6">
        {/* Fortschritt */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge tone={meta.tone}>{meta.text}</Badge>
            <span className="text-xs text-mist-400 tabular">
              gestartet am {dateLabel(deal.createdAt)}
            </span>
          </div>
          {deal.status === "abgelehnt" ? (
            <p className="mt-4 text-sm text-mist-400">
              Dieser Vorgang wurde abgelehnt. Du kannst jederzeit einen neuen Vorschlag machen.
            </p>
          ) : (
            <ol className="mt-5 flex gap-1">
              {STEPS.map((s, i) => (
                <li key={s} className="flex-1">
                  <div
                    className={`h-1 rounded-full ${
                      i <= stepIndex ? "bg-volt-500" : "bg-ink-700"
                    }`}
                  />
                  <p
                    className={`mt-2 text-[10px] uppercase tracking-wide sm:text-[11px] ${
                      i <= stepIndex ? "text-mist-200" : "text-mist-500"
                    }`}
                  >
                    {s}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>

        {/* Fahrzeuge */}
        <Card className="p-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <SideCard vehicle={iGive} caption="Du gibst" />
            <div className="flex items-center justify-center sm:flex-col">
              <span className="text-2xl text-mist-500" aria-hidden>
                ⇄
              </span>
            </div>
            <SideCard vehicle={iGet} caption="Du erhältst" highlight />
          </div>

          <div className="mt-5 border-t border-ink-800 pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-mist-400">
                  Aktueller Ausgleich
                </p>
                <p
                  className={`mt-1 text-2xl font-semibold tabular ${
                    myCash > 0 ? "text-amber-warn" : myCash < 0 ? "text-good" : "text-mist-100"
                  }`}
                >
                  {myCash > 0 ? "Du zahlst " : myCash < 0 ? "Du erhältst " : ""}
                  {chf(Math.abs(myCash))}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wider text-mist-400">
                  Modellrechnung
                </p>
                <p className="mt-1 text-sm tabular text-mist-300">
                  {chf(fair.delta, { sign: true })} aus Sicht von{" "}
                  {iAmInitiator ? "dir" : other.name}
                </p>
                <p className="mt-0.5 text-xs text-mist-400">
                  {Math.abs(spread) < 500
                    ? "Angebot liegt im marktgerechten Bereich"
                    : `Abweichung ${chf(Math.abs(spread))}`}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Nachrichten */}
        <Card className="p-5">
          <p className="text-[11px] uppercase tracking-wider text-mist-400">Verlauf</p>
          <ul className="mt-4 space-y-4">
            {deal.messages.map((m) => {
              const mine = m.authorId === CURRENT_USER_ID;
              const author = getUser(m.authorId);
              return (
                <li key={m.id} className={`flex gap-3 ${mine ? "flex-row-reverse" : ""}`}>
                  <span
                    className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-ink-950"
                    style={{ background: author.avatarColor }}
                  >
                    {author.name.slice(0, 1)}
                  </span>
                  <div className={`max-w-[76%] ${mine ? "text-right" : ""}`}>
                    <div
                      className={`rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        mine
                          ? "bg-volt-500/12 text-mist-100"
                          : "bg-ink-800 text-mist-200"
                      }`}
                    >
                      {m.text}
                    </div>
                    <p className="mt-1 text-[11px] text-mist-400 tabular">
                      {mine ? "Du" : author.name} ·{" "}
                      {dayMonth(m.at)}
                      {m.offerCash !== undefined && (
                        <>
                          {" · "}
                          <span className="text-mist-300">
                            Angebot {chf(m.offerCash, { sign: true })}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          {active && (
            <div className="mt-5 border-t border-ink-800 pt-4">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder={`Antwort an ${other.name} …`}
                className="w-full resize-none rounded-lg border border-ink-700 bg-ink-850 p-3 text-sm text-mist-100 outline-none placeholder:text-mist-500 focus:border-ink-500"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-mist-400">
                  <input
                    type="checkbox"
                    checked={counter !== null}
                    onChange={(e) => setCounter(e.target.checked ? deal.cashDelta : null)}
                    className="accent-volt-500"
                  />
                  Gegenangebot
                </label>
                {counter !== null && (
                  <input
                    type="number"
                    step={100}
                    value={counter}
                    onChange={(e) => setCounter(Number(e.target.value))}
                    className="w-36 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-sm tabular text-mist-100 outline-none focus:border-ink-500"
                    aria-label="Gegenangebot in CHF"
                  />
                )}
                <button
                  onClick={send}
                  className="ml-auto rounded-lg bg-volt-500 px-4 py-1.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-volt-400"
                >
                  Senden
                </button>
              </div>
              {counter !== null && (
                <p className="mt-2 text-xs text-mist-400">
                  Positiver Betrag: der Initiator zahlt drauf. Negativer Betrag: der Initiator
                  erhält Geld.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* --------------- Aktionen --------------- */}
      <div className="min-w-0 space-y-5 lg:sticky lg:top-24 lg:self-start">
        <Card className="p-5">
          <p className="text-[11px] uppercase tracking-wider text-mist-400">Nächster Schritt</p>

          {escrowNote && (
            <p className="mt-3 rounded-lg border border-ink-700 bg-ink-850 p-3 text-xs text-mist-300">
              {escrowNote}
            </p>
          )}

          {(deal.status === "vorschlag" || deal.status === "verhandlung") && (
            <>
              <p className="mt-3 text-sm text-mist-300">
                Solange noch verhandelt wird, fliesst kein Geld. Mit der Zusage wird der Betrag
                verbindlich.
              </p>
              <button
                onClick={() => setDealStatus(deal.id, "angenommen")}
                className="mt-4 w-full rounded-lg bg-volt-500 py-2.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-volt-400"
              >
                Angebot annehmen
              </button>
              <button
                onClick={() => setDealStatus(deal.id, "abgelehnt")}
                className="mt-2 w-full rounded-lg border border-ink-600 py-2.5 text-sm text-mist-300 transition-colors hover:border-bad/40 hover:text-bad"
              >
                Ablehnen
              </button>
            </>
          )}

          {deal.status === "angenommen" && (
            <>
              <p className="mt-3 text-sm text-mist-300">
                Beide Seiten sind sich einig. Jetzt wird der Ausgleich von{" "}
                <span className="font-semibold tabular text-mist-100">
                  {chf(Math.abs(deal.cashDelta))}
                </span>{" "}
                hinterlegt. Freigegeben wird er erst, wenn beide Fahrzeuge übergeben sind.
              </p>
              <button
                onClick={depositEscrow}
                disabled={busy}
                className="mt-4 w-full rounded-lg bg-volt-500 py-2.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-volt-400 disabled:opacity-50"
              >
                {busy ? "Wird vorbereitet …" : "Ausgleich hinterlegen"}
              </button>
              <p className="mt-2 text-center text-[11px] text-mist-400">
                Zahlung über Stripe · Betrag wird reserviert, nicht sofort belastet
              </p>
            </>
          )}

          {deal.status === "treuhand" && (
            <>
              <p className="mt-3 text-sm text-mist-300">
                Der Betrag liegt auf dem Treuhandkonto. Arbeitet die Checkliste ab und bestätigt
                anschliessend die Übergabe — danach erfolgt die Auszahlung.
              </p>
              <ul className="mt-4 space-y-2">
                {HANDOVER_TASKS.map((t) => {
                  const done = tasks.includes(t);
                  return (
                    <li key={t}>
                      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-mist-300">
                        <input
                          type="checkbox"
                          checked={done}
                          onChange={() =>
                            setTasks(done ? tasks.filter((x) => x !== t) : [...tasks, t])
                          }
                          className="mt-0.5 accent-volt-500"
                        />
                        <span className={done ? "text-mist-500 line-through" : ""}>{t}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <button
                onClick={() => setDealStatus(deal.id, "abgeschlossen")}
                disabled={!allTasksDone}
                className="mt-4 w-full rounded-lg bg-volt-500 py-2.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-volt-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Übergabe bestätigen und abschliessen
              </button>
              {!allTasksDone && (
                <p className="mt-2 text-center text-[11px] text-mist-400">
                  Noch {HANDOVER_TASKS.length - tasks.length} Punkt(e) offen
                </p>
              )}
            </>
          )}

          {deal.status === "abgeschlossen" && (
            <p className="mt-3 text-sm text-mist-300">
              Tausch abgeschlossen. Der Ausgleich wurde freigegeben und beide Fahrzeuge sind
              umgeschrieben.
            </p>
          )}

          {deal.status === "abgelehnt" && (
            <Link
              href={`/tausch/${to.id}?mine=${from.id}`}
              className="mt-3 block rounded-lg border border-ink-600 py-2.5 text-center text-sm text-mist-200 transition-colors hover:border-ink-500 hover:text-mist-100"
            >
              Neuen Vorschlag machen
            </Link>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <span
              className="grid h-10 w-10 place-items-center rounded-full text-sm font-semibold text-ink-950"
              style={{ background: other.avatarColor }}
            >
              {other.name.slice(0, 1)}
            </span>
            <div>
              <p className="text-sm font-medium text-mist-100">{other.name}</p>
              <p className="text-xs text-mist-400">
                {other.location} · {other.rating.toFixed(1)} ★ · {other.swapsCompleted} Tausche
              </p>
            </div>
            {other.verified && (
              <span className="ml-auto">
                <Badge tone="good">verifiziert</Badge>
              </span>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-[11px] uppercase tracking-wider text-mist-400">Wie die Treuhand wirkt</p>
          <p className="mt-2 text-sm leading-relaxed text-mist-400">
            Der Ausgleich wird bei der Zusage reserviert, aber erst nach beidseitiger
            Übergabebestätigung eingezogen und ausgezahlt. Damit trägt keine der beiden Seiten das
            Risiko, in Vorleistung zu gehen — der klassische Schwachpunkt beim Privattausch.
          </p>
        </Card>
      </div>
    </div>
  );
}

function SideCard({
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
      className={`rounded-lg border p-3 ${
        highlight ? "border-volt-600/35 bg-volt-500/[0.06]" : "border-ink-700 bg-ink-850"
      }`}
    >
      <p className="text-[11px] uppercase tracking-wider text-mist-400">{caption}</p>
      <VehicleVisual
        id={vehicle.id}
        body={vehicle.body}
        className="mt-2 aspect-[16/9] w-full rounded-md"
      />
      <p className="mt-2 truncate text-sm font-medium text-mist-100">
        {vehicle.make} {vehicle.model}
      </p>
      <p className="truncate text-xs text-mist-400 tabular">
        {vehicle.year} · {km(vehicle.mileageKm)}
      </p>
      <Link
        href={`/fahrzeug/${vehicle.id}`}
        className="mt-1.5 inline-block text-xs text-volt-400 hover:text-volt-300"
      >
        Details →
      </Link>
    </div>
  );
}
