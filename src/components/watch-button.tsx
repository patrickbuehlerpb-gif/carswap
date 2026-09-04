"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toggleWatchAction } from "@/app/actions/watchlist";

export function WatchButton({
  listingId,
  initialActive,
  signedIn,
}: {
  listingId: string;
  initialActive: boolean;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [active, setActive] = useState(initialActive);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    if (!signedIn) {
      router.push(`/konto/anmelden?next=/fahrzeug/${listingId}`);
      return;
    }
    // Optimistisch umschalten und bei Fehler zurücknehmen
    const next = !active;
    setActive(next);
    setError(null);
    startTransition(async () => {
      const res = await toggleWatchAction(listingId);
      if (res.error) {
        setActive(!next);
        setError(res.error);
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        onClick={toggle}
        disabled={pending}
        aria-pressed={active}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
          active
            ? "border-volt-ink/40 bg-volt/25 text-volt-ink"
            : "border-line-strong bg-surface text-ink-2 hover:text-ink"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3 w-3"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path
            d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 7 2.5C19 15.5 12 20 12 20z"
            strokeLinejoin="round"
          />
        </svg>
        {active ? "gemerkt" : "merken"}
      </button>
      {error && <span className="mt-1 text-[11px] text-bad">{error}</span>}
    </span>
  );
}
