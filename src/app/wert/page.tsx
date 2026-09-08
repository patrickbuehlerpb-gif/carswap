import type { Metadata } from "next";
import Link from "next/link";
import { ValuationStudio } from "@/components/valuation-studio";
import { SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { getMyVehicles } from "@/lib/queries";
import { currentMonth } from "@/lib/valuation";

export const metadata: Metadata = {
  title: "Wertrechner",
  description:
    "Was ist dein Auto heute wert, und was in zwei Jahren? Mit vollständiger Aufschlüsselung.",
  alternates: { canonical: "/wert" },
};
export const dynamic = "force-dynamic";

export default async function WertPage() {
  const me = await getSessionUser();
  const myVehicles = me ? await getMyVehicles(me.id) : [];

  return (
    <div>
      <SectionHead
        title="Was ist mein Auto wert?"
        sub="Keine einzelne Schätzung, sondern eine Rechnung, die du nachvollziehen kannst. Alter, Kilometer, Zustand, Ausstattung und Marktlage stehen einzeln da."
      />
      <ValuationStudio myVehicles={myVehicles} asOf={currentMonth()} />
      <p className="mt-6 text-sm text-ink-3">
        Wie die Kurve dahinter verläuft und woran der Wert sonst noch hängt, steht auf{" "}
        <Link href="/wertverlust" className="text-akzent underline underline-offset-2">
          Was ein Auto an Wert verliert
        </Link>
        .
      </p>
    </div>
  );
}
