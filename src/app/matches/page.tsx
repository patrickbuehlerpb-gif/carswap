import type { Metadata } from "next";
import { MatchFinder } from "@/components/match-finder";
import { SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "Matches" };

export default function MatchesPage() {
  return (
    <div>
      <SectionHead
        title="Passende Tausche"
        sub="Ein Tausch kommt nur zustande, wenn beide Seiten wollen. Deshalb wird hier nicht nur gefiltert, was dir gefällt, sondern auch, wer dein Fahrzeug sucht — und wenn es direkt nicht passt, über wen es doch geht."
      />
      <MatchFinder />
    </div>
  );
}
