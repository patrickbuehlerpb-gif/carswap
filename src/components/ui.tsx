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
    <As className={`rounded-xl border border-ink-800 bg-ink-900 ${className}`}>{children}</As>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "volt" | "good" | "bad" | "warn" | "info";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-ink-600 bg-ink-800 text-mist-300",
    volt: "border-volt-600/40 bg-volt-500/10 text-volt-400",
    good: "border-good/30 bg-good/10 text-good",
    bad: "border-bad/30 bg-bad/10 text-bad",
    warn: "border-amber-warn/30 bg-amber-warn/10 text-amber-warn",
    info: "border-sky-ice/30 bg-sky-ice/10 text-sky-ice",
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
  tone?: "neutral" | "good" | "bad" | "volt";
}) {
  const toneClass =
    tone === "good"
      ? "text-good"
      : tone === "bad"
        ? "text-bad"
        : tone === "volt"
          ? "text-volt-400"
          : "text-mist-100";
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-mist-400">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold tabular ${toneClass}`}>{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-mist-400">{hint}</p>}
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
        <h2 className="text-lg font-semibold tracking-tight text-mist-100">{title}</h2>
        {sub && <p className="mt-1 max-w-2xl text-sm text-mist-400">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function SpecRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink-800 py-2 last:border-0">
      <span className="text-sm text-mist-400">{label}</span>
      <span className="text-sm font-medium tabular text-mist-100">{value}</span>
    </div>
  );
}

export function ScorePill({ score }: { score: number }) {
  const tone = score >= 75 ? "text-volt-400" : score >= 55 ? "text-mist-200" : "text-mist-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-700">
        <div
          className="h-full rounded-full bg-volt-500"
          style={{ width: `${Math.max(4, score)}%` }}
        />
      </div>
      <span className={`text-xs font-semibold tabular ${tone}`}>{score}</span>
    </div>
  );
}
