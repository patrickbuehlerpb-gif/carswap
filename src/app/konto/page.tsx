import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge, Card, SectionHead } from "@/components/ui";
import {
  AccountForm,
  DatenUndLoeschung,
  EmailAendern,
  PasswortAendern,
  PayoutSetup,
  ResendVerification,
  StilllegungsHinweis,
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
    .select({ phone: users.phone, suspendedReason: users.suspendedReason })
    .from(users)
    .where(eq(users.id, me.id))
    .limit(1);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <SectionHead
        title="Konto"
        sub="Profilangaben, E-Mail-Bestätigung und das Konto für Auszahlungen."
      />

      {me.suspended && <StilllegungsHinweis grund={row?.suspendedReason ?? null} />}

      {!me.emailVerified && <ResendVerification />}

      <Card className="p-5 sm:p-6">
        <h2 className="text-base font-semibold text-ink">Profil</h2>
        <p className="mt-1 mb-5 text-sm text-ink-3">
          Name und Ort stehen bei deinen Inseraten. Die Telefonnummer sieht nur, wer dir zugesagt hat.
        </p>
        <AccountForm
          name={me.name}
          location={me.location}
          canton={me.canton}
          phone={row?.phone ?? ""}
        />
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Auszahlungen</h2>
            <p className="mt-1 text-sm text-ink-3">
              Ist dein Auto weniger wert als das andere, bekommst du die Differenz. Dafür brauchst
              du ein Auszahlungskonto, das Stripe geprüft hat.
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
        <p className="mt-1 mb-5 text-sm text-ink-3">
          An deine Adresse gehen alle Nachrichten zu laufenden Tauschen. Beides lässt sich nur mit
          deinem Passwort ändern.
        </p>
        <div className="space-y-4 text-sm">
          <div className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
            <span className="whitespace-nowrap text-ink-3">E-Mail</span>
            <span className="text-right text-ink">
              {me.email}{" "}
              {me.emailVerified ? (
                <span className="whitespace-nowrap text-good">· bestätigt</span>
              ) : (
                <span className="whitespace-nowrap text-warn">· nicht bestätigt</span>
              )}
            </span>
          </div>
          <div className="border-b border-line pb-4">
            <EmailAendern offeneAdresse={me.pendingEmail} />
          </div>
          <PasswortAendern />
        </div>
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
