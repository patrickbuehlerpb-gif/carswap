"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Seitenfehler:", error);
  }, [error]);

  return (
    <Card className="mx-auto mt-10 max-w-lg p-10 text-center">
      <h1 className="text-lg font-semibold text-ink">Da ist etwas schiefgelaufen</h1>
      <p className="mt-2 text-sm text-ink-3">
        Der Fehler ist bei uns notiert. Versuch es nochmals. Bleibt es dabei, melde dich.
      </p>
      {error.digest && (
        <p className="mt-3 text-xs text-ink-3 tabular">Fehlerkennung: {error.digest}</p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-marke px-5 py-2.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
        >
          Nochmals versuchen
        </button>
        <Link
          href="/"
          className="rounded-lg border border-line-strong px-5 py-2.5 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
        >
          Startseite
        </Link>
      </div>
    </Card>
  );
}
