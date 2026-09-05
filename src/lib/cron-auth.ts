import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Darf dieser Aufruf einen Hintergrundlauf auslösen?
 *
 * Ohne gültiges Geheimnis passiert nichts. Ist keines gesetzt, laufen die
 * Endpunkte ausserhalb der Produktion trotzdem — sonst liessen sie sich lokal
 * nicht ausprobieren.
 *
 * Vercel schickt `CRON_SECRET` als Bearer-Token mit; `HEALTH_TOKEN` gilt
 * ersatzweise, damit eine Installation nicht zwei Geheimnisse braucht.
 */
export function darfLaufen(request: Request): boolean {
  const geheim = process.env.CRON_SECRET || process.env.HEALTH_TOKEN;
  if (!geheim) return process.env.NODE_ENV !== "production";

  const header = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!header) return false;

  // Zeitkonstant über die Hashes vergleichen: timingSafeEqual verlangt gleich
  // lange Puffer, und die Länge selbst wäre schon eine Auskunft.
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(geheim).digest();
  return timingSafeEqual(a, b);
}
