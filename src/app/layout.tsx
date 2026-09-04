import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "CarSwap — Autos tauschen statt verkaufen",
    template: "%s · CarSwap",
  },
  description:
    "Die Tauschbörse für Privatpersonen: Fahrzeug gegen Fahrzeug, Wertdifferenz transparent ausgeglichen. Inklusive Wertverlauf, Matching und Treuhand.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de-CH" className={inter.variable}>
      <body className="flex min-h-screen flex-col bg-canvas font-sans antialiased">
        <a
          href="#inhalt"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-volt focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
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
              CarSwap — Fahrzeugtausch zwischen Privatpersonen. Bewertungen sind
              Modellrechnungen und keine verbindlichen Angebote.
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
