"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resolveReportAction } from "@/app/actions/reports";

/** Eine Meldung abhaken. Mehr braucht die erste Fassung nicht. */
export function ReportActions({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="shrink-0 text-right">
      <button
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await resolveReportAction(reportId);
            if (res.error) setError(res.error);
            else router.refresh();
          });
        }}
        disabled={pending}
        className="rounded-lg border border-line-strong px-3 py-1.5 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-60"
      >
        {pending ? "…" : "Als geprüft markieren"}
      </button>
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}
