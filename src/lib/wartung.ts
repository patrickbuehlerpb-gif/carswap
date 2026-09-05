import "server-only";
import { and, eq, inArray, isNotNull, isNull, lt, or, sql as raw } from "drizzle-orm";
import { db } from "./db";
import {
  authTokens,
  deals,
  payments,
  rateLimits,
  ringSwaps,
  sessions,
  type DealRow,
  type PaymentRow,
  type RingSwapRow,
} from "./db/schema";
import { markPayment, releaseAuthorization, stripeConfigured } from "./payments";

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

  return { sitzungen: s.length, token: t.length, zaehler: z.length };
}

/**
 * Geld, das eingezogen wurde, aber noch nicht beim Empfänger ist. Dieser
 * Zustand ist der unangenehmste im ganzen System: der Betrag liegt auf dem
 * Plattformkonto und gehört jemand anderem. Er entsteht, wenn die Weiterleitung
 * scheitert — meist, weil das Auszahlungskonto der Gegenseite fehlt.
 *
 * Geheilt wird er nicht automatisch, weil dazu der ganze Abschluss erneut
 * laufen müsste. Gemeldet wird er aber: über /api/health sieht die Betreiberin,
 * dass etwas liegt.
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
