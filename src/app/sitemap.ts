import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/mail";
import { getActiveListings } from "@/lib/queries";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const statisch: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/markt`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/wert`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/so-funktionierts`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/agb`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/datenschutz`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/impressum`, changeFrequency: "yearly", priority: 0.2 },
  ];

  try {
    const listings = await getActiveListings();
    return [
      ...statisch,
      ...listings.map((l) => ({
        url: `${base}/auto/${l.vehicle.id}`,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ];
  } catch {
    // Ohne Datenbank liefern wir wenigstens die statischen Seiten aus
    return statisch;
  }
}
