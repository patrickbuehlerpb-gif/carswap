"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { currentUser } from "@/lib/data/users";
import { useStore } from "@/lib/store";

const NAV = [
  { href: "/markt", label: "Marktplatz" },
  { href: "/matches", label: "Matches" },
  { href: "/wert", label: "Wertrechner" },
  { href: "/garage", label: "Garage" },
  { href: "/deals", label: "Tausche" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { deals } = useStore();
  const open = deals.filter((d) => ["vorschlag", "verhandlung", "angenommen", "treuhand"].includes(d.status));

  return (
    <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-5 py-3 sm:px-8">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="relative grid h-8 w-8 place-items-center rounded-lg bg-volt-500 text-ink-950">
            <SwapGlyph />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-mist-100">
            Car<span className="text-volt-400">Swap</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-ink-800 text-mist-100"
                    : "text-mist-400 hover:bg-ink-850 hover:text-mist-200"
                }`}
              >
                {item.label}
                {item.href === "/deals" && open.length > 0 && (
                  <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-volt-500 px-1 text-[10px] font-semibold text-ink-950 tabular">
                    {open.length}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/markt"
            className="hidden rounded-md border border-ink-600 px-3 py-1.5 text-sm text-mist-200 transition-colors hover:border-ink-500 hover:text-mist-100 sm:block"
          >
            Fahrzeug anbieten
          </Link>
          <div className="flex items-center gap-2">
            <span
              className="grid h-8 w-8 place-items-center rounded-full text-xs font-semibold text-ink-950"
              style={{ background: currentUser.avatarColor }}
            >
              {currentUser.name.slice(0, 1)}
            </span>
            <span className="hidden text-sm text-mist-300 lg:block">{currentUser.name}</span>
          </div>
        </div>
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto border-t border-ink-800 px-5 py-2 md:hidden">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${
                active ? "bg-ink-800 text-mist-100" : "text-mist-400"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

function SwapGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M4 8h13l-3-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 16H7l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
