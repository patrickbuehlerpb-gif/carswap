import "server-only";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "./db";
import { listings, matchNotices, users, vehicles } from "./db/schema";
import { toListing, toUser, toVehicle } from "./queries";
import { findMatches } from "./matching";
import { chf, vehicleTitle } from "./format";
import { sendMail, siteUrl } from "./mail";
import type { ListingEntry } from "./matching";
import type { Match, SwapWish, Vehicle } from "./types";

/**
 * Meldet neue Treffer per Mail.
 *
 * Bis hierher lief das Matching ausschliesslich, solange jemand die
 * Treffer-Seite offen hatte. Wer sein Auto einstellte, erfuhr also nie, dass
 * inzwischen jemand aufgetaucht ist, der genau dieses Auto sucht — und ein
 * Autotausch ist nichts, wofür man täglich eine Seite aufruft. Ohne diesen
 * Lauf bleibt der Marktplatz still, egal wie gut er rechnet.
 */

/** Höchstens so viele Treffer je Mail. Der Rest kommt beim nächsten Lauf. */
const PRO_MAIL = 3;

export interface TrefferLauf {
  /** Wie viele Personen eine Mail bekommen haben. */
  benachrichtigt: number;
  /** Wie viele einzelne Treffer darin standen. */
  gemeldet: number;
  fehler: number;
}

interface Kandidat {
  id: string;
  name: string;
  email: string;
}

/**
 * Hat diese Person überhaupt gesagt, was sie sucht?
 *
 * Ein leerer Wunsch besteht jede Prüfung — er stellt ja keine. Die Passung
 * gilt dann formal als beidseitig, obwohl die Gegenseite nie etwas gesucht
 * hat. Eine Mail «jemand sucht ausdrücklich ein Auto wie deines» wäre in dem
 * Fall schlicht falsch.
 *
 * Der Höchstbetrag zählt bewusst nicht mit: er sagt, was jemand ausgeben
 * will, nicht welches Auto er will.
 */
function wunschIstEcht(wish: SwapWish): boolean {
  return Boolean(
    wish.makes.length ||
      wish.bodies.length ||
      wish.fuels.length ||
      wish.minYear !== undefined ||
      wish.maxMileageKm !== undefined,
  );
}

/**
 * Nur beidseitige Treffer mit einem echten Wunsch dahinter sind eine Mail
 * wert. Alles andere ist eine Anregung — und Anregungen per Mail sind
 * Werbung, auch wenn sie gut gemeint ist.
 */
function meldenswert(m: Match): boolean {
  return m.mutual && wunschIstEcht(m.listing.wish);
}

export async function verschickeTreffermeldungen(): Promise<TrefferLauf> {
  const bestand = await ladeBestand();
  if (bestand.length === 0) return { benachrichtigt: 0, gemeldet: 0, fehler: 0 };

  const kandidaten = await ladeKandidaten(bestand.map((e) => e.listing.ownerId));
  let benachrichtigt = 0;
  let gemeldet = 0;
  let fehler = 0;

  for (const person of kandidaten) {
    try {
      const anzahl = await meldeFuer(person, bestand);
      if (anzahl > 0) {
        benachrichtigt++;
        gemeldet += anzahl;
      }
    } catch (err) {
      // Ein Fehler bei einer Person darf den Lauf nicht beenden — sonst
      // bekämen alle dahinter nie eine Meldung.
      fehler++;
      console.error(`[treffer] Meldung an ${person.id} fehlgeschlagen:`, err);
    }
  }

  return { benachrichtigt, gemeldet, fehler };
}

/** Alle aktiven Inserate — derselbe Bestand, den die Treffer-Seite benutzt. */
async function ladeBestand(): Promise<ListingEntry[]> {
  const rows = await db
    .select({ listing: listings, vehicle: vehicles, owner: users })
    .from(listings)
    .innerJoin(vehicles, eq(vehicles.id, listings.vehicleId))
    .innerJoin(users, eq(users.id, listings.ownerId))
    .where(eq(listings.status, "aktiv"));

  return rows.map((r) => ({
    listing: toListing(r.listing),
    vehicle: toVehicle(r.vehicle),
    owner: toUser(r.owner),
  }));
}

/**
 * Wer überhaupt eine Meldung bekommen darf: eigenes Inserat im Bestand,
 * bestätigte Adresse, Schalter an, nicht stillgelegt, nicht gelöscht.
 *
 * Die bestätigte Adresse ist kein Selbstzweck — an eine unbestätigte zu
 * schreiben hiesse, jemandem Post zu schicken, der nie zugestimmt hat, dass
 * ihm diese Adresse gehört.
 */
async function ladeKandidaten(ownerIds: string[]): Promise<Kandidat[]> {
  const eindeutig = [...new Set(ownerIds)];
  if (!eindeutig.length) return [];
  return await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      and(
        inArray(users.id, eindeutig),
        eq(users.notifyMatches, true),
        isNull(users.deletedAt),
        isNull(users.suspendedAt),
        isNotNull(users.emailVerifiedAt),
      ),
    );
}

async function meldeFuer(person: Kandidat, bestand: ListingEntry[]): Promise<number> {
  const meine = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.ownerId, person.id), isNull(vehicles.archivedAt)));
  if (!meine.length) return 0;

  const bereitsGemeldet = new Set(
    (
      await db
        .select({ listingId: matchNotices.listingId })
        .from(matchNotices)
        .where(eq(matchNotices.userId, person.id))
    ).map((r) => r.listingId),
  );

  // Je Inserat den besten Treffer behalten. Dasselbe Inserat kann zu zwei
  // eigenen Autos passen — gemeldet wird es trotzdem nur einmal.
  const beste = new Map<string, { match: Match; meinAuto: Vehicle }>();
  for (const row of meine) {
    const meinAuto = toVehicle(row);
    for (const m of findMatches(meinAuto, bestand)) {
      if (!meldenswert(m)) continue;
      if (bereitsGemeldet.has(m.listing.id)) continue;
      const alt = beste.get(m.listing.id);
      if (!alt || m.score > alt.match.score) beste.set(m.listing.id, { match: m, meinAuto });
    }
  }

  const auswahl = [...beste.values()]
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, PRO_MAIL);
  if (!auswahl.length) return 0;

  // Erst vermerken, dann schreiben. Andersherum stünde bei einem Absturz
  // zwischen beiden Schritten eine Mail ohne Vermerk — und dieselbe Meldung
  // käme morgen erneut.
  await db
    .insert(matchNotices)
    .values(auswahl.map((a) => ({ userId: person.id, listingId: a.match.listing.id })))
    .onConflictDoNothing();

  await sendMail({
    to: person.email,
    subject:
      auswahl.length === 1
        ? "autotauschen: jemand sucht dein Auto"
        : `autotauschen: ${auswahl.length} passende Tausche für dich`,
    text: text(person, auswahl),
  });
  return auswahl.length;
}

function text(person: Kandidat, auswahl: { match: Match; meinAuto: Vehicle }[]): string {
  const zeilen = auswahl.map(({ match, meinAuto }) => {
    const betrag =
      match.cashDelta === 0
        ? "ohne Ausgleich"
        : match.cashDelta > 0
          ? `du zahlst ${chf(match.cashDelta)} dazu`
          : `du bekommst ${chf(-match.cashDelta)}`;
    return (
      `• ${vehicleTitle(match.vehicle)} von ${match.owner.name}\n` +
      `  gegen deinen ${vehicleTitle(meinAuto)} — ${betrag}\n` +
      `  ${siteUrl()}/auto/${match.vehicle.id}\n`
    );
  });

  return (
    `Hallo ${person.name}\n\n` +
    (auswahl.length === 1
      ? "Jemand sucht ausdrücklich ein Auto wie deines:\n\n"
      : "Diese Leute suchen ausdrücklich ein Auto wie deines:\n\n") +
    `${zeilen.join("\n")}\n` +
    `Alle Treffer: ${siteUrl()}/matches\n\n` +
    `Keine solchen Mails mehr? Im Konto abschalten: ${siteUrl()}/konto\n`
  );
}
