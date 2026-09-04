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
        title="Was ist mein Fahrzeug wert?"
        sub="Kein einzelner Schätzpreis, sondern eine nachvollziehbare Rechnung: Restwertkurve des Segments, Laufleistung gegenüber der Norm, Zustand, Ausstattung und die aktuelle Marktlage — jeder Faktor einzeln ausgewiesen."
      />
      <ValuationStudio myVehicles={myVehicles} asOf={currentMonth()} />
    </div>
  );
}
