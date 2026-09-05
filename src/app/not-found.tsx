import Link from "next/link";
import { Card } from "@/components/ui";

export default function NotFound() {
  return (
    <Card className="mx-auto mt-10 max-w-lg p-10 text-center">
      <p className="text-4xl betrag text-marke">404</p>
      <h1 className="mt-3 text-lg font-semibold text-ink">Diese Seite gibt es nicht</h1>
      <p className="mt-2 text-sm text-ink-3">
        Möglicherweise wurde das Inserat inzwischen getauscht oder zurückgezogen.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/markt"
          className="rounded-lg bg-marke px-5 py-2.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
        >
          Zum Marktplatz
        </Link>
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
