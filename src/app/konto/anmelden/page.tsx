import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth-forms";
import { Card } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Anmelden" };

export default async function AnmeldenPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; zurueckgesetzt?: string }>;
}) {
  if (await getSessionUser()) redirect("/garage");
  const { next, zurueckgesetzt } = await searchParams;

  return (
    <Card className="p-6 sm:p-7">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Anmelden</h1>
      <p className="mt-1 mb-6 text-sm text-ink-3">Willkommen zurück bei CarSwap.</p>
      {zurueckgesetzt && (
        <p className="mb-4 rounded-lg border border-good/35 bg-good/12 p-3 text-sm text-good">
          Passwort geändert. Melde dich mit dem neuen Passwort an.
        </p>
      )}
      <SignInForm next={next} />
    </Card>
  );
}
