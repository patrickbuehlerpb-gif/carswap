import type { Metadata } from "next";
import { MarketBrowser } from "@/components/market-browser";
import { SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "Marktplatz" };

export default function MarktPage() {
  return (
    <div>
      <SectionHead
        title="Marktplatz"
        sub="Alle Fahrzeuge, die zum Tausch stehen. Die Zuzahlung wird laufend gegen dein ausgewähltes Fahrzeug gerechnet — du siehst also immer, was ein Tausch dich unter dem Strich kostet."
      />
      <MarketBrowser />
    </div>
  );
}
