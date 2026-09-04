import "server-only";

/**
 * Was ein stillgelegtes Konto noch darf: sich anmelden, seine Tausche
 * ansehen, seine Daten holen, sein Konto löschen. Was nicht: inserieren,
 * tauschen, bewerten. Der Zugang bleibt offen, damit die Person an ihre
 * laufenden Vorgänge und ihre Daten kommt — eine Sperre ist kein Grund,
 * jemanden auszusperren.
 */
export function suspendedNotice(me: { suspended?: boolean }): string | null {
  if (!me.suspended) return null;
  return (
    "Dein Konto ist stillgelegt. Du kommst weiterhin an deine laufenden Tausche und deine " +
    "Daten, neue Inserate und Tausche sind aber gesperrt. Melde dich beim Support."
  );
}
