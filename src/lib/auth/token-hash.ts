import { createHash } from "node:crypto";

/**
 * Wie aus einem Geheimnis der Suchschlüssel wird.
 *
 * Sitzungen und Einmal-Token benutzen dieselbe Ableitung, und sie steht
 * deshalb an einer Stelle: Vorher gab es sie zweimal Zeichen für Zeichen, und
 * wer sie einmal ändert — ein Pfeffer, ein anderes Verfahren —, hätte sie für
 * das eine geändert und für das andere nicht.
 *
 * Eigene Datei, weil beide Seiten sie brauchen und `session.ts` in den Tests
 * ersetzt wird: Hinge `tokens.ts` daran, liefe es dort ins Leere.
 *
 * Kein Salz und kein langsames Verfahren: Ein Token hat 256 Bit aus dem
 * Zufallsgenerator, da gibt es nichts zu erraten. Gehasht wird, damit ein
 * Blick in die Datenbank keine gültigen Zugänge liefert.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
