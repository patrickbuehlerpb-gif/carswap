import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth-forms";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Neues Passwort" };

export default async function PasswortNeuPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <Card className="p-6 text-center sm:p-7">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Link unvollständig</h1>
        <p className="mt-2 text-sm text-ink-3">
          Dieser Link enthält kein Token. Fordere einen neuen an.
        </p>
        <Link
          href="/konto/passwort-vergessen"
          className="mt-4 inline-block text-sm text-volt-ink hover:underline"
        >
          Neuen Link anfordern →
        </Link>
      </Card>
    );
  }

  return (
    <Card className="p-6 sm:p-7">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Neues Passwort setzen</h1>
      <p className="mt-1 mb-6 text-sm text-ink-3">
        Wähle ein Passwort, das du sonst nirgends verwendest.
      </p>
      <ResetPasswordForm token={token} />
    </Card>
  );
}
