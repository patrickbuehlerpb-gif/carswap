"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveVehicleAction, setListingStatusAction } from "@/app/actions/listings";

/** Inserat pausieren oder Fahrzeug archivieren. */
export function ListingControls({
  vehicleId,
  status,
}: {
  vehicleId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const paused = status !== "aktiv";

  function run(fn: () => Promise<{ error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else if (after) after();
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          onClick={() =>
            run(() => setListingStatusAction(vehicleId, paused ? "aktiv" : "pausiert"))
          }
          disabled={pending}
          className="rounded-lg border border-line-strong px-3 py-1.5 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-60"
        >
          {paused ? "Wieder inserieren" : "Inserat pausieren"}
        </button>
        <button
          onClick={() => {
            if (!confirm("Fahrzeug wirklich aus der Garage nehmen?")) return;
            run(() => archiveVehicleAction(vehicleId), () => router.push("/garage"));
          }}
          disabled={pending}
          className="rounded-lg border border-line-strong px-3 py-1.5 text-sm text-ink-2 transition-colors hover:border-bad/45 hover:text-bad disabled:opacity-60"
        >
          Entfernen
        </button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
