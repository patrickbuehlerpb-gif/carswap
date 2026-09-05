import type { Metadata } from "next";
import { Angabe, H2, LegalPage, Todo } from "@/components/legal";
import { operator, operatorComplete } from "@/lib/operator";

export const metadata: Metadata = { title: "Datenschutz" };

export const dynamic = "force-dynamic";

export default function DatenschutzPage() {
  const op = operator();

  return (
    <LegalPage title="Datenschutzerklärung" updated="September 2026">
      <Todo>
        {operatorComplete(op)
          ? "Aufbewahrungsfristen und, falls einschlägig, die Vertretung in der EU. Diese Erklärung beschreibt die tatsächliche Verarbeitung, ersetzt aber keine juristische Prüfung."
          : "Angaben zur verantwortlichen Stelle, zur Vertretung in der EU (falls einschlägig) und zu den Aufbewahrungsfristen. Diese Erklärung beschreibt die tatsächliche Verarbeitung, ersetzt aber keine juristische Prüfung."}
      </Todo>

      {operatorComplete(op) && (
        <>
          <H2>Verantwortliche Stelle</H2>
          <div className="space-y-1">
            <Angabe label="Name" value={op.name} />
            <Angabe label="Adresse" value={op.address} />
            <Angabe label="E-Mail" value={op.email} />
          </div>
        </>
      )}

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
        Auskunft und Löschung erledigst du selbst unter{" "}
        <a href="/konto" className="text-marke hover:underline">
          Konto
        </a>
        : «Meine Daten herunterladen» gibt alles aus, was zu dir gespeichert ist, «Konto löschen»
        entfernt Name, Adresse und Kontaktdaten und nimmt deine Fahrzeuge aus dem Markt. Deine
        Angaben berichtigst du direkt im Profil. Abgeschlossene Tauschvorgänge bewahren wir aus
        buchhalterischen Gründen auf; sie sind danach nicht mehr deinem Konto zugeordnet. Ein
        Auszahlungskonto bei unserem Zahlungsdienstleister wird dabei von deinem Konto getrennt —
        die dort gespeicherten Angaben unterstehen dessen eigenen Aufbewahrungsfristen und sind
        direkt bei ihm zu löschen.
      </p>
    </LegalPage>
  );
}
