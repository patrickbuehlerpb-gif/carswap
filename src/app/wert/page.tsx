import type { Metadata } from "next";
import { ValuationStudio } from "@/components/valuation-studio";
import { SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "Wertrechner" };

export default function WertPage() {
  return (
    <div>
      <SectionHead
        title="Was ist mein Fahrzeug wert?"
        sub="Kein einzelner Schätzpreis, sondern eine nachvollziehbare Rechnung: Restwertkurve des Segments, Laufleistung gegenüber der Norm, Zustand, Ausstattung und die aktuelle Marktlage — jeder Faktor einzeln ausgewiesen."
      />
      <ValuationStudio />
    </div>
  );
}
