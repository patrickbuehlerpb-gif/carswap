import type { Metadata } from "next";
import { H2, LegalPage, Todo } from "@/components/legal";

export const metadata: Metadata = { title: "AGB" };

export default function AgbPage() {
  return (
    <LegalPage title="Allgemeine Geschäftsbedingungen" updated="September 2026">
      <Todo>
        Diese Fassung beschreibt, wie die Plattform tatsächlich funktioniert. Sie muss vor der
        öffentlichen Freischaltung anwaltlich geprüft werden — insbesondere die Abgrenzung der
        Treuhandfunktion gegenüber dem Geldwäschereigesetz und die Gewährleistung beim Tausch
        unter Privatpersonen.
      </Todo>

      <H2>1. Was CarSwap ist</H2>
      <p>
        CarSwap ist ein Marktplatz, auf dem Privatpersonen Fahrzeuge direkt gegeneinander tauschen.
        Der Tauschvertrag kommt ausschliesslich zwischen den beiden Nutzenden zustande. CarSwap ist
        nicht Vertragspartei, nicht Verkäuferin und nicht Vermittlerin im rechtlichen Sinn.
      </p>

      <H2>2. Bewertungen sind Schätzungen</H2>
      <p>
        Die angezeigten Fahrzeugwerte stammen aus einem Rechenmodell auf Basis der von den
        Nutzenden eingetragenen Angaben. Sie sind eine Orientierung, kein Gutachten und keine
        Zusicherung. Der tatsächlich vereinbarte Ausgleich wird zwischen den Parteien frei
        ausgehandelt.
      </p>

      <H2>3. Angaben zum Fahrzeug</H2>
      <p>
        Wer ein Fahrzeug einstellt, sichert zu, dass die Angaben nach bestem Wissen richtig und
        vollständig sind — insbesondere Kilometerstand, Unfallfreiheit und bekannte Mängel. Wer
        wesentliche Mängel verschweigt, haftet der Gegenseite gegenüber.
      </p>

      <H2>4. Treuhand</H2>
      <p>
        Bei einer Wertdifferenz wird der Ausgleich über Stripe reserviert. Der Betrag wird erst
        eingezogen und weitergeleitet, wenn beide Seiten die Übergabe bestätigt haben. Bricht eine
        Partei vorher ab, wird die Reservierung freigegeben oder der Betrag erstattet.
      </p>
      <p>
        Die Autorisierung einer Kartenzahlung verfällt nach sieben Tagen. Wird die Übergabe bis
        dahin nicht von beiden Seiten bestätigt, muss die Einzahlung wiederholt werden.
      </p>

      <H2>5. Gewährleistung</H2>
      <p>
        Beim Tausch unter Privatpersonen gilt das Schweizerische Obligationenrecht. Ein Ausschluss
        der Gewährleistung ist zulässig, greift aber nicht bei absichtlich verschwiegenen Mängeln.
        CarSwap empfiehlt beiden Seiten, den Zustand vor der Übergabe schriftlich festzuhalten.
      </p>

      <H2>6. Halterwechsel</H2>
      <p>
        Der Halterwechsel, die Versicherung und allfällige Steuern sind Sache der beteiligten
        Personen. CarSwap stellt dafür eine Checkliste bereit, übernimmt aber keine Behördengänge.
      </p>

      <H2>7. Kosten</H2>
      <p>
        Die Nutzung der Plattform ist derzeit kostenlos. Bei Zahlungen über Stripe fallen die
        Gebühren von Stripe an; sie werden vor der Einzahlung ausgewiesen.
      </p>

      <H2>8. Sperrung</H2>
      <p>
        Konten mit offensichtlich falschen Angaben, gefälschten Fahrzeugdaten oder betrügerischer
        Absicht können ohne Vorankündigung gesperrt werden.
      </p>
    </LegalPage>
  );
}
