import "server-only";
import { head } from "@vercel/blob";
import { erlaubterFotoHost } from "./validation";

/**
 * Gehören diese Fotoadressen wirklich in unseren Speicher?
 *
 * Beim Speichern eines Inserats darf nur hinein, was über den Upload dieser
 * Seite hochgeladen wurde. Sonst liesse sich über ein Inserat ein beliebiges
 * fremdes Bild einhängen — auf Kosten und im Namen eines anderen Kontos.
 *
 * Bisher entschied das allein der Hostname, abgeleitet aus der Store-Kennung
 * im Token. Das ist eine Vermutung über ein Format, das uns nicht gehört, und
 * sie steht auf dem kritischen Weg: Seit ein Inserat drei Fotos braucht, hiesse
 * eine falsche Ableitung, dass überhaupt kein Inserat mehr entsteht — mit
 * «lade es über diese Seite hoch» als einziger Auskunft, also mit dem Verdacht
 * bei der falschen Person.
 *
 * Deshalb zwei Wege: Stimmt der Hostname, ist die Sache ohne Netzaufruf
 * erledigt — das ist der Normalfall. Stimmt er nicht, wird nicht geraten,
 * sondern der Speicher selbst gefragt. `head` beantwortet mit unserem Token
 * nur, was in unserem Speicher liegt; eine fremde Adresse wirft.
 */
export async function fremdeFotoAdressen(urls: string[]): Promise<string[]> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  // Ohne eingerichteten Speicher gibt es keinen eigenen, gegen den sich
  // abgrenzen liesse — dann ist auch keine Adresse fremd.
  if (!token) return [];

  const erwartet = erlaubterFotoHost();
  const fremd: string[] = [];

  for (const url of urls) {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      fremd.push(url);
      continue;
    }
    if (erwartet && host === erwartet) continue;

    try {
      await head(url, { token });
      /*
       * Die Adresse gehört uns, der abgeleitete Hostname war also falsch.
       * Das Inserat geht durch — aber es steht im Protokoll, denn ohne die
       * Abkürzung kostet jedes Foto beim Speichern einen Netzaufruf.
       */
      console.error(
        `[fotos] Abgeleiteter Hostname stimmt nicht: erwartet ${erwartet ?? "keiner"}, ` +
          `tatsächlich ${host}. Mit BLOB_PUBLIC_HOST=${host} setzen, dann entfällt die Rückfrage.`,
      );
    } catch {
      fremd.push(url);
    }
  }

  return fremd;
}
