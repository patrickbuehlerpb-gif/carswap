import type { Metadata } from "next";
import { ValuationStudio } from "@/components/valuation-studio";
import { SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { getMyVehicles } from "@/lib/queries";
import { currentMonth } from "@/lib/valuation";

export const metadata: Metadata = { title: "Wertrechner" };
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
    </div>
  );
}
