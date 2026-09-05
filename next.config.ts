import type { NextConfig } from "next";

/**
 * Die Content-Security-Policy setzt die Middleware, weil sie eine frische
 * Nonce je Antwort braucht — siehe src/lib/security-headers.ts. Hier stehen
 * nur die Header, die für jede Antwort gleich sind.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["postgres"],
  images: {
    /*
     * Fotos liegen im Blob-Speicher. Ohne diesen Eintrag lehnt next/image sie
     * ab — mit ihm liefert es je Bildschirmbreite eine passende Grösse in
     * AVIF oder WebP aus, statt jedem Telefon das Original zu schicken.
     */
    remotePatterns: [{ protocol: "https", hostname: "**.public.blob.vercel-storage.com" }],
    // Die Breiten, die auf dieser Seite wirklich vorkommen: Kartenraster,
    // Galeriebild, Vorschaubilder. Jede zusätzliche Breite ist eine weitere
    // Fassung, die erzeugt und bezahlt werden will.
    imageSizes: [96, 144, 256, 384],
    deviceSizes: [390, 640, 828, 1080, 1440],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
