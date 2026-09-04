import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "carswap_session";
const MAX_AGE = 30 * 24 * 60 * 60;

/**
 * Verlängert das Sitzungs-Cookie bei jedem Seitenaufruf.
 *
 * Die Serverkomponenten verlängern zwar die Zeile in der Datenbank, können
 * aber keine Cookies schreiben — `cookies().set()` ist dort nicht erlaubt.
 * Ohne diese Stelle lief das Cookie exakt 30 Tage nach der Anmeldung ab,
 * egal wie aktiv jemand war; die versprochene gleitende Verlängerung gab es
 * also gar nicht. Über die Gültigkeit entscheidet weiterhin die Datenbank —
 * hier wird nur die Frist des Cookies nachgezogen.
 */
export function middleware(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  const response = NextResponse.next();
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
