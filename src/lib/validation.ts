import { z } from "zod";
import { isKnownFeature, normalizeFeatures } from "./data/features";

export const FUELS = ["elektro", "hybrid", "benzin", "diesel"] as const;
export const BODIES = ["suv", "limousine", "kombi", "kompakt", "coupe", "van"] as const;
export const DRIVETRAINS = ["heck", "front", "allrad"] as const;
export const CONDITIONS = ["neuwertig", "sehr gut", "gut", "gebraucht"] as const;
export const SERVICE_HISTORIES = ["lückenlos scheckheft", "teilweise", "keine"] as const;

/** Erstzulassung als Monat, nicht in der Zukunft und nicht vor 1980. */
const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Bitte einen gültigen Monat wählen.")
  .refine((m) => m >= "1980-01", "Das Baujahr liegt zu weit zurück.")
  .refine((m) => m <= new Date().toISOString().slice(0, 7), "Die Erstzulassung liegt in der Zukunft.");

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte ein gültiges Datum angeben.")
  .optional()
  .or(z.literal(""));

/** Erlaubt ausschliesslich https-Adressen aus dem Vercel-Blob-Speicher. */
/**
 * Der eigene Blob-Speicher. Der Hostname steckt in der Store-ID des Tokens;
 * er lässt sich mit BLOB_PUBLIC_HOST auch direkt setzen. Im Browser ist keine
 * der beiden Variablen sichtbar — dort bleibt die Prüfung grob, verbindlich
 * ist ohnehin die serverseitige beim Speichern.
 */
function eigenerBlobHost(): string | null {
  const explicit = process.env.BLOB_PUBLIC_HOST?.trim();
  if (explicit) return explicit.toLowerCase();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const store = token?.match(/^vercel_blob_rw_([A-Za-z0-9]+)_/)?.[1];
  return store ? `${store.toLowerCase()}.public.blob.vercel-storage.com` : null;
}

export function isBlobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();

    // Fremde Vercel-Blob-Speicher gehören nicht dazu: über ein Inserat liesse
    // sich sonst auf beliebige andere Konten verweisen.
    const eigener = eigenerBlobHost();
    if (eigener) return host === eigener;

    return (
      host.endsWith(".public.blob.vercel-storage.com") ||
      host === "public.blob.vercel-storage.com"
    );
  } catch {
    return false;
  }
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
    .max(10)
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
