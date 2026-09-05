import type { Metadata } from "next";
import { H2, LegalPage, Todo } from "@/components/legal";

export const metadata: Metadata = { title: "AGB" };

export const dynamic = "force-dynamic";

export default function AgbPage() {
  return (
    <LegalPage title="Allgemeine Geschäftsbedingungen" updated="September 2026">
      <Todo>
        Diese Fassung beschreibt, wie die Plattform wirklich funktioniert. Vor der öffentlichen
        Freischaltung muss sie eine Anwältin prüfen. Zwei Fragen vor allem: Fällt das Verwahren
        von Ausgleichszahlungen unter das Geldwäschereigesetz? Und wie weit reicht die
        Gewährleistung beim Tausch unter Privatpersonen?
      </Todo>

      <H2>1. Was autotauschen ist</H2>
      <p>
        Auf autotauschen tauschen Privatpersonen ihre Autos direkt gegeneinander. Der Vertrag kommt
        zwischen den beiden Personen zustande, nicht mit uns. Wir sind weder Vertragspartei noch
        Verkäuferin noch Vermittlerin im rechtlichen Sinn.
      </p>

      <H2>2. Werte sind Schätzungen</H2>
      <p>
        Die angezeigten Werte kommen aus einem Rechenmodell. Es rechnet mit dem, was die
        Nutzenden selbst eingetragen haben. Das ist eine Orientierung, kein Gutachten und keine
        Zusicherung. Was am Ende bezahlt wird, handeln die beiden Seiten frei aus.
      </p>

      <H2>3. Angaben zum Auto</H2>
      <p>
        Wer ein Auto einstellt, sichert zu, dass die Angaben nach bestem Wissen stimmen und
        vollständig sind. Das gilt besonders für Kilometerstand, Unfallfreiheit und bekannte
        Mängel. Wer einen wesentlichen Mangel verschweigt, haftet dafür gegenüber der anderen
        Seite.
      </p>

      <H2>4. Wie das Geld verwahrt wird</H2>
      <p>
        Ist ein Auto mehr wert als das andere, wird die Differenz über Stripe reserviert. Der
        Betrag wird erst eingezogen und weitergeleitet, wenn beide Seiten die Übergabe bestätigt
        haben. Bricht jemand vorher ab, geben wir die Reservierung frei oder erstatten den Betrag.
      </p>
      <p>
        Eine reservierte Kartenzahlung verfällt nach sieben Tagen. Wird die Übergabe bis dahin
        nicht von beiden bestätigt, muss neu eingezahlt werden.
      </p>

      <H2>5. Gewährleistung</H2>
      <p>
        Beim Tausch unter Privatpersonen gilt das Schweizerische Obligationenrecht. Ihr dürft die
        Gewährleistung ausschliessen, aber der Ausschluss greift nicht bei einem Mangel, den
        jemand absichtlich verschwiegen hat. Haltet den Zustand vor der Übergabe schriftlich fest.
      </p>

      <H2>6. Halterwechsel</H2>
      <p>
        Halterwechsel, Versicherung und allfällige Steuern sind Sache der beteiligten Personen.
        Wir stellen eine Checkliste bereit, gehen aber nicht für euch aufs Amt.
      </p>

      <H2>7. Kosten</H2>
      <p>
        Die Plattform ist derzeit kostenlos. Bei Zahlungen über Stripe fallen die Gebühren von
        Stripe an. Sie stehen da, bevor du einzahlst.
      </p>

      <H2>8. Sperrung</H2>
      <p>
        Konten mit offensichtlich falschen Angaben, gefälschten Fahrzeugdaten oder betrügerischer
        Absicht sperren wir ohne Vorankündigung.
      </p>
    </LegalPage>
  );
}
