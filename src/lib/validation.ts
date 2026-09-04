import { z } from "zod";

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
export function isBlobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname.endsWith(".public.blob.vercel-storage.com") ||
        url.hostname === "public.blob.vercel-storage.com")
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
  features: z.array(z.string().trim().max(60)).max(40).default([]),
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
