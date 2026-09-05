import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/mail";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/markt", "/auto/", "/wert", "/so-funktionierts"],
      // Persönliche Bereiche gehören nicht in den Index
      disallow: [
        "/konto",
        "/garage",
        "/deals",
        "/ringe",
        "/matches",
        "/inserat",
        "/tausch",
        "/admin",
        "/api/",
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
