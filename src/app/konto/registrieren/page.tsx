import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth-forms";
import { Card } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Konto erstellen" };

export default async function RegistrierenPage() {
  if (await getSessionUser()) redirect("/garage");
  return (
    <Card className="p-6 sm:p-7">
      <h1 className="text-xl display text-ink">Konto erstellen</h1>
      <p className="mt-1 mb-6 text-sm text-ink-3">
        Danach kannst du dein Auto einstellen und Tauschvorschläge erhalten.
      </p>
      <SignUpForm />
    </Card>
  );
}
