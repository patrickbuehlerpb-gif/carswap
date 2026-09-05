import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

/**
 * Archivo ist eine variable Schrift mit Breitenachse: Überschriften laufen
 * breit (siehe .display in globals.css), die Oberfläche normal. Beides kommt
 * aus derselben Datei, es wird also keine zweite Schrift geladen.
 */
const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-archivo",
  axes: ["wdth"],
});

/** Nur für Beträge und Messwerte — gleich breite Ziffern. */
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: {
    default: "quitt — Autos tauschen statt verkaufen",
    template: "%s · quitt",
  },
  description:
    "Tausche dein Auto direkt gegen ein anderes. Wir rechnen aus, was es wert ist, und halten die Differenz, bis beide die Übergabe bestätigt haben.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de-CH" className={`${archivo.variable} ${plexMono.variable}`}>
      <body className="flex min-h-screen flex-col bg-canvas font-sans antialiased">
        <a
          href="#inhalt"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-marke focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-onmarke"
        >
          Zum Inhalt springen
        </a>
        <SiteHeader />
        <main id="inhalt" className="mx-auto w-full max-w-7xl flex-1 px-5 pb-24 pt-8 sm:px-8">
          {children}
        </main>
        <footer className="mt-auto border-t border-line bg-surface">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-5 py-8 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <p>
              quitt — Autotausch zwischen Privatpersonen. Alle Werte auf dieser Seite sind
              gerechnet, nicht geboten.
            </p>
            <nav className="flex flex-wrap gap-x-5 gap-y-2">
              <a href="/impressum" className="hover:text-ink">Impressum</a>
              <a href="/datenschutz" className="hover:text-ink">Datenschutz</a>
              <a href="/agb" className="hover:text-ink">AGB</a>
              <a href="/so-funktionierts" className="hover:text-ink">So funktioniert es</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
