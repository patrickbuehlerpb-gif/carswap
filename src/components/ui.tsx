import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  as: As = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li";
}) {
  return (
    <As className={`rounded-xl border border-line bg-surface card-shadow ${className}`}>{children}</As>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "marke" | "good" | "bad" | "warn" | "info";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-line-strong bg-surface-3 text-ink-2",
    marke: "border-marke/40 bg-marke/25 text-marke",
    good: "border-good/35 bg-good/12 text-good",
    bad: "border-bad/35 bg-bad/12 text-bad",
    warn: "border-warn/35 bg-warn/12 text-warn",
    info: "border-info/35 bg-info/12 text-info",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "good" | "bad" | "marke";
}) {
  const toneClass =
    tone === "good"
      ? "text-good"
      : tone === "bad"
        ? "text-bad"
        : tone === "marke"
          ? "text-marke"
          : "text-ink";
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-ink-3">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold tabular ${toneClass}`}>{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

export function SectionHead({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg display text-ink">{title}</h2>
        {sub && <p className="mt-1 max-w-2xl text-sm text-ink-3">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function SpecRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0">
      <span className="text-sm text-ink-3">{label}</span>
      <span className="text-sm font-medium tabular text-ink">{value}</span>
    </div>
  );
}

export function ScorePill({ score }: { score: number }) {
  const tone = score >= 75 ? "text-marke" : score >= 55 ? "text-ink-2" : "text-ink-3";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line-strong">
        <div
          className="h-full rounded-full bg-marke"
          style={{ width: `${Math.max(4, score)}%` }}
        />
      </div>
      <span className={`text-xs font-semibold tabular ${tone}`}>{score}</span>
    </div>
  );
}
