import type { Metadata } from "next";
import { Angabe, H2, LegalPage, Todo } from "@/components/legal";
import { operator, operatorComplete } from "@/lib/operator";

export const metadata: Metadata = { title: "Impressum" };
export const dynamic = "force-dynamic";

export default function ImpressumPage() {
  const op = operator();

  return (
    <LegalPage title="Impressum" updated="September 2026">
      {!operatorComplete(op) && (
        <Todo>
          Firmenname, Rechtsform, vollständige Adresse, UID/MWST-Nummer, Handelsregistereintrag und
          eine Kontaktadresse für rechtliche Anfragen. Ohne diese Angaben ist der Betrieb in der
          Schweiz nicht zulässig (Art. 3 Abs. 1 lit. s UWG). Die Werte werden über die
          Umgebungsvariablen <code>OPERATOR_NAME</code>, <code>OPERATOR_ADDRESS</code> und{" "}
          <code>OPERATOR_EMAIL</code> gesetzt, optional dazu <code>OPERATOR_LEGAL_FORM</code>,{" "}
          <code>OPERATOR_UID</code>, <code>OPERATOR_REGISTER</code> und{" "}
          <code>OPERATOR_PHONE</code>.
        </Todo>
      )}

      <H2>Betreiberin</H2>
      {operatorComplete(op) ? (
        <div className="space-y-1">
          <Angabe label="Name" value={op.name} />
          <Angabe label="Rechtsform" value={op.legalForm} />
          <Angabe label="Adresse" value={op.address} />
          <Angabe label="UID/MWST" value={op.uid} />
          <Angabe label="Handelsregister" value={op.register} />
        </div>
      ) : (
        <p>
          Die vollständigen Angaben zur Betreiberin sind noch nicht hinterlegt. Bis dahin ist diese
          Plattform nicht für den öffentlichen Betrieb bestimmt.
        </p>
      )}

      <H2>Kontakt</H2>
      {op.email || op.phone ? (
        <div className="space-y-1">
          <Angabe label="E-Mail" value={op.email} />
          <Angabe label="Telefon" value={op.phone} />
        </div>
      ) : (
        <p>Für rechtliche Anfragen ist noch keine Kontaktadresse hinterlegt.</p>
      )}

      <H2>Haftung für Inhalte</H2>
      <p>
        Inserate stammen von Nutzerinnen und Nutzern. CarSwap prüft weder die Fahrzeuge noch die
        Angaben dazu. Für die Richtigkeit der Fahrzeugdaten ist ausschliesslich die inserierende
        Person verantwortlich.
      </p>
    </LegalPage>
  );
}
