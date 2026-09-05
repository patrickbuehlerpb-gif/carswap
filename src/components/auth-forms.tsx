"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  requestPasswordResetAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
  type FormState,
} from "@/app/actions/auth";

const inputClass =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-marke";

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-marke py-2.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi disabled:opacity-60"
    >
      {pending ? "Einen Moment …" : children}
    </button>
  );
}

function Message({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-lg border border-bad/35 bg-bad/12 p-3 text-sm text-bad">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p role="status" className="rounded-lg border border-good/35 bg-good/12 p-3 text-sm text-good">
        {state.notice}
      </p>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ */

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, {});
  return (
    <form action={action} className="space-y-4">
      <Message state={state} />
      <Field label="Name">
        <input name="name" required autoComplete="name" className={inputClass} placeholder="Vorname Nachname" />
      </Field>
      <Field label="E-Mail">
        <input name="email" type="email" required autoComplete="email" className={inputClass} placeholder="du@beispiel.ch" />
      </Field>
      <Field label="Passwort" hint="Mindestens 10 Zeichen.">
        <input name="password" type="password" required autoComplete="new-password" minLength={10} className={inputClass} />
      </Field>
      <div className="grid grid-cols-[1fr_88px] gap-3">
        <Field label="Ort">
          <input name="location" className={inputClass} placeholder="Zürich" autoComplete="address-level2" />
        </Field>
        <Field label="Kanton">
          <input name="canton" maxLength={2} className={`${inputClass} uppercase`} placeholder="ZH" />
        </Field>
      </div>
      <Submit>Konto erstellen</Submit>
      <p className="text-center text-sm text-ink-3">
        Schon registriert?{" "}
        <Link href="/konto/anmelden" className="textlink">
          Anmelden
        </Link>
      </p>
    </form>
  );
}

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signInAction, {});
  return (
    <form action={action} className="space-y-4">
      <Message state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="E-Mail">
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </Field>
      <Field label="Passwort">
        <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
      </Field>
      <Submit>Anmelden</Submit>
      <div className="flex justify-between text-sm">
        <Link href="/konto/passwort-vergessen" className="text-ink-3 hover:text-ink">
          Passwort vergessen?
        </Link>
        <Link href="/konto/registrieren" className="textlink">
          Konto erstellen
        </Link>
      </div>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, {});
  return (
    <form action={action} className="space-y-4">
      <Message state={state} />
      <Field label="E-Mail">
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </Field>
      <Submit>Link anfordern</Submit>
      <p className="text-center text-sm">
        <Link href="/konto/anmelden" className="text-ink-3 hover:text-ink">
          Zurück zur Anmeldung
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, {});
  return (
    <form action={action} className="space-y-4">
      <Message state={state} />
      <input type="hidden" name="token" value={token} />
      <Field label="Neues Passwort" hint="Mindestens 10 Zeichen. Alle Geräte werden abgemeldet.">
        <input name="password" type="password" required autoComplete="new-password" minLength={10} className={inputClass} />
      </Field>
      <Submit>Passwort setzen</Submit>
    </form>
  );
}
