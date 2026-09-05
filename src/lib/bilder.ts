/**
 * Fotos vor dem Hochladen verkleinern.
 *
 * Ein heutiges Telefon liefert 4000×3000 Pixel und mehrere Megabyte. Beides
 * ist für ein Inserat sinnlos gross: angezeigt wird das Bild nie breiter als
 * ein Bildschirm. Ungefragt hochgeladen kostet es die inserierende Person
 * Wartezeit und mobiles Datenvolumen — und jede Person, die den Marktplatz
 * später öffnet, noch einmal dasselbe.
 *
 * Läuft im Browser, nicht auf dem Server: was gar nicht erst hochgeladen wird,
 * muss auch nicht bezahlt und nicht wieder verkleinert werden.
 */

/** Längste Kante nach dem Verkleinern. Reicht für jede Anzeige, auch auf 4K. */
export const MAX_KANTE = 2000;

/** WebP ist überall verfügbar, kleiner als JPEG und behält Transparenz. */
const FORMAT = "image/webp";
const QUALITAET = 0.85;

export interface VerkleinertesBild {
  datei: File;
  width: number;
  height: number;
  /** Was der Verkleinerungsschritt eingespart hat, in Byte. */
  gespart: number;
}

export class BildFehler extends Error {}

/**
 * Zielmasse für ein Bild. Kleinere Bilder bleiben, wie sie sind — ein
 * Hochrechnen macht sie nur grösser, nicht besser.
 */
export function zielMasse(
  width: number,
  height: number,
  maxKante = MAX_KANTE,
): { width: number; height: number } {
  const laengste = Math.max(width, height);
  if (laengste <= maxKante) return { width, height };
  const faktor = maxKante / laengste;
  return {
    width: Math.max(1, Math.round(width * faktor)),
    height: Math.max(1, Math.round(height * faktor)),
  };
}

/**
 * Verkleinert eine Bilddatei. Gibt das Original zurück, wenn es ohnehin klein
 * genug ist oder wenn das Ergebnis grösser wäre als der Ausgangswert — bei
 * bereits gut komprimierten Dateien kann das Neucodieren zulegen.
 */
export async function verkleinere(datei: File, maxKante = MAX_KANTE): Promise<VerkleinertesBild> {
  const bild = await dekodiere(datei);
  const ziel = zielMasse(bild.width, bild.height, maxKante);

  try {
    if (ziel.width === bild.width && ziel.height === bild.height && datei.size <= 600_000) {
      return { datei, width: bild.width, height: bild.height, gespart: 0 };
    }

    const leinwand = document.createElement("canvas");
    leinwand.width = ziel.width;
    leinwand.height = ziel.height;
    const stift = leinwand.getContext("2d");
    if (!stift) return { datei, width: bild.width, height: bild.height, gespart: 0 };
    stift.drawImage(bild, 0, 0, ziel.width, ziel.height);

    const blob = await neuCodieren(leinwand);
    if (!blob || blob.size >= datei.size) {
      return { datei, width: bild.width, height: bild.height, gespart: 0 };
    }

    // Die Endung muss zum tatsächlichen Inhalt passen: konnte der Browser
    // kein WebP schreiben, steckt hier JPEG drin.
    const endung = blob.type === "image/webp" ? "webp" : "jpg";
    const name = datei.name.replace(/\.[^.]+$/, "") || "foto";
    return {
      datei: new File([blob], `${name}.${endung}`, { type: blob.type }),
      width: ziel.width,
      height: ziel.height,
      gespart: datei.size - blob.size,
    };
  } finally {
    bild.close();
  }
}

/**
 * Dekodiert die Datei und dreht sie dabei so, wie die Kamera sie gemeint hat.
 *
 * `imageOrientation: "from-image"` ist entscheidend: iPhones speichern hochkant
 * aufgenommene Bilder quer und legen die Drehung nur in die EXIF-Daten. Beim
 * Zeichnen auf eine Leinwand geht die Angabe verloren — ohne diese Zeile läge
 * jedes Hochkantfoto nachher auf der Seite.
 */
async function dekodiere(datei: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(datei, { imageOrientation: "from-image" });
  } catch {
    throw new BildFehler(
      `${datei.name} lässt sich nicht lesen. Bitte als JPEG, PNG oder WebP speichern.`,
    );
  }
}

function neuCodieren(leinwand: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((fertig) => {
    leinwand.toBlob(
      (blob) => {
        // Kennt der Browser WebP nicht, liefert toBlob stillschweigend PNG.
        // Dann lieber JPEG: PNG wäre bei einem Foto grösser als das Original.
        if (blob && blob.type === FORMAT) return fertig(blob);
        leinwand.toBlob((zweiter) => fertig(zweiter), "image/jpeg", QUALITAET);
      },
      FORMAT,
      QUALITAET,
    );
  });
}
