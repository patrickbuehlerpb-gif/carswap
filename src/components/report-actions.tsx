"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  blockListingAction,
  resolveReportAction,
  suspendOwnerAction,
} from "@/app/actions/reports";

/**
 * Was die Betreiberin mit einer Meldung tun kann. Abhaken ist der Normalfall;
 * sperren und stilllegen greifen tief und verlangen deshalb einen Grund und
 * eine Rückfrage.
 */
export function ReportActions({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [grund, setGrund] = useState("");
  const [modus, setModus] = useState<null | "sperren" | "stilllegen">(null);

  function lauf(fn: () => Promise<{ error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        setModus(null);
        setGrund("");
        router.refresh();
      }
    });
  }

  if (modus) {
    const beschriftung = modus === "sperren" ? "Inserat sperren" : "Konto stilllegen";
    return (
      <div className="w-full max-w-sm space-y-2 sm:w-64">
        <p className="text-xs text-ink-2">
          {modus === "sperren"
            ? "Das Inserat verschwindet aus dem Markt und lässt sich vom Besitzer nicht wieder aktivieren. Offene Vorschläge dazu werden storniert."
            : "Die Person kann sich weiterhin anmelden und an ihre Tausche und Daten, aber nicht mehr inserieren oder tauschen. Alle aktiven Inserate werden gesperrt."}
        </p>
        <input
          value={grund}
          onChange={(e) => setGrund(e.target.value)}
          maxLength={500}
          placeholder="Grund (wird gespeichert)"
          className="w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3"
        />
        <div className="flex gap-2">
          <button
            onClick={() =>
              lauf(() =>
                modus === "sperren"
                  ? blockListingAction(reportId, grund)
                  : suspendOwnerAction(reportId, grund),
              )
            }
            disabled={pending}
            className="rounded-md border border-bad/50 px-3 py-1.5 text-xs text-bad transition-colors hover:bg-bad/10 disabled:opacity-50"
          >
            {pending ? "…" : beschriftung}
          </button>
          <button
            onClick={() => setModus(null)}
            className="rounded-md px-3 py-1.5 text-xs text-ink-3 hover:text-ink"
          >
            Abbrechen
          </button>
        </div>
        {error && <p className="text-xs text-bad">{error}</p>}
      </div>
    );
  }

  return (
    <div className="shrink-0 space-y-1 text-right">
      <button
        onClick={() => lauf(() => resolveReportAction(reportId))}
        disabled={pending}
        className="block w-full rounded-lg border border-line-strong px-3 py-1.5 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-60"
      >
        {pending ? "…" : "Als geprüft markieren"}
      </button>
      <button
        onClick={() => setModus("sperren")}
        className="block w-full px-3 py-1 text-xs text-ink-3 hover:text-bad"
      >
        Inserat sperren
      </button>
      <button
        onClick={() => setModus("stilllegen")}
        className="block w-full px-3 py-1 text-xs text-ink-3 hover:text-bad"
      >
        Konto stilllegen
      </button>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
