import type { Metadata } from "next";
import { H2, LegalPage, Todo } from "@/components/legal";

export const metadata: Metadata = { title: "Impressum" };

export default function ImpressumPage() {
  return (
    <LegalPage title="Impressum" updated="September 2026">
      <Todo>
        Firmenname, Rechtsform, vollständige Adresse, UID/MWST-Nummer, Handelsregistereintrag und
        eine Kontaktadresse für rechtliche Anfragen. Ohne diese Angaben ist der Betrieb in der
        Schweiz nicht zulässig (Art. 3 Abs. 1 lit. s UWG).
      </Todo>

      <H2>Betreiberin</H2>
      <p>
        CarSwap wird betrieben von der Betreiberin dieser Plattform. Die vollständigen Angaben
        werden vor der öffentlichen Freischaltung hier eingetragen.
      </p>

      <H2>Kontakt</H2>
      <p>
        Für Fragen zur Plattform, zu einzelnen Tauschvorgängen oder zu Zahlungen erreichst du uns
        über die im Konto hinterlegte支持-Adresse.
      </p>

      <H2>Haftung für Inhalte</H2>
      <p>
        Inserate stammen von Nutzerinnen und Nutzern. CarSwap prüft weder die Fahrzeuge noch die
        Angaben dazu. Für die Richtigkeit der Fahrzeugdaten ist ausschliesslich die inserierende
        Person verantwortlich.
      </p>
    </LegalPage>
  );
}
