import { z } from "zod";
import { isKnownFeature, normalizeFeatures } from "./data/features";

export const FUELS = ["elektro", "hybrid", "benzin", "diesel"] as const;
export const BODIES = ["suv", "limousine", "kombi", "kompakt", "coupe", "van"] as const;
export const DRIVETRAINS = ["heck", "front", "allrad"] as const;
export const CONDITIONS = ["neuwertig", "sehr gut", "gut", "gebraucht"] as const;
export const SERVICE_HISTORIES = ["lückenlos scheckheft", "teilweise", "keine"] as const;

/**
 * E-Mail-Adressen. Steht hier statt bei den Anmeldeaktionen, weil sowohl die
 * Registrierung als auch der spätere Adresswechsel dieselbe Prüfung brauchen —
 * und «use server»-Dateien nichts ausser Funktionen exportieren dürfen.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Bitte eine gültige E-Mail-Adresse angeben.")
  .max(254)
  .email("Bitte eine gültige E-Mail-Adresse angeben.");

/** Erstzulassung als Monat, nicht in der Zukunft und nicht vor 1980. */
const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Bitte einen gültigen Monat wählen.")
  .refine((m) => m >= "1980-01", "Das Baujahr liegt zu weit zurück.")
  .refine((m) => m <= new Date().toISOString().slice(0, 7), "Die Erstzulassung liegt in der Zukunft.");

/**
 * Die Form allein reicht nicht: «2026-02-31» passt auf das Muster, ist aber
 * kein Tag. Ohne diese Prüfung landete er in der Datenbank und die Anzeige
 * machte daraus «NaN. undefined NaN».
 */
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte ein gültiges Datum angeben.")
  .refine((d) => {
    const parsed = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d;
  }, "Dieses Datum gibt es nicht.")
  .refine((d) => d >= "1980-01-01" && d <= "2100-12-31", "Das Datum liegt ausserhalb des Bereichs.")
  .optional()
  .or(z.literal(""));

/**
 * Der eigene Blob-Speicher. Der Hostname steckt in der Store-ID des Tokens;
 * er lässt sich mit BLOB_PUBLIC_HOST auch direkt setzen. Im Browser ist keine
 * der beiden Variablen sichtbar — dort bleibt die Prüfung grob, verbindlich
 * ist ohnehin die serverseitige beim Speichern.
 *
 * Wird ausgegeben, damit die Betriebsprüfung ihn zeigen kann: Stimmt der
 * abgeleitete Hostname nicht mit dem überein, den der Speicher wirklich
 * benutzt, wird jedes Foto beim Speichern abgewiesen — und seit ein Inserat
 * drei Fotos braucht, entstünde dann überhaupt kein Inserat mehr. Der Fehler
 * soll ablesbar sein, bevor jemand darüber stolpert.
 */
export function erlaubterFotoHost(): string | null {
  const explicit = process.env.BLOB_PUBLIC_HOST?.trim();
  if (explicit) return explicit.toLowerCase();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const store = token?.match(/^vercel_blob_rw_([A-Za-z0-9]+)_/)?.[1];
  return store ? `${store.toLowerCase()}.public.blob.vercel-storage.com` : null;
}

/** Erlaubt ausschliesslich https-Adressen aus dem eigenen Vercel-Blob-Speicher. */
export function isBlobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();

    // Fremde Vercel-Blob-Speicher gehören nicht dazu: über ein Inserat liesse
    // sich sonst auf beliebige andere Konten verweisen.
    const eigener = erlaubterFotoHost();
    if (eigener) {
      if (host === eigener) return true;
      /*
       * Knapp daneben: die Adresse kommt aus dem richtigen Dienst, nur aus
       * einem anderen Speicher. Das ist im Betrieb fast immer eine falsch
       * abgeleitete Kennung und nicht der Versuch, ein fremdes Bild
       * einzuhängen — der Person auf der Seite ist damit aber nicht zu helfen,
       * die liest nur «lade es über diese Seite hoch». Deshalb steht der
       * Grund im Protokoll, mit dem Namen der Variablen, die ihn behebt.
       */
      if (host.endsWith(".public.blob.vercel-storage.com")) {
        console.error(
          `[fotos] Adresse aus fremdem Speicher abgewiesen: ${host} statt ${eigener}. ` +
            "Stimmt der erwartete Hostname nicht, lässt er sich mit BLOB_PUBLIC_HOST setzen.",
        );
      }
      return false;
    }

    return (
      host.endsWith(".public.blob.vercel-storage.com") ||
      host === "public.blob.vercel-storage.com"
    );
  } catch {
    return false;
  }
}

/**
 * Wie viele Fotos ein Inserat mindestens braucht.
 *
 * Ein Auto ohne Bild ist kein Angebot, sondern eine Behauptung: Der Gegenwert
 * eines Tauschs sind mehrere zehntausend Franken, und wer nur eine
 * Frontansicht zeigt, verbirgt drei Seiten. Drei Bilder sind die Grenze, ab
 * der man ein Auto einschätzen kann — aussen, innen, und was sonst noch
 * dazugehört.
 *
 * Die Zahl steht hier, nicht im Formular und nicht in der Aktion: Text,
 * Prüfung und Fehlermeldung müssen dieselbe nennen.
 */
export const MIN_FOTOS = 3;
export const MAX_FOTOS = 10;

/**
 * Fehlt noch etwas an den Fotos? Gibt den Satz zurück, der weiterhilft, sonst
 * null. Formular und Aktion rufen dieselbe Funktion — die Person soll beim
 * Absenden nicht etwas anderes lesen als vorher am Feld.
 *
 * `pflicht` beantwortet «kann hier überhaupt jemand ein Foto hochladen?». Auf
 * einer Installation ohne Fotospeicher (kein `BLOB_READ_WRITE_TOKEN`) ist der
 * Knopf tot; die Pflicht hiesse dort, dass gar kein Inserat mehr entsteht.
 * Für den Betrieb ist der Speicher ohnehin Voraussetzung, in der Entwicklung
 * und im Testlauf nicht.
 */
export function fotoHinweis(anzahl: number, pflicht: boolean): string | null {
  if (!pflicht || anzahl >= MIN_FOTOS) return null;
  if (anzahl === 0) {
    return `Bitte lade mindestens ${MIN_FOTOS} Fotos hoch — ohne Bilder lässt sich ein Auto nicht einschätzen.`;
  }
  const fehlen = MIN_FOTOS - anzahl;
  return fehlen === 1
    ? `Noch ein Foto: ein Inserat braucht mindestens ${MIN_FOTOS}.`
    : `Noch ${fehlen} Fotos: ein Inserat braucht mindestens ${MIN_FOTOS}.`;
}

export const vehicleSchema = z.object({
  make: z.string().trim().min(1, "Bitte die Marke angeben.").max(40),
  model: z.string().trim().min(1, "Bitte das Modell angeben.").max(60),
  trim: z.string().trim().max(80).default(""),
  firstRegistration: monthSchema,
  mileageKm: z.coerce.number().int().min(0).max(1_500_000),
  fuel: z.enum(FUELS),
  body: z.enum(BODIES),
  drivetrain: z.enum(DRIVETRAINS),
  powerPs: z.coerce.number().int().min(1).max(2_000),
  listPriceNew: z.coerce
    .number()
    .int()
    .min(3_000, "Der Neupreis wirkt zu niedrig.")
    .max(2_000_000),
  condition: z.enum(CONDITIONS),
  color: z.string().trim().max(40).default(""),
  rangeKm: z.coerce.number().int().min(0).max(2_000).optional(),
  batterySoh: z.coerce.number().int().min(30).max(100).optional(),
  // Nur bekannte Merkmale: ein frei eingetippter Text hätte sonst einen
  // Einfluss auf die Bewertung, den niemand nachvollziehen kann.
  features: z
    .array(z.string().trim().max(60))
    .max(40)
    .default([])
    .transform((list) => normalizeFeatures(list).filter(isKnownFeature)),
  notes: z.string().trim().max(2_000).optional(),
  defects: z.array(z.string().trim().max(200)).max(20).default([]),
  serviceHistory: z.enum(SERVICE_HISTORIES),
  previousOwners: z.coerce.number().int().min(1).max(20),
  accidentFree: z.boolean(),
  mfkUntil: dateSchema,
  photos: z
    .array(
      z.object({
        // Nur Adressen aus dem eigenen Blob-Speicher. Sonst liesse sich über
        // ein Inserat auf beliebige fremde Server verweisen.
        url: z
          .string()
          .max(500)
          .refine(isBlobUrl, "Fotos müssen über den Upload dieser Seite hochgeladen werden."),
        width: z.coerce.number().int().min(1).max(20_000),
        height: z.coerce.number().int().min(1).max(20_000),
      }),
    )
    .max(MAX_FOTOS)
    .default([]),
});

export const wishSchema = z.object({
  wishMakes: z.array(z.string().trim().max(40)).max(20).default([]),
  wishBodies: z.array(z.enum(BODIES)).max(6).default([]),
  wishFuels: z.array(z.enum(FUELS)).max(4).default([]),
  wishMinYear: z.coerce.number().int().min(1980).max(2100).optional(),
  wishMaxMileageKm: z.coerce.number().int().min(0).max(1_500_000).optional(),
  wishMaxCashOut: z.coerce.number().int().min(-2_000_000).max(2_000_000).optional(),
  wishNotes: z.string().trim().max(1_000).optional(),
  askPremium: z.coerce.number().int().min(0).max(200_000).default(0),
});

export const listingSchema = vehicleSchema.merge(wishSchema);
export type ListingInput = z.infer<typeof listingSchema>;
