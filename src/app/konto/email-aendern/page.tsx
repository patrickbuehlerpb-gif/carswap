import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { confirmEmailChange } from "@/app/actions/account";

export const metadata: Metadata = { title: "Neue E-Mail-Adresse bestätigen" };
export const dynamic = "force-dynamic";

/**
 * Der Link aus der Bestätigungsmail landet hier. Bewusst ohne Anmeldepflicht:
 * dass jemand diese Mailbox öffnen kann, ist genau der Nachweis, um den es
 * geht — und viele lesen ihre Post auf einem anderen Gerät.
 */
export default async function EmailAendernPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const ergebnis = token
    ? await confirmEmailChange(token)
    : ({ ok: false, grund: "ungueltig" } as const);

  const titel = ergebnis.ok
    ? "Neue Adresse gilt"
    : ergebnis.grund === "belegt"
      ? "Adresse inzwischen vergeben"
      : "Link nicht mehr gültig";

  const text = ergebnis.ok
    ? `Dein Konto läuft jetzt auf ${ergebnis.email}. An diese Adresse gehen ab sofort alle Nachrichten zu deinen Tauschen.`
    : ergebnis.grund === "belegt"
      ? "In der Zwischenzeit hat sich jemand anders mit dieser Adresse angemeldet. Deine bisherige Adresse bleibt unverändert."
      : "Der Link ist abgelaufen oder wurde bereits verwendet. Deine bisherige Adresse bleibt unverändert — du kannst den Wechsel im Konto neu anstossen.";

  return (
    <Card className="p-7 text-center">
      <span
        className={`mx-auto grid h-12 w-12 place-items-center rounded-full text-xl ${
          ergebnis.ok ? "bg-good/12 text-good" : "bg-warn/12 text-warn"
        }`}
        aria-hidden
      >
        {ergebnis.ok ? "✓" : "!"}
      </span>
      <h1 className="mt-4 text-xl display text-ink">{titel}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">{text}</p>
      <Link
        href="/konto"
        className="mt-5 inline-block rounded-lg bg-marke px-5 py-2.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
      >
        Zum Konto
      </Link>
    </Card>
  );
}
