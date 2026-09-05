import "server-only";
import { and, desc, eq, isNotNull, isNull, sql as raw } from "drizzle-orm";
import { db } from "./db";
import {
  deals,
  listings,
  payments,
  reports,
  ringSwaps,
  users,
  type DealStatusDb,
  type RingStatusDb,
} from "./db/schema";
import { missingOperatorFields } from "./operator";
import { siteUrlConfigured } from "./mail";
import { stripeConfigured } from "./payments";

/**
 * Die Zahlen für die Betriebsübersicht.
 *
 * Sie stehen hier und nicht in der Seite, damit sie prüfbar sind: eine
 * Kennzahl, die falsch rechnet, ist schlimmer als keine — nach ihr wird
 * entschieden, ob etwas in Ordnung ist.
 *
 * Alles zählt die Datenbank, nichts wird in der Anwendung aufsummiert. Bei
 * Geld ist das kein Geschmack, sondern Notwendigkeit: hier stehen Rappen,
 * und die dürfen keinen Umweg über Gleitkomma nehmen.
 */

export interface Konten {
  gesamt: number;
  bestaetigt: number;
  mitAuszahlungskonto: number;
  neuDieseWoche: number;
  stillgelegt: number;
}

export interface Bestand {
  aktiv: number;
  pausiert: number;
  getauscht: number;
  gesperrt: number;
}

export interface Geld {
  /** Reserviert auf den Karten, noch nicht eingezogen. */
  reserviertMinor: number;
  /** Eingezogen und beim Empfänger. */
  ausgezahltMinor: number;
  /** Eingezogen, aber noch nicht weitergeleitet — liegt auf dem Plattformkonto. */
  liegengebliebenMinor: number;
  liegengebliebenAnzahl: number;
  /** Was quitt an abgeschlossenen Vorgängen verdient hat. */
  gebuehrenMinor: number;
  /** Offene Rückbuchungen — jede kostet die Betreiberin Geld, bis sie geklärt ist. */
  angefochtenAnzahl: number;
  angefochtenMinor: number;
}

export interface Betriebsbild {
  konten: Konten;
  inserate: Bestand;
  tausche: Record<DealStatusDb, number>;
  ringe: Record<RingStatusDb, number>;
  geld: Geld;
  offeneMeldungen: number;
  /** Was noch nicht eingerichtet ist — dieselben Punkte wie im Preflight. */
  nichtEingerichtet: string[];
}

const WOCHE_MS = 7 * 24 * 60 * 60 * 1000;

const DEAL_STATUS = [
  "vorschlag",
  "verhandlung",
  "angenommen",
  "treuhand",
  "abwicklung",
  "abgeschlossen",
  "abgelehnt",
  "storniert",
] as const satisfies readonly DealStatusDb[];

const RING_STATUS = [
  "vorschlag",
  "angenommen",
  "treuhand",
  "abwicklung",
  "abgeschlossen",
  "abgelehnt",
  "storniert",
] as const satisfies readonly RingStatusDb[];

export async function betriebsbild(): Promise<Betriebsbild> {
  const seit = new Date(Date.now() - WOCHE_MS);

  const [konten, inserate, tausche, ringe, geld, meldungen] = await Promise.all([
    zaehleKonten(seit),
    zaehleInserate(),
    zaehleTausche(),
    zaehleRinge(),
    zaehleGeld(),
    db
      .select({ n: raw<number>`count(*)::int` })
      .from(reports)
      .where(eq(reports.status, "offen"))
      .then((r) => r[0]?.n ?? 0),
  ]);

  return {
    konten,
    inserate,
    tausche,
    ringe,
    geld,
    offeneMeldungen: meldungen,
    nichtEingerichtet: fehlendeEinrichtung(),
  };
}

async function zaehleKonten(seit: Date): Promise<Konten> {
  const [row] = await db
    .select({
      // Gelöschte Konten bleiben als anonymisierte Hülle stehen. Sie
      // mitzuzählen hiesse, sich die Zahl schönzurechnen.
      gesamt: raw<number>`count(*) filter (where ${users.deletedAt} is null)::int`,
      bestaetigt: raw<number>`count(*) filter (where ${users.deletedAt} is null and ${users.emailVerifiedAt} is not null)::int`,
      mitAuszahlungskonto: raw<number>`count(*) filter (where ${users.deletedAt} is null and ${users.stripePayoutsEnabled})::int`,
      // Als Text mit ausdrücklichem Typ: in einem `filter (...)` steht keine
      // Spalte, aus der der Treiber den Typ des Werts ableiten könnte — ein
      // Date landet dort ungetypt und die Abfrage scheitert.
      neuDieseWoche: raw<number>`count(*) filter (where ${users.deletedAt} is null and ${users.createdAt} >= ${seit.toISOString()}::timestamptz)::int`,
      stillgelegt: raw<number>`count(*) filter (where ${users.suspendedAt} is not null)::int`,
    })
    .from(users);
  return row;
}

async function zaehleInserate(): Promise<Bestand> {
  const [row] = await db
    .select({
      aktiv: raw<number>`count(*) filter (where ${listings.status} = 'aktiv')::int`,
      pausiert: raw<number>`count(*) filter (where ${listings.status} = 'pausiert')::int`,
      getauscht: raw<number>`count(*) filter (where ${listings.status} = 'getauscht')::int`,
      gesperrt: raw<number>`count(*) filter (where ${listings.blockedAt} is not null)::int`,
    })
    .from(listings);
  return row;
}

/**
 * Nach Status zählen — und die Zustände auffüllen, die gerade nicht vorkommen.
 * Ein fehlender Schlüssel wäre in der Anzeige eine Lücke; eine Null ist eine
 * Aussage.
 */
function auffuellen<S extends string>(
  rows: { status: string; n: number }[],
  erwartet: readonly S[],
): Record<S, number> {
  const gezaehlt = Object.fromEntries(erwartet.map((s) => [s, 0])) as Record<S, number>;
  for (const r of rows) {
    if ((erwartet as readonly string[]).includes(r.status)) gezaehlt[r.status as S] = r.n;
  }
  return gezaehlt;
}

async function zaehleTausche(): Promise<Record<DealStatusDb, number>> {
  const rows = await db
    .select({ status: deals.status, n: raw<number>`count(*)::int` })
    .from(deals)
    .groupBy(deals.status);
  return auffuellen(rows, DEAL_STATUS);
}

async function zaehleRinge(): Promise<Record<RingStatusDb, number>> {
  const rows = await db
    .select({ status: ringSwaps.status, n: raw<number>`count(*)::int` })
    .from(ringSwaps)
    .groupBy(ringSwaps.status);
  return auffuellen(rows, RING_STATUS);
}

async function zaehleGeld(): Promise<Geld> {
  const [row] = await db
    .select({
      reserviertMinor: raw<number>`coalesce(sum(${payments.amountMinor}) filter (where ${payments.status} = 'autorisiert'), 0)::int`,
      ausgezahltMinor: raw<number>`coalesce(sum(${payments.amountMinor}) filter (where ${payments.status} = 'ausgezahlt'), 0)::int`,
      gebuehrenMinor: raw<number>`coalesce(sum(${payments.feeMinor}) filter (where ${payments.status} = 'ausgezahlt'), 0)::int`,
    })
    .from(payments);

  const [liegen] = await db
    .select({
      anzahl: raw<number>`count(*)::int`,
      summe: raw<number>`coalesce(sum(${payments.amountMinor}), 0)::int`,
    })
    .from(payments)
    .where(and(eq(payments.status, "eingezogen"), isNull(payments.stripeTransferId)));

  // Offen ist eine Rückbuchung, solange Stripe sie nicht entschieden hat.
  // «won» heisst, das Geld ist zurück; «lost» ist entschieden und gehört in
  // die Nachbetrachtung, nicht in die Liste dessen, was noch zu tun ist.
  const [angefochten] = await db
    .select({
      anzahl: raw<number>`count(*)::int`,
      summe: raw<number>`coalesce(sum(${payments.disputeAmountMinor}), 0)::int`,
    })
    .from(payments)
    .where(
      and(
        isNotNull(payments.disputedAt),
        raw`coalesce(${payments.disputeStatus}, '') not in ('won', 'lost', 'warning_closed')`,
      ),
    );

  return {
    ...row,
    liegengebliebenAnzahl: liegen.anzahl,
    liegengebliebenMinor: liegen.summe,
    angefochtenAnzahl: angefochten.anzahl,
    angefochtenMinor: angefochten.summe,
  };
}

/**
 * Dieselben Punkte, die `npm run preflight` vor dem Livegang prüft — hier
 * aber im Betrieb, wo niemand mehr ein Skript startet. Eine Variable, die
 * beim Deployment vergessen wurde, fällt sonst erst auf, wenn jemand sich
 * beschwert.
 */
function fehlendeEinrichtung(): string[] {
  const fehlt: string[] = [];
  if (!stripeConfigured()) fehlt.push("Zahlungen (STRIPE_SECRET_KEY)");
  if (!process.env.STRIPE_WEBHOOK_SECRET) fehlt.push("Stripe-Webhook (STRIPE_WEBHOOK_SECRET)");
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
    fehlt.push("Mailversand (RESEND_API_KEY, MAIL_FROM)");
  }
  if (!siteUrlConfigured()) fehlt.push("Basisadresse (SITE_URL)");
  if (!process.env.BLOB_READ_WRITE_TOKEN) fehlt.push("Fotospeicher (BLOB_READ_WRITE_TOKEN)");
  if (!process.env.CRON_SECRET && !process.env.HEALTH_TOKEN) {
    fehlt.push("Hintergrundläufe (CRON_SECRET)");
  }
  const impressum = missingOperatorFields();
  if (impressum.length) fehlt.push(`Impressum: ${impressum.join(", ")}`);
  return fehlt;
}

/** Für die Übersicht: Konten, die zuletzt dazugekommen sind. */
export async function neuesteKonten(limit = 8) {
  return await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
      bestaetigt: isNotNull(users.emailVerifiedAt),
    })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(desc(users.createdAt))
    .limit(limit);
}

/** Für die Übersicht: laufende Vorgänge, bei denen gerade Geld im Spiel ist. */
export async function laufendeMitGeld(limit = 20) {
  return await db
    .select({
      id: payments.id,
      dealId: payments.dealId,
      ringId: payments.ringId,
      status: payments.status,
      amountMinor: payments.amountMinor,
      transfer: payments.stripeTransferId,
      seit: payments.createdAt,
    })
    .from(payments)
    .where(
      raw`${payments.status} in ('autorisiert', 'eingezogen')`,
    )
    .orderBy(payments.createdAt)
    .limit(limit);
}

/** Wie lange ein Konto schon besteht — für die Anzeige «vor 3 Tagen». */
export function seitTagen(datum: Date, jetzt = new Date()): number {
  return Math.floor((jetzt.getTime() - datum.getTime()) / (24 * 60 * 60 * 1000));
}
