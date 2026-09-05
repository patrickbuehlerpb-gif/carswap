import type { ReactNode } from "react";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl display text-ink sm:text-3xl">{title}</h1>
      <p className="mt-2 text-sm text-ink-3">Stand: {updated}</p>
      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </article>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="pt-2 text-lg display text-ink">{children}</h2>;
}

/**
 * Hinweis auf eine Lücke im Rechtstext. Sichtbar für alle — eine
 * unvollständige Rechtsseite als vollständig auszugeben wäre schlimmer, als
 * die Lücke zu benennen.
 */
export function Todo({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-warn/35 bg-warn/12 p-3 text-sm text-ink-2">
      <strong className="font-semibold text-ink">Noch nicht eingetragen:</strong> {children}
    </p>
  );
}

/** Eine Zeile «Bezeichnung: Wert», die nur erscheint, wenn es den Wert gibt. */
export function Angabe({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <p>
      <span className="text-ink-3">{label}: </span>
      <span className="text-ink">{value}</span>
    </p>
  );
}
