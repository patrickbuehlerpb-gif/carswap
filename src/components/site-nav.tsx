"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOutAction } from "@/app/actions/auth";

interface NavItem {
  href: string;
  label: string;
  badge?: boolean;
}

const PUBLIC_NAV: NavItem[] = [
  { href: "/markt", label: "Marktplatz" },
  { href: "/wert", label: "Wertrechner" },
];

const PRIVATE_NAV: NavItem[] = [
  { href: "/matches", label: "Matches" },
  { href: "/garage", label: "Garage" },
  { href: "/deals", label: "Tausche", badge: true },
];

export function NavLinks({
  signedIn,
  openDeals,
  mobile,
}: {
  signedIn: boolean;
  openDeals: number;
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const items = signedIn ? [...PUBLIC_NAV, ...PRIVATE_NAV] : PUBLIC_NAV;

  return (
    <nav
      className={
        mobile
          ? "flex items-center gap-1 overflow-x-auto border-t border-line px-5 py-2 md:hidden"
          : "hidden items-center gap-1 md:flex"
      }
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors ${
              active ? "bg-surface-3 text-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {item.label}
            {item.badge && openDeals > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-marke px-1 text-[10px] font-semibold text-onmarke tabular">
                {openDeals}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function UserMenu({
  name,
  avatarColor,
  isAdmin = false,
}: {
  name: string;
  avatarColor: string;
  isAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  /*
   * Ein Overlay als Klickfänger funktioniert hier nicht: die Kopfzeile setzt
   * backdrop-filter und wird damit zum Bezugsrahmen für position:fixed — das
   * Overlay deckt dann nur die Kopfzeile ab statt der Seite. Deshalb direkt
   * am Dokument lauschen.
   */
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-2"
      >
        <span
          className="grid h-8 w-8 place-items-center rounded-full text-xs font-semibold text-onmarke"
          style={{ background: avatarColor }}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden text-sm text-ink-2 lg:block">{name}</span>
      </button>

      {open && (
        <>
          <div
            role="menu"
            className="absolute right-0 z-20 mt-2 w-52 rounded-lg border border-line bg-surface p-1 shadow-lg"
          >
            <MenuLink href="/garage" onClick={() => setOpen(false)}>
              Meine Garage
            </MenuLink>
            <MenuLink href="/inserat/neu" onClick={() => setOpen(false)}>
              Fahrzeug anbieten
            </MenuLink>
            <MenuLink href="/deals" onClick={() => setOpen(false)}>
              Meine Tausche
            </MenuLink>
            <MenuLink href="/konto" onClick={() => setOpen(false)}>
              Konto und Auszahlung
            </MenuLink>
            {isAdmin && (
              <MenuLink href="/admin/meldungen" onClick={() => setOpen(false)}>
                Gemeldete Inserate
              </MenuLink>
            )}
            <form action={signOutAction} className="border-t border-line pt-1">
              <button
                type="submit"
                className="w-full rounded-md px-3 py-2 text-left text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
              >
                Abmelden
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

function MenuLink({
  href,
  children,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      role="menuitem"
      className="block rounded-md px-3 py-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </Link>
  );
}
