import type { Metadata } from "next";
import { DealList } from "@/components/deal-list";
import { SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "Tausche" };

export default function DealsPage() {
  return (
    <div>
      <SectionHead
        title="Deine Tausche"
        sub="Jeder Vorgang durchläuft dieselben Stationen: Vorschlag, Verhandlung, Zusage, Treuhand und Übergabe. Beträge sind bis zur Zusage jederzeit verhandelbar."
      />
      <DealList />
    </div>
  );
}
