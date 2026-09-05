"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { VehicleVisual } from "@/components/vehicle-visual";
import { ReviewForm } from "@/components/review-form";
import { Badge, Card } from "@/components/ui";
import {
  acceptRingAction,
  cancelRingAction,
  confirmRingHandoverAction,
  declineRingAction,
  sendRingMessageAction,
  startRingEscrowAction,
} from "@/app/actions/rings";
import { chf, dateLabel, dayMonth, km, vehicleFullTitle } from "@/lib/format";
import { ringTransfers } from "@/lib/rings";
import type { RingDetail as RingDetailData } from "@/lib/queries";
import type { RingStatusDb } from "@/lib/db/schema";

const STATUS_META: Record<
  RingStatusDb,
  { text: string; tone: "neutral" | "marke" | "good" | "bad" | "warn" | "info" }
> = {
  vorschlag: { text: "Vorschlag offen", tone: "info" },
  angenommen: { text: "Alle drei haben zugesagt", tone: "marke" },
  treuhand: { text: "Geld im Treuhandkonto", tone: "marke" },
  abwicklung: { text: "Auszahlung läuft", tone: "marke" },
  abgeschlossen: { text: "Abgeschlossen", tone: "good" },
  abgelehnt: { text: "Abgelehnt", tone: "bad" },
  storniert: { text: "Storniert", tone: "bad" },
};

/**
 * Eigene, kurze Beschriftung für die Fortschrittsleiste. Der Statustext taugt
 * dafür nicht: «Alle drei haben zugesagt» liest sich als Station schlecht — und
 * stünde zweimal auf der Seite, einmal als Zustand und einmal als Schritt.
 */
const STEPS: { status: RingStatusDb; label: string }[] = [
  { status: "vorschlag", label: "Vorschlag" },
  { status: "angenommen", label: "Zusagen" },
  { status: "treuhand", label: "Treuhand" },
  { status: "abgeschlossen", label: "Übergabe" },
];

const HANDOVER_TASKS = [
  "Fahrzeugausweise geprüft",
  "Probefahrt und Zustandskontrolle erfolgt",
  "Kaufverträge unterschrieben",
  "Halterwechsel beim Strassenverkehrsamt gemeldet",
  "Versicherung auf das neue Fahrzeug umgeschrieben",
  "Schlüssel, Ladekabel und Serviceheft übergeben",
];

const ZAHLUNG_TEXT: Record<string, string> = {
  erstellt: "noch nicht eingezahlt",
  autorisiert: "reserviert",
  eingezogen: "eingezogen",
  ausgezahlt: "ausgezahlt",
  storniert: "storniert",
  erstattet: "erstattet",
  fehlgeschlagen: "fehlgeschlagen",
};

export function RingDetail({
  ring,
  meId,
  feesMinor,
  paymentsEnabled,
  escrowNotice,
  meineBewertungen,
}: {
  ring: RingDetailData;
  meId: string;
  /** Zahlungsgebühr je Weg («zahlerId|empfaengerId») in Rappen */
  feesMinor: Record<string, number>;
  paymentsEnabled: boolean;
  escrowNotice: string | null;
  /** Bereits abgegebene eigene Bewertungen, je bewerteter Person. */
  meineBewertungen: Record<string, { stars: number; body: string | null }>;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [tasks, setTasks] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(escrowNotice);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const meIndex = ring.participants.findIndex((p) => p.user.id === meId);
  const me = ring.participants[meIndex];
  const nachId = new Map(ring.participants.map((p) => [p.user.id, p]));
  // Ich bekomme das Fahrzeug der Person, die mich als Empfänger nennt.
  const iGet = ring.participants.find((p) => p.receiverId === meId)!;

  const meta = STATUS_META[ring.status];
  const stepIndex = STEPS.findIndex(
    (s) => s.status === (ring.status === "abwicklung" ? "treuhand" : ring.status),
  );
  const aktiv = !["abgeschlossen", "abgelehnt", "storniert"].includes(ring.status);
  const alleTasks = tasks.length === HANDOVER_TASKS.length;

  const transfers = ringTransfers(
    ring.participants.map((p) => ({ userId: p.user.id, cash: p.cash })),
  );
  const meineZahlungen = transfers.filter((t) => t.payerId === meId);
  const zahlungStatus = (payerId: string, payeeId: string) =>
    ring.payments.find((p) => p.payerId === payerId && p.payeeId === payeeId)?.status ?? null;
  const meineOffenen = meineZahlungen.filter((t) => {
    const status = zahlungStatus(t.payerId, t.payeeId);
    return status !== "autorisiert" && status !== "eingezogen" && status !== "ausgezahlt";
  });

  const offeneZusagen = ring.participants.filter((p) => !p.accepted);
  const offeneBestaetigungen = ring.participants.filter((p) => !p.confirmed);

  function run(fn: () => Promise<{ ok?: boolean; error?: string; redirectTo?: string }>) {
    setError(null);
    setNotice(null);
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

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        {/* -------- Der Ring -------- */}
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Badge tone={meta.tone}>{meta.text}</Badge>
              <span className="text-xs text-ink-3">Ringtausch · seit {dateLabel(ring.createdAt)}</span>
            </div>
            <span
              className={`text-sm font-semibold tabular ${
                me.cash > 0 ? "text-warn" : me.cash < 0 ? "text-good" : "text-ink-3"
              }`}
            >
              {me.cash === 0
                ? "Kein Ausgleich"
                : me.cash > 0
                  ? `Du zahlst ${chf(me.cash)}`
                  : `Du erhältst ${chf(-me.cash)}`}
            </span>
          </div>

          {aktiv && (
            <ol className="mb-5 flex flex-wrap gap-1.5 text-xs">
              {STEPS.map((s, i) => (
                <li
                  key={s.status}
                  className={`rounded-md px-2 py-1 ${
                    i <= stepIndex
                      ? "bg-marke/30 font-medium text-ink"
                      : "bg-surface-2 text-ink-3"
                  }`}
                >
                  {i + 1}. {s.label}
                </li>
              ))}
            </ol>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            {ring.participants.map((p) => {
              const bekommt = nachId.get(p.receiverId);
              return (
                <div
                  key={p.user.id}
                  className={`rounded-lg border p-3 ${
                    p.user.id === meId
                      ? "border-marke/40 bg-marke/20"
                      : "border-line bg-surface-2"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="h-4 w-4 rounded-full"
                      style={{ background: p.user.avatarColor }}
                      aria-hidden
                    />
                    <span className="text-xs font-medium text-ink-2">
                      {p.user.id === meId ? "Du" : p.user.name}
                    </span>
                    <span className="ml-auto text-[11px] text-ink-3">{p.user.location}</span>
                  </div>
                  <VehicleVisual
                    id={p.gives.id}
                    body={p.gives.body}
                    className="mb-2 h-16 w-full rounded-md"
                  />
                  <p className="text-sm font-medium text-ink">{vehicleFullTitle(p.gives)}</p>
                  <p className="text-xs text-ink-3">
                    {p.gives.year} · {km(p.gives.mileageKm)}
                  </p>
                  <p className="mt-2 text-xs text-ink-2">
                    gibt an{" "}
                    <span className="font-medium text-ink">
                      {p.receiverId === meId ? "dich" : (bekommt?.user.name ?? "—")}
                    </span>
                  </p>
                  <p className="mt-1 text-xs tabular text-ink-2">
                    {p.cash === 0
                      ? "kein Ausgleich"
                      : p.cash > 0
                        ? `zahlt ${chf(p.cash)}`
                        : `erhält ${chf(-p.cash)}`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge tone={p.accepted ? "good" : "neutral"}>
                      {p.accepted ? "zugesagt" : "Zusage offen"}
                    </Badge>
                    {(ring.status === "treuhand" || ring.status === "abwicklung") && (
                      <Badge tone={p.confirmed ? "good" : "neutral"}>
                        {p.confirmed ? "übergeben" : "Übergabe offen"}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-4 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink-2">
            Du gibst deinen <span className="font-medium text-ink">{vehicleFullTitle(me.gives)}</span>{" "}
            an {nachId.get(me.receiverId)?.user.name ?? "—"} und bekommst den{" "}
            <span className="font-medium text-ink">{vehicleFullTitle(iGet.gives)}</span> von{" "}
            {iGet.user.name}. Die drei Ausgleichszahlungen heben sich gegenseitig auf.
          </p>
        </Card>

        {/* -------- Geldfluss -------- */}
        {transfers.length > 0 && (
          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold text-ink">Ausgleich</h2>
            <p className="mb-3 text-xs text-ink-3">
              Im Ring zahlt niemand an die Person, von der er das Fahrzeug bekommt — der Topf wird
              so aufgeteilt, dass am Ende jeder genau seinen Ausgleich hat. Jeder Betrag liegt bis
              zur Übergabe auf dem Treuhandkonto.
              {meineZahlungen.length > 1 &&
                " Auf dich entfallen zwei Wege — die Zahlungsgebühr fällt deshalb zweimal an."}
            </p>
            <ul className="space-y-2">
              {transfers.map((t) => {
                const status = zahlungStatus(t.payerId, t.payeeId);
                return (
                  <li
                    key={`${t.payerId}-${t.payeeId}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
                  >
                    <span className="text-ink-2">
                      <span className="font-medium text-ink">
                        {t.payerId === meId ? "Du" : (nachId.get(t.payerId)?.user.name ?? "—")}
                      </span>{" "}
                      →{" "}
                      <span className="font-medium text-ink">
                        {t.payeeId === meId ? "dich" : (nachId.get(t.payeeId)?.user.name ?? "—")}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular text-ink">
                        {chf(t.amount)}
                        {t.payerId === meId && feesMinor[`${t.payerId}|${t.payeeId}`] > 0 && (
                          <span className="ml-1 text-[11px] font-normal text-ink-3">
                            zzgl. {chf(feesMinor[`${t.payerId}|${t.payeeId}`] / 100)} Gebühr
                          </span>
                        )}
                      </span>
                      <Badge
                        tone={
                          status === "ausgezahlt"
                            ? "good"
                            : status === "autorisiert" || status === "eingezogen"
                              ? "marke"
                              : "neutral"
                        }
                      >
                        {status ? ZAHLUNG_TEXT[status] : "noch nicht eingezahlt"}
                      </Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {/* -------- Übergabe -------- */}
        {(ring.status === "treuhand" || ring.status === "abwicklung") && (
          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold text-ink">Übergabe</h2>
            <p className="mb-3 text-xs text-ink-3">
              Drei Übergaben, jede zwischen zwei Personen. Erst wenn alle drei bestätigt haben,
              wird der Ausgleich ausgezahlt und die Fahrzeuge werden umgeschrieben.
            </p>
            <ul className="mb-4 space-y-1.5">
              {HANDOVER_TASKS.map((task) => (
                <li key={task}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                    <input
                      type="checkbox"
                      checked={tasks.includes(task)}
                      onChange={(e) =>
                        setTasks((cur) =>
                          e.target.checked ? [...cur, task] : cur.filter((t) => t !== task),
                        )
                      }
                      className="h-4 w-4 rounded border-line accent-marke"
                    />
                    {task}
                  </label>
                </li>
              ))}
            </ul>
            {me.confirmed ? (
              <p className="text-sm text-ink-2">
                Du hast bestätigt. Es fehlen noch {offeneBestaetigungen.length} Bestätigung
                {offeneBestaetigungen.length === 1 ? "" : "en"}.
                {ring.status === "abwicklung" && " Die Auszahlung läuft."}
              </p>
            ) : (
              <button
                type="button"
                disabled={!alleTasks || pending}
                onClick={() => run(() => confirmRingHandoverAction(ring.id))}
                className="rounded-lg bg-marke px-4 py-2 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi disabled:cursor-not-allowed disabled:opacity-50"
              >
                Übergabe bestätigen
              </button>
            )}
            {ring.status === "abwicklung" && me.confirmed && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => confirmRingHandoverAction(ring.id))}
                className="ml-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:text-ink disabled:opacity-50"
              >
                Abschluss erneut anstossen
              </button>
            )}
          </Card>
        )}

        {/* -------- Bewertungen -------- */}
        {ring.status === "abgeschlossen" && (
          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold text-ink">Bewertungen</h2>
            <p className="mb-2 text-xs text-ink-3">
              Im Ring hattest du mit beiden zu tun: {nachId.get(me.receiverId)?.user.name} hat dein
              Fahrzeug übernommen, von {iGet.user.name} hast du deines bekommen. Beide Übergaben
              können ganz unterschiedlich gelaufen sein — deshalb je eine eigene Bewertung.
            </p>
            {ring.participants
              .filter((p) => p.user.id !== meId)
              .map((p) => (
                <ReviewForm
                  key={p.user.id}
                  target={{ art: "ring", ringId: ring.id, subjectId: p.user.id }}
                  otherName={p.user.name}
                  vorhanden={meineBewertungen[p.user.id] ?? null}
                />
              ))}
          </Card>
        )}

        {/* -------- Verlauf -------- */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Verlauf</h2>
          <ul className="mb-4 space-y-3">
            {ring.messages.length === 0 && (
              <li className="text-sm text-ink-3">Noch keine Nachrichten.</li>
            )}
            {ring.messages.map((m) => {
              const autor = nachId.get(m.authorId)?.user;
              return (
                <li key={m.id} className={m.system ? "text-xs text-ink-3" : "text-sm"}>
                  {m.system ? (
                    <span>
                      {dayMonth(m.at)} · {m.text}
                    </span>
                  ) : (
                    <div
                      className={`rounded-lg border border-line p-3 ${
                        m.authorId === meId ? "bg-marke/15" : "bg-surface-2"
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs text-ink-3">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ background: autor?.avatarColor ?? "#ccc" }}
                          aria-hidden
                        />
                        <span>{m.authorId === meId ? "Du" : (autor?.name ?? "Unbekannt")}</span>
                        <span>· {dayMonth(m.at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-ink-2">{m.text}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {aktiv && (
            <div className="space-y-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="Nachricht an die beiden anderen …"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
              />
              <button
                type="button"
                disabled={pending || !text.trim()}
                onClick={() =>
                  run(async () => {
                    const res = await sendRingMessageAction(ring.id, text);
                    if (!res.error) setText("");
                    return res;
                  })
                }
                className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:text-ink disabled:opacity-50"
              >
                Senden
              </button>
            </div>
          )}
        </Card>
      </div>

      {/* -------- Seitenspalte: was jetzt zu tun ist -------- */}
      <div className="space-y-4">
        {error && (
          <Card className="border-bad/40 bg-bad/10 p-4">
            <p className="text-sm text-ink">{error}</p>
          </Card>
        )}
        {notice && (
          <Card className="border-good/40 bg-good/10 p-4">
            <p className="text-sm text-ink">{notice}</p>
          </Card>
        )}

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Dein nächster Schritt</h2>

          {ring.status === "vorschlag" && !me.accepted && (
            <div className="space-y-3">
              <p className="text-sm text-ink-2">
                Der Ring kommt nur zustande, wenn alle drei zusagen. Bis dahin bleibt dein Fahrzeug
                frei und ist an nichts gebunden.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => acceptRingAction(ring.id))}
                  className="rounded-lg bg-marke px-4 py-2 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi disabled:opacity-50"
                >
                  Zusagen
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => declineRingAction(ring.id))}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:text-ink disabled:opacity-50"
                >
                  Ablehnen
                </button>
              </div>
            </div>
          )}

          {ring.status === "vorschlag" && me.accepted && (
            <div className="space-y-3">
              <p className="text-sm text-ink-2">
                Du hast zugesagt. Es fehlen noch {offeneZusagen.length} Zusage
                {offeneZusagen.length === 1 ? "" : "n"} —{" "}
                {offeneZusagen.map((p) => p.user.name).join(" und ")}.
              </p>
              {/* Auch wer vorgeschlagen hat, muss wieder herauskommen. */}
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => declineRingAction(ring.id))}
                className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:text-ink disabled:opacity-50"
              >
                {ring.initiatorId === meId ? "Vorschlag zurückziehen" : "Zusage zurückziehen"}
              </button>
            </div>
          )}

          {ring.status === "angenommen" && (
            <div className="space-y-3">
              {meineOffenen.length > 0 ? (
                <>
                  <p className="text-sm text-ink-2">
                    Hinterlege deinen Ausgleich auf dem Treuhandkonto.
                    {meineZahlungen.length > 1 &&
                      ` Bei dir sind es ${meineZahlungen.length} Beträge, noch offen: ${meineOffenen.length}.`}
                  </p>
                  <button
                    type="button"
                    disabled={pending || !paymentsEnabled}
                    onClick={() => run(() => startRingEscrowAction(ring.id))}
                    className="rounded-lg bg-marke px-4 py-2 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi disabled:opacity-50"
                  >
                    {chf(meineOffenen[0].amount)} hinterlegen
                  </button>
                  {paymentsEnabled && (
                    <p className="text-[11px] text-ink-3">
                      Zahlung über Stripe · Betrag wird reserviert, nicht sofort belastet
                      {feesMinor[`${meineOffenen[0].payerId}|${meineOffenen[0].payeeId}`] > 0 && (
                        <>
                          {" "}
                          · zzgl.{" "}
                          {chf(
                            feesMinor[
                              `${meineOffenen[0].payerId}|${meineOffenen[0].payeeId}`
                            ] / 100,
                          )}{" "}
                          Zahlungsgebühr
                        </>
                      )}
                    </p>
                  )}
                  {!paymentsEnabled && (
                    <p className="text-xs text-ink-3">
                      Zahlungen sind auf dieser Installation noch nicht eingerichtet.
                    </p>
                  )}
                </>
              ) : transfers.length === 0 ? (
                <>
                  <p className="text-sm text-ink-2">
                    In diesem Ring gleicht sich alles auf null aus — es ist nichts zu hinterlegen.
                  </p>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => startRingEscrowAction(ring.id))}
                    className="rounded-lg bg-marke px-4 py-2 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi disabled:opacity-50"
                  >
                    Weiter zur Übergabe
                  </button>
                </>
              ) : (
                <p className="text-sm text-ink-2">
                  Bei dir ist nichts einzuzahlen. Sobald alle Beträge hinterlegt sind, geht es zur
                  Übergabe.
                </p>
              )}
            </div>
          )}

          {ring.status === "treuhand" && (
            <p className="text-sm text-ink-2">
              Das Geld liegt bereit. Übergebt die Fahrzeuge und bestätigt es hier — links steht die
              Checkliste.
            </p>
          )}

          {ring.status === "abwicklung" && (
            <p className="text-sm text-ink-2">
              Alle drei haben bestätigt. Der Ausgleich wird ausgezahlt und die Fahrzeuge werden
              umgeschrieben.
            </p>
          )}

          {ring.status === "abgeschlossen" && (
            <p className="text-sm text-ink-2">
              Der Ring ist abgeschlossen. Dein {vehicleFullTitle(iGet.gives)} steht jetzt in deiner{" "}
              <Link href="/garage" className="underline">
                Garage
              </Link>
              .
            </p>
          )}

          {(ring.status === "abgelehnt" || ring.status === "storniert") && (
            <p className="text-sm text-ink-2">
              Dieser Ring kommt nicht zustande. Hinterlegte Beträge werden freigegeben — es hat sich
              kein Fahrzeug bewegt.
            </p>
          )}
        </Card>

        {(ring.status === "angenommen" || ring.status === "treuhand") && (
          <Card className="p-5">
            <h2 className="mb-2 text-sm font-semibold text-ink">Abbrechen</h2>
            <p className="mb-3 text-xs text-ink-3">
              Springt eine Partei ab, wird der ganze Ring rückabgewickelt: alle hinterlegten Beträge
              gehen zurück, kein Fahrzeug wechselt den Besitzer.
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => cancelRingAction(ring.id))}
              className="rounded-lg border border-bad/40 px-4 py-2 text-sm font-medium text-bad transition-colors hover:bg-bad/10 disabled:opacity-50"
            >
              Ring abbrechen
            </button>
          </Card>
        )}
      </div>
    </div>
  );
}
