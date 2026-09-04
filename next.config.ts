import type { NextConfig } from "next";

/**
 * Sicherheits-Header. `frame-ancestors`, `form-action`, `base-uri` und
 * `object-src` bringen den grössten Nutzen und brechen nichts.
 *
 * `script-src` enthält bewusst 'unsafe-inline': Next.js bootet die Anwendung
 * über ein Inline-Skript. Eine nonce-basierte Richtlinie braucht Proxy-Support
 * und ist als Folgeschritt vermerkt.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
  "connect-src 'self' https://api.stripe.com https://*.public.blob.vercel-storage.com https://blob.vercel-storage.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "form-action 'self' https://checkout.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["postgres"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
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
