"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { resendVerificationAction } from "@/app/actions/auth";
import {
  cancelEmailChangeAction,
  changePasswordAction,
  deleteAccountAction,
  exportMyDataAction,
  refreshPayoutStatusAction,
  requestEmailChangeAction,
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
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-marke";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-marke px-5 py-2 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi disabled:opacity-60"
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
}: {
  name: string;
  location: string;
  canton: string;
  phone: string;
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

      <SaveButton />
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Sicherheit: Passwort und E-Mail-Adresse                             */
/* ------------------------------------------------------------------ */

function Meldung({ state }: { state: { error?: string; notice?: string } }) {
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

function Absenden({ label, laeuft }: { label: string; laeuft: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-marke px-5 py-2 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi disabled:opacity-60"
    >
      {pending ? laeuft : label}
    </button>
  );
}

/**
 * Ein aufklappbarer Block. Passwort und Adresse ändert man selten — offen
 * stehende Formulare dafür machen die Kontoseite nur unübersichtlich.
 */
function Aufklapper({
  titel,
  knopf,
  children,
}: {
  titel: string;
  knopf: string;
  children: React.ReactNode;
}) {
  const [offen, setOffen] = useState(false);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-ink-3">{titel}</span>
        <button
          type="button"
          onClick={() => setOffen((v) => !v)}
          aria-expanded={offen}
          className="text-marke hover:underline"
        >
          {offen ? "Abbrechen" : knopf}
        </button>
      </div>
      {offen && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function PasswortAendern() {
  const [state, action] = useActionState(changePasswordAction, {});

  return (
    <Aufklapper titel="Passwort" knopf="Ändern">
      <form action={action} className="space-y-3">
        <Meldung state={state} />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Aktuelles Passwort</span>
          <input
            type="password"
            name="current"
            required
            autoComplete="current-password"
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Neues Passwort</span>
          <input
            type="password"
            name="password"
            required
            minLength={10}
            autoComplete="new-password"
            className={input}
          />
          <span className="mt-1 block text-xs text-ink-3">Mindestens 10 Zeichen.</span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Neues Passwort wiederholen</span>
          <input
            type="password"
            name="repeat"
            required
            minLength={10}
            autoComplete="new-password"
            className={input}
          />
        </label>
        <p className="text-xs text-ink-3">
          Danach sind alle anderen Geräte abgemeldet. Auf diesem bleibst du angemeldet.
        </p>
        <Absenden label="Passwort ändern" laeuft="Wird geändert …" />
      </form>
    </Aufklapper>
  );
}

export function EmailAendern({ offeneAdresse }: { offeneAdresse: string | null }) {
  const [state, action] = useActionState(requestEmailChangeAction, {});
  const [pending, start] = useTransition();
  const [abbruch, setAbbruch] = useState<string | null>(null);

  if (offeneAdresse && !abbruch) {
    return (
      <div className="rounded-lg border border-warn/35 bg-warn/12 p-3">
        <p className="text-sm text-ink-2">
          Wechsel zu <span className="font-medium text-ink">{offeneAdresse}</span> angefragt. Er gilt
          erst, wenn du den Link in dieser Mailbox anklickst.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await cancelEmailChangeAction();
              setAbbruch(res.notice ?? "Der Wechsel wurde abgebrochen.");
            })
          }
          className="mt-2 text-sm text-marke hover:underline disabled:opacity-60"
        >
          {pending ? "Wird abgebrochen …" : "Wechsel abbrechen"}
        </button>
      </div>
    );
  }

  return (
    <Aufklapper titel="Adresse wechseln" knopf="Ändern">
      <form action={action} className="space-y-3">
        {abbruch && !state.error && !state.notice && (
          <p role="status" className="rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-2">
            {abbruch}
          </p>
        )}
        <Meldung state={state} />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Neue E-Mail-Adresse</span>
          <input type="email" name="email" required autoComplete="email" className={input} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Dein Passwort</span>
          <input
            type="password"
            name="current"
            required
            autoComplete="current-password"
            className={input}
          />
        </label>
        <p className="text-xs text-ink-3">
          Wir schicken einen Link an die neue Adresse. Bis du ihn anklickst, bleibt die alte gültig.
        </p>
        <Absenden label="Link schicken" laeuft="Wird geschickt …" />
      </form>
    </Aufklapper>
  );
}

/* ------------------------------------------------------------------ */

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
        Zahlungen sind hier noch nicht eingerichtet. Tausche, bei denen niemand draufzahlt,
        funktionieren trotzdem.
      </p>
    );
  }

  if (enabled) {
    return (
      <p className="rounded-lg border border-good/35 bg-good/12 p-3 text-sm text-good">
        Dein Auszahlungskonto ist bereit. Was du bekommst, überweisen wir nach der Übergabe von
        selbst.
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
          className="rounded-lg bg-marke px-5 py-2 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi disabled:opacity-60"
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
        Die Identitätsprüfung übernimmt Stripe. quitt sieht deine Bankdaten nicht.
      </p>
    </div>
  );
}

/**
 * Auskunft und Löschung. Beides ist in der Datenschutzerklärung zugesagt und
 * braucht deshalb einen sichtbaren Weg, nicht nur eine Mailadresse.
 */
/** Hinweis für ein stillgelegtes Konto. */
export function StilllegungsHinweis({ grund }: { grund: string | null }) {
  return (
    <div className="rounded-xl border border-bad/40 bg-bad/8 p-4">
      <p className="text-sm font-semibold text-ink">Dein Konto ist stillgelegt</p>
      <p className="mt-1 text-sm text-ink-2">
        An deine laufenden Tausche und an deine Daten kommst du weiterhin. Neue Inserate,
        Vorschläge und Bewertungen sind gesperrt.
        {grund ? ` Grund: ${grund}` : ""}
      </p>
    </div>
  );
}

export function DatenUndLoeschung() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [bestaetigung, setBestaetigung] = useState("");
  const [offen, setOffen] = useState(false);

  function herunterladen() {
    setError(null);
    start(async () => {
      const res = await exportMyDataAction();
      if (res.error || !res.json) {
        setError(res.error ?? "Die Auskunft konnte nicht erstellt werden.");
        return;
      }
      const url = URL.createObjectURL(new Blob([res.json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "quitt-meine-daten.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function loeschen() {
    setError(null);
    start(async () => {
      const res = await deleteAccountAction(bestaetigung);
      if (res.error) {
        setError(res.error);
        return;
      }
      window.location.href = res.redirectTo ?? "/";
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <button
          onClick={herunterladen}
          disabled={pending}
          className="rounded-lg border border-line-strong px-4 py-2 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-60"
        >
          {pending ? "Wird erstellt …" : "Meine Daten herunterladen"}
        </button>
        <p className="mt-1.5 text-xs text-ink-3">
          Alles, was zu deinem Konto gespeichert ist, als JSON-Datei.
        </p>
      </div>

      <div className="border-t border-line pt-4">
        {!offen ? (
          <button
            onClick={() => setOffen(true)}
            className="text-sm text-bad hover:underline"
          >
            Konto löschen
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-ink-2">
              Wir entfernen Name, Adresse und Kontaktdaten. Deine Autos verschwinden aus dem
              Markt. Abgeschlossene Tausche bleiben bestehen — die brauchen wir für die
              Buchhaltung —, sind danach aber nicht mehr dir zugeordnet. Dein Auszahlungskonto bei
              Stripe trennen wir von deinem Konto. Die Daten dort liegen bei Stripe und müssen
              auch dort gelöscht werden. Rückgängig machen lässt sich das alles nicht.
            </p>
            <label className="block text-sm text-ink-2">
              Zum Bestätigen <span className="font-semibold text-ink">LÖSCHEN</span> eintippen
              <input
                value={bestaetigung}
                onChange={(e) => setBestaetigung(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
            <div className="flex gap-2">
              <button
                onClick={loeschen}
                disabled={pending || bestaetigung.trim().toUpperCase() !== "LÖSCHEN"}
                className="rounded-lg border border-bad/50 px-4 py-2 text-sm text-bad transition-colors hover:bg-bad/10 disabled:opacity-40"
              >
                {pending ? "Wird gelöscht …" : "Endgültig löschen"}
              </button>
              <button
                onClick={() => {
                  setOffen(false);
                  setBestaetigung("");
                }}
                className="rounded-lg px-4 py-2 text-sm text-ink-3 hover:text-ink"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
