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
          ? "Es fehlen noch die Aufbewahrungsfristen und, falls nötig, eine Vertretung in der EU. Dieser Text beschreibt, was wirklich passiert. Eine juristische Prüfung ersetzt er nicht."
          : "Es fehlen noch die verantwortliche Stelle, eine Vertretung in der EU (falls nötig) und die Aufbewahrungsfristen. Dieser Text beschreibt, was wirklich passiert. Eine juristische Prüfung ersetzt er nicht."}
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
        Beim Anlegen eines Kontos speichern wir Name, E-Mail-Adresse, Ort und Kanton. Vom Passwort
        speichern wir nur einen Hash, nie das Passwort selbst. Eine Telefonnummer ist freiwillig;
        sie sieht nur, wer dir einen Tausch zugesagt hat.
      </p>
      <p>
        Zu jedem Inserat speichern wir die Daten, die du einträgst, und die Fotos, die du
        hochlädst. Zu jedem Tausch speichern wir eure Nachrichten und die Beträge.
      </p>

      <H2>Sitzungen und Cookies</H2>
      <p>
        Wir setzen genau ein Cookie: <code>autotauschen_session</code>. Darin steht eine zufällige
        Zeichenkette, an der wir dich wiedererkennen. Nach 30 Tagen läuft sie ab. In der Datenbank
        liegt davon nur ein Hash. Wir verfolgen dich nicht und lassen niemanden mitmessen.
      </p>

      <H2>Zahlungen</H2>
      <p>
        Zahlungen laufen über Stripe. Kartendaten und Bankverbindungen erreichen unsere Server
        nie — die sieht nur Stripe. Für Auszahlungen legt Stripe ein Konto an und prüft, wer du
        bist. Von uns gespeichert wird davon nur die Konto-Nummer bei Stripe und ob Auszahlungen
        freigeschaltet sind.
      </p>

      <H2>E-Mails</H2>
      <p>
        Wir schreiben dir, um deine Adresse zu bestätigen, dein Passwort zurückzusetzen und wenn
        sich bei einem deiner Tausche etwas tut. Ändert jemand Passwort oder Adresse deines Kontos,
        sagen wir dir das ebenfalls — auch an die bisherige Adresse. Dazu kommt höchstens eine
        Nachricht am Tag, wenn jemand auftaucht, der dein Auto sucht; die lässt sich im Konto
        abstellen. Werbung bekommst du von uns nicht.
      </p>

      <H2>Deine Rechte</H2>
      <p>
        Auskunft und Löschung erledigst du selbst unter{" "}
        <a href="/konto" className="textlink">
          Konto
        </a>
        : «Meine Daten herunterladen» gibt alles aus, was zu dir gespeichert ist, «Konto löschen»
        entfernt Name, Adresse und Kontaktdaten und nimmt deine Autos aus dem Markt. Deine
        Angaben berichtigst du direkt im Profil. Abgeschlossene Tauschvorgänge bewahren wir aus
        buchhalterischen Gründen auf; sie sind danach nicht mehr deinem Konto zugeordnet. Ein
        Auszahlungskonto bei unserem Zahlungsdienstleister wird dabei von deinem Konto getrennt —
        die dort gespeicherten Angaben unterstehen dessen eigenen Aufbewahrungsfristen und sind
        direkt bei ihm zu löschen.
      </p>
    </LegalPage>
  );
}
