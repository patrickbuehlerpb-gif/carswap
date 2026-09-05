import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { verifyEmailToken } from "@/app/actions/auth";

export const metadata: Metadata = { title: "E-Mail bestätigen" };

export default async function EmailBestaetigenPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const ok = token ? await verifyEmailToken(token) : false;

  return (
    <Card className="p-7 text-center">
      <span
        className={`mx-auto grid h-12 w-12 place-items-center rounded-full text-xl ${
          ok ? "bg-good/12 text-good" : "bg-warn/12 text-warn"
        }`}
        aria-hidden
      >
        {ok ? "✓" : "!"}
      </span>
      <h1 className="mt-4 text-xl display text-ink">
        {ok ? "E-Mail-Adresse bestätigt" : "Link nicht mehr gültig"}
      </h1>
      <p className="mt-2 text-sm text-ink-3">
        {ok
          ? "Danke — dein Konto ist jetzt vollständig eingerichtet."
          : "Der Bestätigungslink ist abgelaufen oder wurde bereits verwendet. Du kannst dir in deinem Konto einen neuen schicken lassen."}
      </p>
      <Link
        href={ok ? "/garage" : "/konto"}
        className="mt-5 inline-block rounded-lg bg-marke px-5 py-2.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
      >
        {ok ? "Zur Garage" : "Zum Konto"}
      </Link>
    </Card>
  );
}
