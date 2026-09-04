import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge, Card, SectionHead } from "@/components/ui";
import {
  AccountForm,
  DatenUndLoeschung,
  PayoutSetup,
  ResendVerification,
} from "@/components/account-widgets";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stripeConfigured } from "@/lib/payments";

export const metadata: Metadata = { title: "Konto" };
export const dynamic = "force-dynamic";

export default async function KontoPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe?: string }>;
}) {
  const me = await getSessionUser();
  if (!me) redirect("/konto/anmelden?next=/konto");
  const { stripe: stripeStatus } = await searchParams;

  const [row] = await db
    .select({ phone: users.phone })
    .from(users)
    .where(eq(users.id, me.id))
    .limit(1);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <SectionHead
        title="Konto"
        sub="Profilangaben, E-Mail-Bestätigung und das Konto für Auszahlungen."
      />

      {!me.emailVerified && <ResendVerification />}

      <Card className="p-5 sm:p-6">
        <h2 className="text-base font-semibold text-ink">Profil</h2>
        <p className="mt-1 mb-5 text-sm text-ink-3">
          Name und Ort sehen andere Nutzer bei deinen Inseraten. Die Telefonnummer bleibt intern.
        </p>
        <AccountForm
          name={me.name}
          location={me.location}
          canton={me.canton}
          phone={row?.phone ?? ""}
          email={me.email}
        />
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Auszahlungen</h2>
            <p className="mt-1 text-sm text-ink-3">
              Wenn dein Fahrzeug weniger wert ist als das getauschte, erhältst du die Differenz.
              Dafür brauchen wir ein von Stripe geprüftes Auszahlungskonto.
            </p>
          </div>
          <Badge tone={me.stripePayoutsEnabled ? "good" : "warn"}>
            {me.stripePayoutsEnabled ? "bereit" : "offen"}
          </Badge>
        </div>
        <div className="mt-5">
          <PayoutSetup
            enabled={me.stripePayoutsEnabled}
            hasAccount={Boolean(me.stripeAccountId)}
            configured={stripeConfigured()}
            statusHint={
              stripeStatus === "fertig"
                ? "Stripe hat die Angaben übernommen. Die Freigabe kann einige Minuten dauern."
                : stripeStatus === "erneut"
                  ? "Das Onboarding wurde unterbrochen — du kannst es hier fortsetzen."
                  : null
            }
          />
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="text-base font-semibold text-ink">Sicherheit</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
            <dt className="text-ink-3">E-Mail</dt>
            <dd className="text-ink">
              {me.email}{" "}
              {me.emailVerified ? (
                <span className="text-good">· bestätigt</span>
              ) : (
                <span className="text-warn">· nicht bestätigt</span>
              )}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-3">Passwort</dt>
            <dd>
              <a href="/konto/passwort-vergessen" className="text-volt-ink hover:underline">
                Passwort ändern
              </a>
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink">Deine Daten</h2>
        <p className="mt-1 text-xs text-ink-3">
          Auskunft und Löschung, wie in der Datenschutzerklärung zugesagt.
        </p>
        <div className="mt-4">
          <DatenUndLoeschung />
        </div>
      </Card>
    </div>
  );
}
