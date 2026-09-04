"use client";

import { useStore } from "@/lib/store";

export function WatchButton({ listingId }: { listingId: string }) {
  const { watchlist, toggleWatch, hydrated } = useStore();
  const active = watchlist.includes(listingId);

  return (
    <button
      onClick={() => toggleWatch(listingId)}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
        active
          ? "border-volt-600/40 bg-volt-500/10 text-volt-400"
          : "border-ink-600 bg-ink-800 text-mist-300 hover:text-mist-100"
      }`}
      suppressHydrationWarning
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
        <path d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 7 2.5C19 15.5 12 20 12 20z" strokeLinejoin="round" />
      </svg>
      {hydrated && active ? "gemerkt" : "merken"}
    </button>
  );
}
