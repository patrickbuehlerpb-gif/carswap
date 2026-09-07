import "server-only";
import { mailConfigured } from "../mail";

/**
 * Was ein stillgelegtes Konto noch darf: sich anmelden, seine Tausche
 * ansehen, seine Daten holen, sein Konto löschen. Was nicht: inserieren,
 * tauschen, bewerten. Der Zugang bleibt offen, damit die Person an ihre
 * laufenden Vorgänge und ihre Daten kommt — eine Sperre ist kein Grund,
 * jemanden auszusperren.
 *
 * Die Eigenschaft ist verlangt und nicht optional: Wäre sie es, liesse sich
 * hier auch eine Zeile aus der Benutzertabelle hineingeben — die trägt
 * `suspendedAt` und kein `suspended`, der Wächter läse `undefined` und liesse
 * jedes stillgelegte Konto durch, ohne dass es beim Übersetzen auffiele.
 */
export function suspendedNotice(me: { suspended: boolean }): string | null {
  if (!me.suspended) return null;
  return (
    "Dein Konto ist stillgelegt. Du kommst weiterhin an deine laufenden Tausche und deine " +
    "Daten, neue Inserate und Tausche sind aber gesperrt. Melde dich beim Support."
  );
}

/**
 * Verbindliche Schritte setzen eine bestätigte E-Mail-Adresse voraus — sonst
 * steht die Gegenseite am Ende mit einer Adresse da, die nie jemand erreicht
 * hat. Die Oberfläche kündigt genau das an.
 *
 * Kann diese Installation gar keine Mails verschicken, wäre die Bestätigung
 * unmöglich und die Regel würde jeden aussperren. Dann greift sie nicht — der
 * Zustand steht in /api/health und im README.
 */
export function braucheBestaetigteMail(me: { emailVerified: boolean }): string | null {
  if (!mailConfigured()) return null;
  if (me.emailVerified) return null;
  return (
    "Bitte bestätige zuerst deine E-Mail-Adresse — den Link findest du in deinem Postfach, " +
    "erneut senden kannst du ihn unter «Konto»."
  );
}
