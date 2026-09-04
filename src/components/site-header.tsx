import Link from "next/link";
import { and, count, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { deals } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { NavLinks, UserMenu } from "./site-nav";

export async function SiteHeader() {
  const user = await getSessionUser();

  let openDeals = 0;
  if (user) {
    const rows = await db
      .select({ n: count() })
      .from(deals)
      .where(
        and(
          or(eq(deals.initiatorId, user.id), eq(deals.counterpartyId, user.id)),
          inArray(deals.status, ["vorschlag", "verhandlung", "angenommen", "treuhand"]),
        ),
      );
    openDeals = rows[0]?.n ?? 0;
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-5 py-3 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-volt text-ink">
            <SwapGlyph />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            Car<span className="text-volt-ink">Swap</span>
          </span>
        </Link>

        <NavLinks signedIn={Boolean(user)} openDeals={openDeals} />

        <div className="ml-auto flex items-center gap-3">
          {user ? (
            <>
              <Link
                href="/inserat/neu"
                className="hidden rounded-md bg-volt px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-volt-hi sm:block"
              >
                Fahrzeug anbieten
              </Link>
              <UserMenu name={user.name} avatarColor={user.avatarColor} />
            </>
          ) : (
            <>
              <Link
                href="/konto/anmelden"
                className="rounded-md px-3 py-1.5 text-sm text-ink-2 transition-colors hover:text-ink"
              >
                Anmelden
              </Link>
              <Link
                href="/konto/registrieren"
                className="rounded-md bg-volt px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-volt-hi"
              >
                Konto erstellen
              </Link>
            </>
          )}
        </div>
      </div>
      <NavLinks signedIn={Boolean(user)} openDeals={openDeals} mobile />
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
