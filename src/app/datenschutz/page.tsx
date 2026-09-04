import type { Metadata } from "next";
import { H2, LegalPage, Todo } from "@/components/legal";

export const metadata: Metadata = { title: "Datenschutz" };

export default function DatenschutzPage() {
  return (
    <LegalPage title="Datenschutzerklärung" updated="September 2026">
      <Todo>
        Angaben zur verantwortlichen Stelle, zur Vertretung in der EU (falls einschlägig) und zu
        den Aufbewahrungsfristen. Diese Erklärung beschreibt die tatsächliche Verarbeitung, ersetzt
        aber keine juristische Prüfung.
      </Todo>

      <H2>Welche Daten wir verarbeiten</H2>
      <p>
        Beim Anlegen eines Kontos speichern wir Name, E-Mail-Adresse, Ort und Kanton sowie einen
        Hash deines Passworts. Das Passwort selbst wird nie gespeichert. Optional kommt eine
        Telefonnummer dazu, die nur der Gegenseite eines zugesagten Tauschs gezeigt wird.
      </p>
      <p>
        Zu jedem Inserat speichern wir die Fahrzeugdaten, die du einträgst, sowie hochgeladene
        Fotos. Zu Tauschvorgängen speichern wir die ausgetauschten Nachrichten und Beträge.
      </p>

      <H2>Sitzungen und Cookies</H2>
      <p>
        Wir setzen genau ein Cookie: <code>carswap_session</code>. Es enthält eine zufällige
        Zeichenkette, mit der wir deine Sitzung wiedererkennen, und läuft nach 30 Tagen ab. In der
        Datenbank liegt davon nur ein Hash. Es findet kein Tracking und keine Analyse durch Dritte
        statt.
      </p>

      <H2>Zahlungen</H2>
      <p>
        Ausgleichszahlungen wickeln wir über Stripe ab. Kreditkartendaten und Bankverbindungen
        erreichen unsere Server nicht — sie werden ausschliesslich von Stripe verarbeitet. Für
        Auszahlungen legt Stripe ein Konto an und prüft die Identität. Wir speichern dazu nur die
        Stripe-Konto-ID und ob Auszahlungen freigeschaltet sind.
      </p>

      <H2>E-Mails</H2>
      <p>
        Wir versenden E-Mails zur Bestätigung der Adresse, zum Zurücksetzen des Passworts und zu
        Ereignissen in deinen Tauschvorgängen. Werbung verschicken wir nicht.
      </p>

      <H2>Deine Rechte</H2>
      <p>
        Du kannst Auskunft über die zu dir gespeicherten Daten verlangen, sie berichtigen lassen
        oder die Löschung deines Kontos verlangen. Abgeschlossene Tauschvorgänge bewahren wir aus
        buchhalterischen Gründen auf; sie werden dabei von deinem Konto entkoppelt.
      </p>
    </LegalPage>
  );
}
