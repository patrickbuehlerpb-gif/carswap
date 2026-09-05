import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "@/lib/security-headers";

const COOKIE = "quitt_session";
const MAX_AGE = 30 * 24 * 60 * 60;

/**
 * Setzt die Sicherheitsrichtlinie mit Nonce und verlängert das
 * Sitzungs-Cookie bei jedem Seitenaufruf.
 *
 * Die Serverkomponenten verlängern zwar die Zeile in der Datenbank, können
 * aber keine Cookies schreiben — `cookies().set()` ist dort nicht erlaubt.
 * Ohne diese Stelle lief das Cookie exakt 30 Tage nach der Anmeldung ab,
 * egal wie aktiv jemand war; die versprochene gleitende Verlängerung gab es
 * also gar nicht. Über die Gültigkeit entscheidet weiterhin die Datenbank —
 * hier wird nur die Frist des Cookies nachgezogen.
 */
export function middleware(request: NextRequest) {
  // Frische Nonce je Antwort. Next.js liest sie aus der CSP der Anfrage,
  // deshalb muss der Header auch dort stehen — nicht nur in der Antwort.
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);

  // Nur bei Seitenaufrufen. Eine Server Action kommt als POST und setzt das
  // Cookie unter Umständen selbst — beim Anmelden neu, beim Abmelden weg.
  // Schriebe die Middleware in dieselbe Antwort den alten Wert zurück,
  // stünden dort zwei widersprüchliche `Set-Cookie`, und welches am Ende
  // gilt, wäre Glückssache.
  if (request.method !== "GET") return response;

  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return response;

  response.cookies.set({
    name: COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return response;
}

export const config = {
  // Nur Seitenaufrufe. Statische Dateien und der Stripe-Webhook brauchen das
  // nicht und sollen nicht durch eine zusätzliche Schicht laufen.
  matcher: ["/((?!_next/static|_next/image|api/stripe|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)"],
};
