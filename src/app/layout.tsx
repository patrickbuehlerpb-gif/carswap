import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { StoreProvider } from "@/lib/store";
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
      <body className="min-h-screen bg-ink-950 font-sans antialiased">
        <StoreProvider>
          <SiteHeader />
          <main className="mx-auto w-full max-w-7xl px-5 pb-24 pt-8 sm:px-8">{children}</main>
          <footer className="border-t border-ink-800 bg-ink-900/60">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-5 py-8 text-xs text-mist-400 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <p>
                CarSwap — Prototyp mit Demo-Daten. Bewertungen sind Modellrechnungen, keine
                verbindlichen Angebote.
              </p>
              <p className="tabular">Stichtag der Bewertungen: 01.09.2026</p>
            </div>
          </footer>
        </StoreProvider>
      </body>
    </html>
  );
}
