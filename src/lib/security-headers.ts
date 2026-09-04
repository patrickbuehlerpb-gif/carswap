/**
 * Content-Security-Policy mit Nonce.
 *
 * Vorher stand hier `script-src 'unsafe-inline'`, weil Next.js die Anwendung
 * über ein Inline-Skript startet. Damit war die Richtlinie als XSS-Schutz
 * praktisch wertlos: eingeschleuster Code hätte genauso laufen dürfen.
 *
 * Jetzt bekommt jede Antwort eine frische Nonce. Next.js liest sie aus der
 * CSP der ANFRAGE und hängt sie an seine eigenen Skript-Tags — deshalb setzt
 * die Middleware den Header auf beiden Seiten. `strict-dynamic` erlaubt den
 * so freigegebenen Skripten, weitere zu laden (die Chunks des Routers), ohne
 * dass jede einzelne Adresse in der Liste stehen muss.
 *
 * `style-src` behält 'unsafe-inline': React setzt style-Attribute und Next
 * legt kritisches CSS inline ab. Für Stile ist das Risiko deutlich kleiner,
 * und eine Nonce für Stile würde beides brechen.
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com`,
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
}
