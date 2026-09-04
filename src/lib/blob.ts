import "server-only";
import { del } from "@vercel/blob";
import { isBlobUrl } from "./validation";

/**
 * Entfernt Bilder aus dem Blob-Speicher.
 *
 * Ohne diesen Weg blieben Fotos nach dem Löschen eines Inserats oder eines
 * ganzen Kontos unbefristet öffentlich abrufbar — die Adressen sind zwar
 * nicht ratbar, aber dauerhaft gültig und stehen bis dahin im HTML.
 *
 * Ein Fehlschlag darf die aufrufende Aktion nie scheitern lassen: dass ein
 * Bild liegen bleibt, ist ärgerlich, ein abgebrochener Kontolöschvorgang
 * wäre schlimmer.
 */
export async function deleteBlobs(urls: string[]): Promise<void> {
  const gueltig = urls.filter(isBlobUrl);
  if (!gueltig.length || !process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await del(gueltig);
  } catch (err) {
    console.error(`[blob] ${gueltig.length} Datei(en) liessen sich nicht löschen:`, err);
  }
}
