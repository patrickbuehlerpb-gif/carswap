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
          <span className="text-marke">
            <Signet />
          </span>
          <span className="display text-[19px] leading-none text-ink">CarSwap</span>
        </Link>

        <NavLinks signedIn={Boolean(user)} openDeals={openDeals} />

        <div className="ml-auto flex items-center gap-3">
          {user ? (
            <>
              <Link
                href="/inserat/neu"
                className="hidden rounded-md bg-marke px-3 py-1.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi sm:block"
              >
                Fahrzeug anbieten
              </Link>
              <UserMenu name={user.name} avatarColor={user.avatarColor} isAdmin={user.isAdmin} />
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
                className="rounded-md bg-marke px-3 py-1.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
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

/**
 * Die Gleichung: zwei Zeilen, gleich breit. Oben ein Fahrzeug, unten das
 * andere — kürzer — plus der bernsteinfarbene Block, die Zuzahlung. Zusammen
 * ergeben sie dieselbe Länge; das Zeichen ist die Aussage des Produkts.
 *
 * Der Block trägt die Geldfarbe fest, nicht currentColor: er bedeutet etwas
 * anderes als die beiden Balken und soll sich auch dann absetzen, wenn das
 * Signet in einer anderen Farbe steht.
 */
function Signet() {
  return (
    <svg viewBox="0 0 32 32" className="h-[26px] w-[26px]" aria-hidden="true">
      <rect x="5" y="9.9" width="22" height="4.6" rx="1.4" fill="currentColor" />
      <rect x="5" y="17.3" width="14.4" height="4.6" rx="1.4" fill="currentColor" />
      <rect x="21.4" y="17.3" width="5.6" height="4.6" rx="1.4" fill="#b0730f" />
    </svg>
  );
}
