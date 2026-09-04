/**
 * Nur Ziele auf dieser Seite zulassen.
 *
 * Eine Prüfung auf «beginnt mit / und nicht mit //» reicht nicht: Browser
 * behandeln bei http und https auch den Backslash wie einen Schrägstrich,
 * sodass «/\evil.example» zu «//evil.example» und damit zu einer fremden
 * Domain wird. Auf einer Plattform, die Geld bewegt, ist das eine brauchbare
 * Phishing-Kette — der Link zeigt auf die echte Adresse, die Anmeldung ist
 * echt, und danach landet man beim Angreifer.
 */
export function sicheresZiel(next: string, fallback = "/garage"): string {
  if (!next || !next.startsWith("/")) return fallback;
  try {
    const ziel = new URL(next, "http://ziel.invalid");
    if (ziel.origin !== "http://ziel.invalid") return fallback;
    return `${ziel.pathname}${ziel.search}`;
  } catch {
    return fallback;
  }
}
