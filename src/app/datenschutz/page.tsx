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
        {`${[
          operatorComplete(op) ? null : "die verantwortliche Stelle",
          op.dbProvider ? null : "der Anbieter der Datenbank",
          "eine Vertretung in der EU (falls nötig)",
          "für die Bekanntgabe ins Ausland die Garantie je Anbieter",
        ]
          .filter(Boolean)
          .join(", ")}. Dieser Text beschreibt, was wirklich passiert. Eine juristische Prüfung ersetzt er nicht.`}
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

      <H2>Wer die Daten sonst noch verarbeitet</H2>
      <p>
        Wir betreiben die Seite nicht auf eigenen Rechnern. Vier Dienstleister sind
        beteiligt, jeder für einen klar umrissenen Teil:
      </p>
      <ul className="ml-5 list-disc space-y-1">
        <li>
          <strong className="font-semibold text-ink">Vercel</strong> (USA) — Betrieb der
          Seite und Speicher für die Fahrzeugfotos. Sieht damit alles, was du aufrufst
          und hochlädst.
        </li>
        <li>
          {op.dbProvider ? (
            <>
              <strong className="font-semibold text-ink">{op.dbProvider}</strong> — die
              Datenbank.
            </>
          ) : (
            <>
              <strong className="font-semibold text-ink">Datenbank</strong> — der Anbieter
              ist hier noch nicht eingetragen.
            </>
          )}{" "}
          Dort liegen Konto, Inserate, Nachrichten und Tauschvorgänge.
        </li>
        <li>
          <strong className="font-semibold text-ink">Stripe</strong> (Irland und USA) —
          Zahlungen und Auszahlungskonten. Siehe oben.
        </li>
        <li>
          <strong className="font-semibold text-ink">Resend</strong> (USA) — der Versand
          unserer E-Mails. Sieht Empfängeradresse und Inhalt der Nachricht.
        </li>
      </ul>
      <p>
        Weiter geht nichts. Wir verkaufen keine Daten, betreiben keine Werbung und haben
        keine Messwerkzeuge eingebaut — die Seite lädt zur Laufzeit nichts von fremden
        Servern nach, nicht einmal Schriften.
      </p>

      <H2>Wie lange wir Daten aufbewahren</H2>
      <p>
        Was technisch anfällt, verschwindet von selbst: Eine Sitzung läuft 30 Tage nach
        der letzten Nutzung ab, ein Bestätigungslink nach 7 Tagen, ein Link zum
        Zurücksetzen des Passworts nach einer Stunde, einer zum Adresswechsel nach 24
        Stunden; benutzte Links und die Zähler der Missbrauchsbremse verschwinden einen
        Tag später. Ein täglicher Lauf räumt das ab — es bleibt nicht liegen.
      </p>
      <p>
        Scheitert der Versand einer Mail, halten wir 30 Tage lang fest, wann das war, woran es
        lag, um welche Art Nachricht es ging und an welche Domain sie sollte — sonst fiele ein
        Ausfall erst auf, wenn sich jemand beschwert. Die Adresse selbst steht dort nicht.
      </p>
      <p>
        Konto, Inserate und Fotos bleiben, bis du sie löschst. Was nach einer
        Kontolöschung übrig bleibt, steht unten. Abgeschlossene Tauschvorgänge und
        Zahlungen bleiben als Buchungsbeleg erhalten — das Obligationenrecht verlangt
        dafür zehn Jahre. Sie sind danach keinem Konto mehr zugeordnet.
      </p>

      <H2>Wie wir die Daten schützen</H2>
      <p>
        Die Verbindung ist immer verschlüsselt; unsere Adresse endet auf <code>.app</code>,
        und für solche Adressen erlauben Browser gar keinen unverschlüsselten Aufruf. Vom
        Passwort speichern wir nur einen Hash (scrypt), von deiner Sitzung ebenfalls nur
        einen Hash — wer die Datenbank läse, könnte sich damit nicht anmelden.
        Kartendaten liegen nie bei uns.
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
