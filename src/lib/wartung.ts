import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql as raw } from "drizzle-orm";
import { db } from "./db";
import {
  authTokens,
  deals,
  mailFailures,
  payments,
  rateLimits,
  ringLegs,
  ringSwaps,
  sessions,
  type DealRow,
  type PaymentRow,
  type RingSwapRow,
} from "./db/schema";
import { markPayment, releaseAuthorization, stripeConfigured } from "./payments";
import { schliesseTauschAb, type AbschlussErgebnis } from "./abschluss";
import { loadRing, schliesseRingAb, type RingErgebnis } from "./rings-db";

/**
 * Wiederkehrende Aufräumarbeiten. Sie laufen über /api/cron/wartung und sind
 * bewusst hier und nicht in einer Server-Aktion: aus einer Aktionsdatei
 * exportiert wäre jede dieser Funktionen vom Browser aus aufrufbar.
 *
 * Jeder Schritt ist für sich wiederholbar. Bricht der Lauf in der Mitte ab,
 * macht der nächste dort weiter, wo es nötig ist.
 */

const LEBENDE_ZAHLUNGEN: PaymentRow["status"][] = ["erstellt", "autorisiert", "eingezogen"];
const BEENDET_DEAL: DealRow["status"][] = ["abgelehnt", "storniert"];
const BEENDET_RING: RingSwapRow["status"][] = ["abgelehnt", "storniert"];

/**
 * Zahlungen, die zu einem abgebrochenen Vorgang gehören und trotzdem noch
 * Geld binden. Normalerweise gibt der Abbruch sie sofort frei; scheitert das
 * gerade an Stripe, bleibt die Reservierung auf der Karte des Nutzers stehen.
 * Dieser Lauf holt das nach.
 */
export async function gibVerwaisteZahlungenFrei(): Promise<{
  freigegeben: number;
  fehler: number;
}> {
  const rows = await db
    .select({ zahlung: payments })
    .from(payments)
    .leftJoin(deals, eq(deals.id, payments.dealId))
    .leftJoin(ringSwaps, eq(ringSwaps.id, payments.ringId))
    .where(
      and(
        inArray(payments.status, LEBENDE_ZAHLUNGEN),
        or(inArray(deals.status, BEENDET_DEAL), inArray(ringSwaps.status, BEENDET_RING)),
      ),
    );

  let freigegeben = 0;
  let fehler = 0;
  for (const { zahlung } of rows) {
    // Ohne Stripe-Transaktion gibt es bei Stripe nichts freizugeben — die
    // Zeile wird nur noch als erledigt vermerkt.
    if (!zahlung.stripePaymentIntentId) {
      await markPayment(zahlung.id, "storniert", "Vorgang abgebrochen, keine Transaktion angelegt");
      freigegeben++;
      continue;
    }
    if (!stripeConfigured()) continue;
    try {
      await releaseAuthorization(zahlung);
      freigegeben++;
    } catch (err) {
      console.error(`Wartung: Zahlung ${zahlung.id} liess sich nicht freigeben:`, err);
      await markPayment(zahlung.id, zahlung.status, `Freigabe im Wartungslauf gescheitert: ${err}`);
      fehler++;
    }
  }
  return { freigegeben, fehler };
}

/** Ein Tag in Millisekunden — Karenzzeit, bevor eine Zeile wirklich weg darf. */
const KARENZ_MS = 24 * 60 * 60 * 1000;

/**
 * Abgelaufene Sitzungen, verbrauchte Einmal-Token und alte Zählerstände der
 * Ratenbegrenzung. Nichts davon wird je wieder gelesen; ohne diesen Lauf
 * wachsen die drei Tabellen ohne Ende.
 */
export async function raeumeAuf(): Promise<{
  sitzungen: number;
  token: number;
  zaehler: number;
  mailfehler: number;
}> {
  const grenze = new Date(Date.now() - KARENZ_MS);

  const s = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });

  // Verbrauchte Token bleiben einen Tag stehen: wer zweimal auf denselben
  // Link klickt, soll «bereits verwendet» lesen und nicht «unbekannt».
  const t = await db
    .delete(authTokens)
    .where(
      or(lt(authTokens.expiresAt, grenze), and(isNotNull(authTokens.usedAt), lt(authTokens.usedAt, grenze))),
    )
    .returning({ id: authTokens.id });

  const z = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, grenze))
    .returning({ key: rateLimits.key });

  // Vermerkte Fehlversuche beim Mailversand halten 30 Tage. Länger ist es
  // keine Diagnose mehr, sondern ein Archiv — und Fehlerprotokolle sollen
  // nicht wachsen, bis sie jemand von Hand leert.
  const m = await db
    .delete(mailFailures)
    .where(lt(mailFailures.createdAt, new Date(Date.now() - MAILFEHLER_MS)))
    .returning({ id: mailFailures.id });

  return { sitzungen: s.length, token: t.length, zaehler: z.length, mailfehler: m.length };
}

/**
 * So lange bleibt ein vermerkter Fehlversuch stehen. Bewusst eigenständig und
 * nicht als Vielfaches von KARENZ_MS: das ist die Karenzzeit für verbrauchte
 * Token, und wer die einmal anfasst, würde hier unbemerkt die Aufbewahrung
 * mitverschieben — samt der Angabe in der Datenschutzerklärung.
 */
const MAILFEHLER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Gescheiterte Mailversuche der letzten Stunden.
 *
 * Der stillste Ausfall im ganzen System: Lehnt der Maildienst ab, läuft alles
 * andere weiter — die Registrierung meldet Erfolg, nur bekommt niemand mehr
 * eine Bestätigung, und wer sein Passwort vergisst, bleibt ausgesperrt. Ohne
 * diese Zahl fiele es erst auf, wenn sich jemand beschwert.
 */
export async function mailFehler(stunden = 24): Promise<{
  anzahl: number;
  /** Davon in der letzten Stunde — daran hängt, ob es ein Muster ist. */
  letzteStunde: number;
  /**
   * Davon in der letzten Stunde solche, die an unserer Einrichtung liegen und
   * nicht an einer einzelnen Adresse. Nur die taugen als Alarm.
   */
  systemischLetzteStunde: number;
  domains: string[];
  letzterGrund?: string;
}> {
  const seit = new Date(Date.now() - stunden * 60 * 60 * 1000);
  const vorEinerStunde = new Date(Date.now() - 60 * 60 * 1000);

  /*
   * Gezählt wird in der Datenbank, nicht an geladenen Zeilen. Ein Deckel auf
   * die Ladung hätte ausgerechnet den Fall verharmlost, für den es die Zahl
   * gibt: Bei einem Totalausfall scheitern vierstellig viele Mails, und die
   * Meldung «200 Fehlversuche» wäre von einem mittleren Ärgernis nicht mehr
   * zu unterscheiden.
   */
  const [zahlen] = await db
    .select({
      anzahl: raw<number>`count(*)::int`,
      letzteStunde: raw<number>`count(*) filter (where ${mailFailures.createdAt} > ${vorEinerStunde.toISOString()}::timestamptz)::int`,
      systemischLetzteStunde: raw<number>`count(*) filter (where ${mailFailures.createdAt} > ${vorEinerStunde.toISOString()}::timestamptz and ${mailFailures.systemic})::int`,
    })
    .from(mailFailures)
    .where(gt(mailFailures.createdAt, seit));

  // Für die Diagnose reichen die jüngsten Zeilen: welche Empfänger betroffen
  // sind und woran es zuletzt lag.
  const jüngste = await db
    .select({ domain: mailFailures.domain, reason: mailFailures.reason })
    .from(mailFailures)
    .where(gt(mailFailures.createdAt, seit))
    .orderBy(desc(mailFailures.createdAt))
    .limit(50);

  return {
    anzahl: zahlen?.anzahl ?? 0,
    letzteStunde: zahlen?.letzteStunde ?? 0,
    systemischLetzteStunde: zahlen?.systemischLetzteStunde ?? 0,
    domains: [...new Set(jüngste.map((r) => r.domain))].slice(0, 5),
    letzterGrund: jüngste[0]?.reason,
  };
}

/**
 * Geld, das eingezogen wurde, aber noch nicht beim Empfänger ist. Dieser
 * Zustand ist der unangenehmste im ganzen System: der Betrag liegt auf dem
 * Plattformkonto und gehört jemand anderem. Er entsteht, wenn die Weiterleitung
 * scheitert — meist, weil das Auszahlungskonto der Gegenseite fehlt.
 *
 * Der Lauf versucht ihn zu heilen (siehe holeAbschluesseNach). Bleibt trotzdem
 * etwas liegen — etwa weil das Auszahlungskonto der Gegenseite fehlt —, steht
 * es hier und über /api/health, damit es der Betreiberin auffällt.
 */
export async function haengendeGelder(): Promise<{ anzahl: number; summeMinor: number }> {
  const [row] = await db
    .select({
      anzahl: raw<number>`count(*)::int`,
      summeMinor: raw<number>`coalesce(sum(${payments.amountMinor}), 0)::int`,
    })
    .from(payments)
    .where(and(eq(payments.status, "eingezogen"), isNull(payments.stripeTransferId)));
  return row ?? { anzahl: 0, summeMinor: 0 };
}

/**
 * Holt Abschlüsse nach, die steckengeblieben sind.
 *
 * Beide bestätigen die Übergabe, das Geld wird eingezogen — und dann scheitert
 * die Weiterleitung. Der Betrag liegt dann auf dem Plattformkonto und gehört
 * jemand anderem. Bisher heilte das nur, wenn eine der beiden Seiten von selbst
 * zurückkam und noch einmal auf «Übergabe bestätigen» drückte. Kam niemand,
 * blieb es liegen — und niemandem fiel es auf.
 *
 * Gesucht wird dieselbe Lage, die auch der Knopf herstellt: alle haben
 * bestätigt, der Vorgang steht in «treuhand» oder «abwicklung». Angestossen
 * wird dieselbe Abwicklung. Sie ist beliebig oft wiederholbar — was schon
 * eingezogen ist, wird nicht doppelt eingezogen, was schon überwiesen ist,
 * nicht doppelt überwiesen (Idempotenzschlüssel bei Stripe).
 *
 * Was der Lauf nicht heilen kann, zählt er: ein fehlendes Auszahlungskonto
 * bleibt fehlend, bis die Person es einrichtet. Sie bekommt bei jedem Anlauf
 * eine Erinnerung — höchstens eine am Tag, weil der Lauf einmal am Tag läuft.
 */
export interface NachgeholteAbschluesse {
  /** Geprüfte Vorgänge. */
  geprueft: number;
  /** Jetzt fertig: Geld beim Empfänger, Fahrzeuge umgeschrieben. */
  abgeschlossen: number;
  /** Wartet auf ein Auszahlungskonto — die Person wurde erinnert. */
  wartetAufKonto: number;
  /** Braucht einen Menschen. */
  festgefahren: number;
}

export async function holeAbschluesseNach(): Promise<NachgeholteAbschluesse> {
  const ergebnis: NachgeholteAbschluesse = {
    geprueft: 0,
    abgeschlossen: 0,
    wartetAufKonto: 0,
    festgefahren: 0,
  };

  for (const deal of await offeneAbschluesse()) {
    ergebnis.geprueft++;
    try {
      // Als Urheber der Systemnachricht der Initiator: der Lauf ist keine
      // Person, und die Spalte verlangt eine.
      werte(ergebnis, await schliesseTauschAb(deal, deal.initiatorId));
    } catch (err) {
      ergebnis.festgefahren++;
      console.error(`[wartung] Abschluss von Tausch ${deal.id} fehlgeschlagen:`, err);
    }
  }

  for (const ringId of await offeneRingAbschluesse()) {
    ergebnis.geprueft++;
    try {
      const geladen = await loadRing(ringId);
      if (!geladen) continue;
      werteRing(ergebnis, await schliesseRingAb(geladen));
    } catch (err) {
      ergebnis.festgefahren++;
      console.error(`[wartung] Abschluss von Ring ${ringId} fehlgeschlagen:`, err);
    }
  }

  return ergebnis;
}

function werte(ziel: NachgeholteAbschluesse, e: AbschlussErgebnis): void {
  switch (e.art) {
    case "fertig":
      ziel.abgeschlossen++;
      return;
    case "kein-auszahlungskonto":
      ziel.wartetAufKonto++;
      return;
    // «belegt» heisst, jemand wickelt gerade selbst ab — kein Grund zur Sorge.
    // «zahlung-ungueltig» hat den Vorgang zurück in die Zusage gesetzt, die
    // Beteiligten sind über die Systemnachricht informiert.
    case "belegt":
    case "zahlung-ungueltig":
    case "zahlungen-aus":
      return;
    default:
      ziel.festgefahren++;
  }
}

function werteRing(ziel: NachgeholteAbschluesse, e: RingErgebnis): void {
  switch (e.art) {
    case "fertig":
      ziel.abgeschlossen++;
      return;
    case "kein-auszahlungskonto":
      ziel.wartetAufKonto++;
      return;
    case "belegt":
    case "zahlung-ungueltig":
    case "zahlungen-aus":
      return;
    default:
      ziel.festgefahren++;
  }
}

/** Zweiertausche, bei denen beide bestätigt haben und trotzdem nichts fertig ist. */
async function offeneAbschluesse(): Promise<DealRow[]> {
  return await db
    .select()
    .from(deals)
    .where(
      and(
        inArray(deals.status, ["treuhand", "abwicklung"]),
        eq(deals.initiatorConfirmed, true),
        eq(deals.counterpartyConfirmed, true),
      ),
    );
}

/** Ringe, bei denen alle drei bestätigt haben und trotzdem nichts fertig ist. */
async function offeneRingAbschluesse(): Promise<string[]> {
  const rows = await db
    .select({
      id: ringSwaps.id,
      bestaetigt: raw<number>`count(${ringLegs.confirmedAt})::int`,
    })
    .from(ringSwaps)
    .innerJoin(ringLegs, eq(ringLegs.ringId, ringSwaps.id))
    .where(inArray(ringSwaps.status, ["treuhand", "abwicklung"]))
    .groupBy(ringSwaps.id);
  return rows.filter((r) => r.bestaetigt === 3).map((r) => r.id);
}

/**
 * Offene Rückbuchungen. Bis Stripe entschieden hat, fehlt das Geld auf dem
 * Plattformkonto — und ohne fristgerechte Stellungnahme bleibt es weg.
 */
export async function offeneRueckbuchungen(): Promise<{ anzahl: number; summeMinor: number }> {
  const [row] = await db
    .select({
      anzahl: raw<number>`count(*)::int`,
      summeMinor: raw<number>`coalesce(sum(${payments.disputeAmountMinor}), 0)::int`,
    })
    .from(payments)
    .where(
      and(
        isNotNull(payments.disputedAt),
        raw`coalesce(${payments.disputeStatus}, '') not in ('won', 'lost', 'warning_closed')`,
      ),
    );
  return row ?? { anzahl: 0, summeMinor: 0 };
}
