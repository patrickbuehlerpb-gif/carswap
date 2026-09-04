"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { submitReviewAction, submitRingReviewAction } from "@/app/actions/reviews";

const STUFEN = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

/** Ein bis fünf Sterne, halbe Schritte, rein zur Anzeige. */
export function Sterne({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => {
        const anteil = Math.max(0, Math.min(1, value - (i - 1)));
        return (
          <span key={i} className="relative inline-block h-3.5 w-3.5 text-line-strong">
            <span className="absolute inset-0">★</span>
            <span
              className="absolute inset-0 overflow-hidden text-volt-ink"
              style={{ width: `${anteil * 100}%` }}
            >
              ★
            </span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * Bewertung nach dem Tausch. Sie ist der einzige Vertrauensanker zwischen
 * zwei Fremden, die sich ein Auto übergeben haben — deshalb steht sie direkt
 * im abgeschlossenen Vorgang und nicht in einer Mail, die niemand öffnet.
 */
export type ReviewTarget =
  | { art: "deal"; dealId: string }
  | { art: "ring"; ringId: string; subjectId: string };

export function ReviewForm({
  target,
  otherName,
  vorhanden,
}: {
  /** Zweiertausch oder eine bestimmte Person in einem Ring. */
  target: ReviewTarget;
  otherName: string;
  vorhanden: { stars: number; body: string | null } | null;
}) {
  const router = useRouter();
  const [stars, setStars] = useState(5);
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (vorhanden) {
    return (
      <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3">
        <p className="text-xs text-ink-3">Deine Bewertung für {otherName}</p>
        <div className="mt-1 flex items-center gap-2">
          <Sterne value={vorhanden.stars} />
          <span className="text-sm tabular text-ink">{vorhanden.stars.toFixed(1)}</span>
        </div>
        {vorhanden.body && <p className="mt-2 text-sm text-ink-2">{vorhanden.body}</p>}
      </div>
    );
  }

  function senden() {
    setError(null);
    start(async () => {
      const res =
        target.art === "deal"
          ? await submitReviewAction(target.dealId, stars, body)
          : await submitRingReviewAction(target.ringId, target.subjectId, stars, body);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-sm text-ink-2">
        Wie war der Tausch mit {otherName}? Deine Bewertung hilft der nächsten Person, die auf ein
        Inserat stösst.
      </p>

      <fieldset className="mt-3">
        <legend className="sr-only">Sterne</legend>
        <div className="flex flex-wrap items-center gap-1">
          {STUFEN.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStars(s)}
              aria-pressed={stars === s}
              className={`rounded-md border px-2 py-1 text-xs tabular transition-colors ${
                stars === s
                  ? "border-volt-ink bg-volt/25 text-ink"
                  : "border-line bg-surface-2 text-ink-3 hover:border-line-strong hover:text-ink"
              }`}
            >
              {s.toFixed(1)}
            </button>
          ))}
          <Sterne value={stars} className="ml-2" />
        </div>
      </fieldset>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="Was ist gut gelaufen, was nicht? (freiwillig)"
        className="mt-3 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3"
      />

      <button
        onClick={senden}
        disabled={pending}
        className="mt-2 w-full rounded-lg bg-volt py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-volt-hi disabled:opacity-60"
      >
        {pending ? "Wird gespeichert …" : "Bewertung abgeben"}
      </button>
      <p className="mt-2 text-center text-[11px] text-ink-3">
        Einmal abgegeben, lässt sie sich nicht mehr ändern.
      </p>
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
    </div>
  );
}
