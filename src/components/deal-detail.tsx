"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { VehicleVisual } from "@/components/vehicle-visual";
import { STATUS_META } from "@/components/deal-list";
import { Badge, Card } from "@/components/ui";
import {
  acceptDealAction,
  cancelDealAction,
  confirmHandoverAction,
  rejectDealAction,
  sendDealMessageAction,
  startEscrowAction,
} from "@/app/actions/deals";
import { chf, dateLabel, dayMonth, km } from "@/lib/format";
import { cashDelta } from "@/lib/matching";
import type { DealDetail as DealDetailData } from "@/lib/queries";
import type { DealStatus, Vehicle } from "@/lib/types";

const STEPS: DealStatus[] = ["vorschlag", "verhandlung", "angenommen", "treuhand", "abgeschlossen"];

const HANDOVER_TASKS = [
  "Fahrzeugausweise beidseitig geprüft",
  "Probefahrt und Zustandskontrolle erfolgt",
  "Kaufverträge (zwei Richtungen) unterschrieben",
  "Halterwechsel beim Strassenverkehrsamt gemeldet",
  "Versicherung auf das neue Fahrzeug umgeschrieben",
  "Schlüssel, Ladekabel und Serviceheft übergeben",
];

interface PaymentSummary {
  status: string;
  amountMinor: number;
  feeMinor: number;
  payerId: string;
  payeeId: string;
}

export function DealDetail({
  detail,
  meId,
  payment,
  escrowFeeMinor,
  paymentsEnabled,
  escrowNotice,
  asOf,
}: {
  detail: DealDetailData;
  meId: string;
  payment: PaymentSummary | null;
  /** Zahlungsgebühr in Rappen, die beim Hinterlegen dazukommt */
  escrowFeeMinor: number;
  paymentsEnabled: boolean;
  escrowNotice: string | null;
  asOf: string;
}) {
  const router = useRouter();
  const { deal, fromVehicle, toVehicle, other, iAmInitiator, authors } = detail;

  const [text, setText] = useState("");
  /**
   * Der Betrag wird als Text geführt, nicht als Zahl. Ein Zahlenfeld liefert
   * beim Leeren und bei der Zwischeneingabe «-» den leeren String; Number("")
   * ist 0, und ein kontrolliertes Feld schriebe daraufhin sofort «0» zurück —
   * ein negativer Betrag liesse sich gar nicht eintippen.
   */
  const [counter, setCounter] = useState<string | null>(null);
  const [tasks, setTasks] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(escrowNotice);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const iGive = iAmInitiator ? fromVehicle : toVehicle;
  const iGet = iAmInitiator ? toVehicle : fromVehicle;
  const myCash = iAmInitiator ? deal.cashDelta : -deal.cashDelta;

  const fair = cashDelta(fromVehicle, toVehicle, 0, asOf);
  const spread = deal.cashDelta - fair.delta;
  const meta = STATUS_META[deal.status];
  // Die Abwicklung ist ein Zwischenschritt der Treuhandphase, kein eigener Punkt
  // in der Fortschrittsleiste.
  const stepIndex = STEPS.indexOf(deal.status === "abwicklung" ? "treuhand" : deal.status);
  const active = !["abgeschlossen", "abgelehnt", "storniert"].includes(deal.status);
  const allTasksDone = tasks.length === HANDOVER_TASKS.length;

  const iPay = deal.cashDelta !== 0 && myCash > 0;
  const myConfirmed = iAmInitiator ? deal.initiatorConfirmed : deal.counterpartyConfirmed;
  const otherConfirmed = iAmInitiator ? deal.counterpartyConfirmed : deal.initiatorConfirmed;

  const lastOfferAuthor = [...deal.messages].reverse().find((m) => m.offerCash !== undefined)?.authorId;
  const canAccept = lastOfferAuthor !== meId;

  function run(fn: () => Promise<{ ok?: boolean; error?: string; redirectTo?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.redirectTo) {
        window.location.href = res.redirectTo;
        return;
      }
      router.refresh();
    });
  }

  // Leeres Feld heisst «kein Angebot», nicht «Ausgleich null».
  const counterZahl =
    counter !== null && counter.trim() !== "" && Number.isFinite(Number(counter))
      ? Math.round(Number(counter))
      : null;

  function send() {
    if (!text.trim() && counterZahl === null) return;
    run(async () => {
      const res = await sendDealMessageAction(deal.id, text, counterZahl ?? undefined);
      if (!res.error) {
        setText("");
        setCounter(null);
      }
      return res;
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="min-w-0 space-y-6">
        {/* Fortschritt */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge tone={meta.tone}>{meta.text}</Badge>
            <span className="text-xs text-ink-3 tabular">
              gestartet am {dateLabel(deal.createdAt)}
            </span>
          </div>
          {deal.status === "abgelehnt" || deal.status === "storniert" ? (
            <p className="mt-4 text-sm text-ink-3">
              {deal.status === "abgelehnt"
                ? "Dieser Vorgang wurde abgelehnt. Du kannst jederzeit einen neuen Vorschlag machen."
                : "Dieser Tausch wurde abgebrochen. Eine hinterlegte Zahlung wurde freigegeben."}
            </p>
          ) : (
            <ol className="mt-5 flex gap-1">
              {STEPS.map((s, i) => (
                <li key={s} className="flex-1">
                  <div className={`h-1 rounded-full ${i <= stepIndex ? "bg-volt-ink" : "bg-line-strong"}`} />
                  <p
                    className={`mt-2 text-[10px] uppercase tracking-wide sm:text-[11px] ${
                      i <= stepIndex ? "text-ink-2" : "text-ink-3"
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
              <span className="text-2xl text-ink-3" aria-hidden>
                ⇄
              </span>
            </div>
            <SideCard vehicle={iGet} caption="Du erhältst" highlight />
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-ink-3">
                  Aktueller Ausgleich
                </p>
                <p
                  className={`mt-1 text-2xl font-semibold tabular ${
                    myCash > 0 ? "text-warn" : myCash < 0 ? "text-good" : "text-ink"
                  }`}
                >
                  {myCash > 0 ? "Du zahlst " : myCash < 0 ? "Du erhältst " : "Ohne Ausgleich"}
                  {myCash !== 0 && chf(Math.abs(myCash))}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wider text-ink-3">Modellrechnung</p>
                <p className="mt-1 text-sm tabular text-ink-2">
                  {chf(iAmInitiator ? fair.delta : -fair.delta, { sign: true })} aus deiner Sicht
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {Math.abs(spread) < 500
                    ? "Angebot liegt im marktgerechten Bereich"
                    : `${chf(Math.abs(spread))} ${spread > 0 ? "über" : "unter"} dem rechnerischen Wertunterschied`}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Nachrichten */}
        <Card className="p-5">
          <p className="text-[11px] uppercase tracking-wider text-ink-3">Verlauf</p>
          <ul className="mt-4 space-y-4">
            {deal.messages.map((m) => {
              const mine = m.authorId === meId;
              const author = authors.get(m.authorId);
              if (m.system) {
                return (
                  <li key={m.id} className="text-center">
                    <span className="inline-block rounded-full bg-surface-2 px-3 py-1 text-[11px] text-ink-3">
                      {m.text} · {dayMonth(m.at)}
                    </span>
                  </li>
                );
              }
              return (
                <li key={m.id} className={`flex gap-3 ${mine ? "flex-row-reverse" : ""}`}>
                  <span
                    className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-ink"
                    style={{ background: author?.avatarColor ?? "#e9ece4" }}
                  >
                    {(author?.name ?? "?").slice(0, 1)}
                  </span>
                  <div className={`max-w-[76%] ${mine ? "text-right" : ""}`}>
                    <div
                      className={`rounded-xl px-3.5 py-2.5 text-left text-sm leading-relaxed ${
                        mine ? "bg-volt/30 text-ink" : "bg-surface-2 text-ink-2"
                      }`}
                    >
                      {m.text}
                    </div>
                    <p className="mt-1 text-[11px] text-ink-3 tabular">
                      {mine ? "Du" : (author?.name ?? "Unbekannt")} · {dayMonth(m.at)}
                      {m.offerCash !== undefined && (
                        <> · <span className="text-ink-2">Angebot {chf(m.offerCash, { sign: true })}</span></>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          {active && (
            <div className="mt-5 border-t border-line pt-4">
              <label className="sr-only" htmlFor="deal-message">
                Nachricht
              </label>
              <textarea
                id="deal-message"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder={`Antwort an ${other.name} …`}
                className="w-full resize-none rounded-lg border border-line-strong bg-surface p-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-volt-ink"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {(deal.status === "vorschlag" || deal.status === "verhandlung") && (
                  <>
                    <label className="flex items-center gap-2 text-sm text-ink-3">
                      <input
                        type="checkbox"
                        checked={counter !== null}
                        onChange={(e) => setCounter(e.target.checked ? String(deal.cashDelta) : null)}
                        className="accent-volt-ink"
                      />
                      Gegenangebot
                    </label>
                    {counter !== null && (
                      <input
                        type="number"
                        step={100}
                        value={counter}
                        onChange={(e) => setCounter(e.target.value)}
                        className="w-36 rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm tabular text-ink outline-none focus:border-volt-ink"
                        aria-label="Gegenangebot in CHF"
                      />
                    )}
                  </>
                )}
                <button
                  onClick={send}
                  disabled={pending}
                  className="ml-auto rounded-lg bg-volt px-4 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-volt-hi disabled:opacity-60"
                >
                  Senden
                </button>
              </div>
              {counter !== null && (
                <p className="mt-2 text-xs text-ink-3">
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
          <p className="text-[11px] uppercase tracking-wider text-ink-3">Nächster Schritt</p>

          {(notice || error) && (
            <p
              role={error ? "alert" : "status"}
              className={`mt-3 rounded-lg border p-3 text-sm ${
                error ? "border-bad/35 bg-bad/12 text-bad" : "border-line bg-surface-2 text-ink-2"
              }`}
            >
              {error ?? notice}
            </p>
          )}

          {(deal.status === "vorschlag" || deal.status === "verhandlung") && (
            <>
              <p className="mt-3 text-sm text-ink-2">
                Solange noch verhandelt wird, fliesst kein Geld. Mit der Zusage wird der Betrag
                verbindlich.
              </p>
              {canAccept ? (
                <button
                  onClick={() => run(() => acceptDealAction(deal.id))}
                  disabled={pending}
                  className="mt-4 w-full rounded-lg bg-volt py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-volt-hi disabled:opacity-60"
                >
                  Angebot annehmen
                </button>
              ) : (
                <p className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-3">
                  Du hast das aktuelle Angebot gemacht — {other.name} ist am Zug.
                </p>
              )}
              <button
                onClick={() => run(() => rejectDealAction(deal.id))}
                disabled={pending}
                className="mt-2 w-full rounded-lg border border-line-strong py-2.5 text-sm text-ink-2 transition-colors hover:border-bad/45 hover:text-bad disabled:opacity-60"
              >
                Ablehnen
              </button>
            </>
          )}

          {deal.status === "angenommen" && (
            <>
              <p className="mt-3 text-sm text-ink-2">
                {deal.cashDelta === 0 ? (
                  "Die Werte gleichen sich aus — es ist keine Zahlung nötig. Weiter zur Übergabe."
                ) : iPay ? (
                  <>
                    Beide Seiten sind sich einig. Jetzt wird der Ausgleich von{" "}
                    <span className="font-semibold tabular text-ink">{chf(Math.abs(myCash))}</span>{" "}
                    hinterlegt. Freigegeben wird er erst, wenn beide Fahrzeuge übergeben sind.
                  </>
                ) : (
                  <>
                    {other.name} hinterlegt jetzt den Ausgleich von{" "}
                    <span className="font-semibold tabular text-ink">{chf(Math.abs(myCash))}</span>.
                    Sobald das erledigt ist, geht es zur Übergabe.
                  </>
                )}
              </p>
              {(iPay || deal.cashDelta === 0) && (
                <button
                  onClick={() => run(() => startEscrowAction(deal.id))}
                  disabled={pending || (!paymentsEnabled && deal.cashDelta !== 0)}
                  className="mt-4 w-full rounded-lg bg-volt py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-volt-hi disabled:opacity-50"
                >
                  {pending
                    ? "Wird vorbereitet …"
                    : deal.cashDelta === 0
                      ? "Weiter zur Übergabe"
                      : "Ausgleich hinterlegen"}
                </button>
              )}
              {deal.cashDelta !== 0 && (
                <p className="mt-2 text-center text-[11px] text-ink-3">
                  {paymentsEnabled ? (
                    iPay ? (
                      <>
                        Zahlung über Stripe · Betrag wird reserviert, nicht sofort belastet ·
                        zzgl. {chf(escrowFeeMinor / 100)} Zahlungsgebühr
                      </>
                    ) : (
                      "Zahlung über Stripe · Betrag wird reserviert, nicht sofort belastet"
                    )
                  ) : (
                    "Zahlungen sind auf dieser Installation noch nicht eingerichtet."
                  )}
                </p>
              )}
              <button
                onClick={() => run(() => cancelDealAction(deal.id))}
                disabled={pending}
                className="mt-2 w-full rounded-lg border border-line-strong py-2.5 text-sm text-ink-2 transition-colors hover:border-bad/45 hover:text-bad disabled:opacity-60"
              >
                Tausch abbrechen
              </button>
            </>
          )}

          {deal.status === "treuhand" && (
            <>
              <p className="mt-3 text-sm text-ink-2">
                {payment
                  ? "Der Betrag ist reserviert. Arbeitet die Checkliste ab und bestätigt anschliessend die Übergabe — danach erfolgt die Auszahlung."
                  : "Kein Ausgleich nötig. Arbeitet die Checkliste ab und bestätigt die Übergabe."}
              </p>

              <div className="mt-4 flex gap-2 text-xs">
                <ConfirmChip label="Du" done={Boolean(myConfirmed)} />
                <ConfirmChip label={other.name} done={Boolean(otherConfirmed)} />
              </div>

              {!myConfirmed && (
                <>
                  <ul className="mt-4 space-y-2">
                    {HANDOVER_TASKS.map((t) => {
                      const done = tasks.includes(t);
                      return (
                        <li key={t}>
                          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-2">
                            <input
                              type="checkbox"
                              checked={done}
                              onChange={() =>
                                setTasks(done ? tasks.filter((x) => x !== t) : [...tasks, t])
                              }
                              className="mt-0.5 accent-volt-ink"
                            />
                            <span className={done ? "text-ink-3 line-through" : ""}>{t}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <button
                    onClick={() => run(() => confirmHandoverAction(deal.id))}
                    disabled={!allTasksDone || pending}
                    className="mt-4 w-full rounded-lg bg-volt py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-volt-hi disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Übergabe bestätigen
                  </button>
                  {!allTasksDone && (
                    <p className="mt-2 text-center text-[11px] text-ink-3">
                      Noch {HANDOVER_TASKS.length - tasks.length} Punkt(e) offen
                    </p>
                  )}
                </>
              )}

              {myConfirmed && !otherConfirmed && (
                <p className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-3">
                  Deine Bestätigung ist vermerkt. Sobald {other.name} ebenfalls bestätigt, wird der
                  Ausgleich ausgezahlt.
                </p>
              )}

              {myConfirmed && otherConfirmed && (
                <>
                  <p className="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-ink-2">
                    Beide Bestätigungen liegen vor, die Auszahlung ist aber noch nicht
                    durchgelaufen. Die Fahrzeuge sind bewusst noch nicht umgeschrieben — sie
                    wechseln erst, wenn das Geld beim Empfänger ist.
                  </p>
                  <button
                    onClick={() => run(() => confirmHandoverAction(deal.id))}
                    disabled={pending}
                    className="mt-3 w-full rounded-lg bg-volt py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-volt-hi disabled:opacity-50"
                  >
                    {pending ? "Wird abgewickelt …" : "Auszahlung erneut anstossen"}
                  </button>
                </>
              )}

              <button
                onClick={() => run(() => cancelDealAction(deal.id))}
                disabled={pending}
                className="mt-2 w-full rounded-lg border border-line-strong py-2.5 text-sm text-ink-2 transition-colors hover:border-bad/45 hover:text-bad disabled:opacity-60"
              >
                Tausch abbrechen und Zahlung freigeben
              </button>
            </>
          )}

          {deal.status === "abwicklung" && (
            <>
              <p className="mt-3 rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-2">
                Beide haben die Übergabe bestätigt. Der Ausgleich wird eingezogen und
                weitergeleitet — danach werden die Fahrzeuge umgeschrieben. Das dauert nur einen
                Moment.
              </p>
              <button
                onClick={() => run(() => confirmHandoverAction(deal.id))}
                disabled={pending}
                className="mt-3 w-full rounded-lg border border-line-strong py-2.5 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-60"
              >
                {pending ? "Wird geprüft …" : "Stand prüfen und fortsetzen"}
              </button>
              <p className="mt-2 text-center text-[11px] text-ink-3">
                Bleibt es länger als ein paar Minuten hier stehen, setzt dieser Knopf die
                Abwicklung fort.
              </p>
            </>
          )}

          {deal.status === "abgeschlossen" && (
            <p className="mt-3 text-sm text-ink-2">
              Tausch abgeschlossen. Der Ausgleich wurde freigegeben und die Fahrzeuge sind in euren
              Garagen umgeschrieben.
            </p>
          )}

          {(deal.status === "abgelehnt" || deal.status === "storniert") && (
            <Link
              href={`/tausch/${toVehicle.id}?mine=${fromVehicle.id}`}
              className="mt-3 block rounded-lg border border-line-strong py-2.5 text-center text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
            >
              Neuen Vorschlag machen
            </Link>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <span
              className="grid h-10 w-10 place-items-center rounded-full text-sm font-semibold text-ink"
              style={{ background: other.avatarColor }}
            >
              {other.name.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{other.name}</p>
              <p className="truncate text-xs text-ink-3">
                {other.location || "Ort nicht angegeben"}
                {other.rating !== null && ` · ${other.rating.toFixed(1)} ★`} ·{" "}
                {other.swapsCompleted} Tausche
              </p>
            </div>
            {other.verified && (
              <span className="ml-auto shrink-0">
                <Badge tone="good">verifiziert</Badge>
              </span>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-[11px] uppercase tracking-wider text-ink-3">Wie die Treuhand wirkt</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-3">
            Der Ausgleich wird bei der Zusage reserviert, aber erst nach beidseitiger
            Übergabebestätigung eingezogen und ausgezahlt. Damit trägt keine der beiden Seiten das
            Risiko, in Vorleistung zu gehen — der klassische Schwachpunkt beim Privattausch.
          </p>
        </Card>
      </div>
    </div>
  );
}

function ConfirmChip({ label, done }: { label: string; done: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 ${
        done ? "border-good/35 bg-good/12 text-good" : "border-line bg-surface-2 text-ink-3"
      }`}
    >
      <span aria-hidden>{done ? "✓" : "○"}</span>
      {label}
    </span>
  );
}

function SideCard({
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
      className={`rounded-lg border p-3 ${
        highlight ? "border-volt-ink/35 bg-volt/20" : "border-line bg-surface-2"
      }`}
    >
      <p className="text-[11px] uppercase tracking-wider text-ink-3">{caption}</p>
      <VehicleVisual
        id={vehicle.id}
        body={vehicle.body}
        className="mt-2 aspect-[16/9] w-full rounded-md"
      />
      <p className="mt-2 truncate text-sm font-medium text-ink">
        {vehicle.make} {vehicle.model}
      </p>
      <p className="truncate text-xs text-ink-3 tabular">
        {vehicle.year} · {km(vehicle.mileageKm)}
      </p>
      <Link
        href={`/fahrzeug/${vehicle.id}`}
        className="mt-1.5 inline-block text-xs text-volt-ink hover:underline"
      >
        Details →
      </Link>
    </div>
  );
}
