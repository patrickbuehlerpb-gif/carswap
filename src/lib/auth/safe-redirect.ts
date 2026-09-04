/**
 * Nur Ziele auf dieser Seite zulassen.
 *
 * Zwei Umwege sind hier zu schliessen, und beide sehen harmlos aus:
 *
 * 1. Browser behandeln bei http und https den Backslash wie einen
 *    Schrägstrich, «/\evil.example» wird also zu «//evil.example».
 * 2. Der URL-Parser löst «..» auf, bevor er über den Host entscheidet.
 *    «/..//evil.example» hat deshalb den erwarteten Origin, kommt aber als
 *    «//evil.example» wieder heraus — protokoll-relativ und damit fremd.
 *
 * Geprüft wird deshalb der zusammengesetzte Pfad, nicht nur die Herkunft.
 */
export function sicheresZiel(next: string, fallback = "/garage"): string {
  if (!next || next[0] !== "/") return fallback;
  // Zweites Zeichen darf keinen zweiten Trenner einleiten
  if (next[1] === "/" || next[1] === "\\") return fallback;

  try {
    const ziel = new URL(next, "http://ziel.invalid");
    if (ziel.origin !== "http://ziel.invalid") return fallback;

    const pfad = ziel.pathname;
    if (!pfad.startsWith("/") || /^[/\\]{2,}/.test(pfad)) return fallback;
    if (pfad.includes("\\")) return fallback;

    return `${pfad}${ziel.search}`;
  } catch {
    return fallback;
  }
}
