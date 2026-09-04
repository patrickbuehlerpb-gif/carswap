import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/mail";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/markt", "/fahrzeug/", "/wert", "/so-funktionierts"],
      // Persönliche Bereiche gehören nicht in den Index
      disallow: ["/konto", "/garage", "/deals", "/matches", "/inserat", "/tausch", "/api/"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
