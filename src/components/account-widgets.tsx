"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { resendVerificationAction } from "@/app/actions/auth";
import {
  refreshPayoutStatusAction,
  startPayoutOnboardingAction,
  updateProfileAction,
} from "@/app/actions/account";

/** Hinweisbanner, solange die E-Mail-Adresse nicht bestätigt ist. */
export function ResendVerification() {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-warn/35 bg-warn/12 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          <span className="font-medium text-ink">E-Mail-Adresse noch nicht bestätigt.</span> Erst
          danach können dir andere einen Tausch vorschlagen.
        </p>
        <button
          onClick={() =>
            start(async () => {
              const res = await resendVerificationAction();
              setMessage(res.error ?? res.notice ?? null);
            })
          }
          disabled={pending}
          className="shrink-0 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink-2 transition-colors hover:text-ink disabled:opacity-60"
        >
          {pending ? "Wird gesendet …" : "Link erneut senden"}
        </button>
      </div>
      {message && <p className="mt-2 text-sm text-ink-2">{message}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const input =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-volt-ink";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-volt px-5 py-2 text-sm font-semibold text-ink transition-colors hover:bg-volt-hi disabled:opacity-60"
    >
      {pending ? "Wird gespeichert …" : "Speichern"}
    </button>
  );
}

export function AccountForm({
  name,
  location,
  canton,
  phone,
  email,
}: {
  name: string;
  location: string;
  canton: string;
  phone: string;
  email: string;
}) {
  const [state, action] = useActionState(updateProfileAction, {});

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <p role="alert" className="rounded-lg border border-bad/35 bg-bad/12 p-3 text-sm text-bad">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="rounded-lg border border-good/35 bg-good/12 p-3 text-sm text-good">
          {state.notice}
        </p>
      )}

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">Name</span>
        <input name="name" defaultValue={name} required className={input} />
      </label>

      <div className="grid grid-cols-[1fr_92px] gap-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Ort</span>
          <input name="location" defaultValue={location} className={input} placeholder="Zürich" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Kanton</span>
          <input
            name="canton"
            defaultValue={canton}
            maxLength={2}
            className={`${input} uppercase`}
            placeholder="ZH"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">Telefon</span>
        <input name="phone" defaultValue={phone} className={input} placeholder="+41 …" />
        <span className="mt-1 block text-xs text-ink-3">
          Wird nur der Gegenseite eines zugesagten Tauschs gezeigt.
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">E-Mail</span>
        <input value={email} disabled className={`${input} opacity-60`} />
      </label>

      <SaveButton />
    </form>
  );
}

export function PayoutSetup({
  enabled,
  hasAccount,
  configured,
  statusHint,
}: {
  enabled: boolean;
  hasAccount: boolean;
  configured: boolean;
  statusHint: string | null;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(statusHint);

  if (!configured) {
    return (
      <p className="rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-3">
        Zahlungen sind auf dieser Installation noch nicht eingerichtet. Tausche ohne Wertdifferenz
        funktionieren trotzdem.
      </p>
    );
  }

  if (enabled) {
    return (
      <p className="rounded-lg border border-good/35 bg-good/12 p-3 text-sm text-good">
        Dein Auszahlungskonto ist bereit. Ausgleichszahlungen werden nach der Übergabe automatisch
        überwiesen.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {message && (
        <p className="rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-2">{message}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() =>
            start(async () => {
              const res = await startPayoutOnboardingAction();
              if (res.redirectTo) window.location.href = res.redirectTo;
              else setMessage(res.error ?? null);
            })
          }
          disabled={pending}
          className="rounded-lg bg-volt px-5 py-2 text-sm font-semibold text-ink transition-colors hover:bg-volt-hi disabled:opacity-60"
        >
          {pending ? "Einen Moment …" : hasAccount ? "Onboarding fortsetzen" : "Auszahlungskonto einrichten"}
        </button>
        {hasAccount && (
          <button
            onClick={() =>
              start(async () => {
                const res = await refreshPayoutStatusAction();
                setMessage(res.error ?? res.notice ?? "Noch keine Freigabe von Stripe.");
              })
            }
            disabled={pending}
            className="rounded-lg border border-line-strong px-4 py-2 text-sm text-ink-2 transition-colors hover:text-ink disabled:opacity-60"
          >
            Status prüfen
          </button>
        )}
      </div>
      <p className="text-xs text-ink-3">
        Die Identitätsprüfung übernimmt Stripe. CarSwap sieht deine Bankdaten nicht.
      </p>
    </div>
  );
}
