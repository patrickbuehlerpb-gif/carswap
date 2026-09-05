import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth-forms";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Passwort vergessen" };

export default function PasswortVergessenPage() {
  return (
    <Card className="p-6 sm:p-7">
      <h1 className="text-xl display text-ink">Passwort vergessen</h1>
      <p className="mt-1 mb-6 text-sm text-ink-3">
        Wir schicken dir einen Link, mit dem du ein neues Passwort setzen kannst. Er ist eine
        Stunde gültig.
      </p>
      <ForgotPasswordForm />
    </Card>
  );
}
