"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reportListingAction } from "@/app/actions/reports";
import { REPORT_REASONS } from "@/lib/data/report-reasons";

/** Meldung zu einem Inserat — bewusst unauffällig, aber überall erreichbar. */
export function ReportButton({ vehicleId, signedIn }: { vehicleId: string; signedIn: boolean }) {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [reason, setReason] = useState(REPORT_REASONS[0].value);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [erledigt, setErledigt] = useState(false);

  if (erledigt) {
    return (
      <p className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-xs text-ink-2">
        Danke — die Meldung ist bei uns angekommen. Wir schauen sie an.
      </p>
    );
  }

  if (!offen) {
    return (
      <button
        onClick={() => {
          if (!signedIn) {
            router.push(`/konto/anmelden?next=/auto/${vehicleId}`);
            return;
          }
          setOffen(true);
        }}
        className="mt-4 text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline"
      >
        Inserat melden
      </button>
    );
  }

  return (
    <div className="mt-4 space-y-2 rounded-lg border border-line bg-surface-2 p-3">
      <p className="text-xs text-ink-2">Was stimmt mit diesem Inserat nicht?</p>
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value as typeof reason)}
        aria-label="Grund der Meldung"
        className="w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
      >
        {REPORT_REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Was ist dir aufgefallen? (freiwillig)"
        className="w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3"
      />
      <div className="flex gap-2">
        <button
          onClick={() => {
            setError(null);
            start(async () => {
              const res = await reportListingAction(vehicleId, reason, note);
              if (res.error) setError(res.error);
              else setErledigt(true);
            });
          }}
          disabled={pending}
          className="rounded-md border border-line-strong px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-bad/45 hover:text-bad disabled:opacity-60"
        >
          {pending ? "Wird gesendet …" : "Melden"}
        </button>
        <button
          onClick={() => setOffen(false)}
          className="rounded-md px-3 py-1.5 text-xs text-ink-3 hover:text-ink"
        >
          Abbrechen
        </button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
