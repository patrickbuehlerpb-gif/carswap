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
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-5 py-3 sm:px-8 md:gap-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          <span className="text-marke">
            <Signet />
          </span>
          <Wortmarke className="text-[18px] text-ink sm:text-[21px]" />
        </Link>

        <NavLinks signedIn={Boolean(user)} openDeals={openDeals} />

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {user ? (
            <>
              <Link
                href="/inserat/neu"
                className="hidden whitespace-nowrap rounded-md bg-marke px-3 py-1.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi sm:block"
              >
                Auto anbieten
              </Link>
              <UserMenu name={user.name} avatarColor={user.avatarColor} isAdmin={user.isAdmin} />
            </>
          ) : (
            <>
              {/*
               * Auf dem Telefon steht «Anmelden» in der zweiten Zeile: neben
               * dem zwölf Buchstaben langen Namen ist oben nur für eine
               * Handlung Platz, und das ist die für neue Leute.
               */}
              <Link
                href="/konto/anmelden"
                className="hidden whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-ink-2 transition-colors hover:text-ink md:block"
              >
                Anmelden
              </Link>
              <Link
                href="/konto/registrieren"
                className="whitespace-nowrap rounded-md bg-marke px-3 py-1.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
              >
                Konto erstellen
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="flex items-stretch border-t border-line md:hidden">
        <NavLinks signedIn={Boolean(user)} openDeals={openDeals} mobile />
        {!user && (
          <Link
            href="/konto/anmelden"
            className="flex shrink-0 items-center border-l border-line px-5 py-2 text-sm text-ink-2 transition-colors hover:text-ink"
          >
            Anmelden
          </Link>
        )}
      </div>
    </header>
  );
}

/**
 * Wortmarke.
 *
 * Der Name besteht aus zwei Teilen, und die Naht dazwischen ist die ganze
 * Gestaltung: «auto» sagt, worum es geht, «tauschen» sagt, was man tut. Das
 * Zweite trägt die Betonung, denn tauschen kann man Autos anderswo nicht.
 *
 * Zwölf Buchstaben sind für eine Wortmarke viel. Der Tonwertunterschied
 * gliedert sie in zwei lesbare Hälften, ohne dass eine zweite Farbe nötig
 * wäre — daneben steht schon das grüne Signet, und zwei Grüntöne
 * nebeneinander würden unruhig.
 */
export function Wortmarke({ className = "" }: { className?: string }) {
  return (
    <span className={`display leading-none ${className}`}>
      <span className="text-ink-3">auto</span>tauschen
    </span>
  );
}

/**
 * Die Gleichung: zwei Zeilen, gleich breit. Oben ein Auto, unten das
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
