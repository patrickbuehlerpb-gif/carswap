import "server-only";
import Stripe from "stripe";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import { newId } from "./db/ids";
import { payments, users, type DealRow, type PaymentRow } from "./db/schema";
import type { RingTransfer } from "./rings";
import { siteUrl } from "./mail";

/**
 * Zahlungsfluss: Der Zahlende bezahlt auf das Plattformkonto, der Betrag wird
 * dabei nur autorisiert (`capture_method: manual`). Erst wenn beide Parteien
 * die Übergabe bestätigt haben, wird eingezogen und über Stripe Connect an
 * die Gegenseite weitergeleitet ("separate charges and transfers").
 *
 * Beträge liegen in der Anwendung als ganze Franken vor und werden erst hier
 * in Rappen umgerechnet.
 */

/**
 * Die Metadatenschlüssel bei Stripe heissen weiterhin `carswap_*`. Sie stehen
 * auf Zahlungen, die vor der Umbenennung angelegt wurden — würden sie hier
 * wechseln, fände der Webhook eine laufende Einzahlung nicht mehr wieder und
 * das Geld bliebe reserviert liegen.
 */
export const CURRENCY = "chf";

/**
 * Datenbankzugriff — entweder die Verbindung selbst oder eine laufende
 * Transaktion. Wer innerhalb einer Transaktion liest, muss sie durchreichen.
 */
export type Ausfuehrer = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Autorisierungen verfallen bei Stripe nach sieben Tagen. */
export const AUTHORIZATION_DAYS = 7;

/**
 * Die Kartengebühr trägt der Zahlende, nicht die Plattform. Voreingestellt
 * sind die Schweizer Stripe-Standardsätze; Karten von ausserhalb Europas
 * kosten mehr — die Differenz bleibt an der Plattform hängen und lässt sich
 * über die beiden Umgebungsvariablen nachziehen.
 */
function feeSetting(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Aufschlag in Rappen, damit beim Empfänger exakt `amountMinor` ankommt.
 * Stripe rechnet prozentual auf den Gesamtbetrag, deshalb wird hochgerechnet
 * statt einfach ein Prozentsatz addiert.
 */
export function platformFee(amountMinor: number): number {
  const percent = Math.min(20, feeSetting("PLATFORM_FEE_PERCENT", 2.9)) / 100;
  const fixed = Math.round(feeSetting("PLATFORM_FEE_FIXED_MINOR", 30));
  const gross = Math.ceil((amountMinor + fixed) / (1 - percent));
  return gross - amountMinor;
}

/** Die Auszahlung ist nicht möglich, weil das Empfängerkonto fehlt. */
export class PayoutBlockedError extends Error {
  constructor(readonly payeeId: string) {
    super("Das Auszahlungskonto der Gegenseite ist noch nicht freigeschaltet.");
    this.name = "PayoutBlockedError";
  }
}

/** Die Zahlung steht in einem Zustand, in dem sie nicht abgewickelt werden darf. */
export class PaymentStateError extends Error {
  constructor(readonly status: string) {
    super(`Die hinterlegte Zahlung steht auf "${status}" und lässt sich nicht abwickeln.`);
    this.name = "PaymentStateError";
  }
}

/** Verfällt die Reservierung dieser Zahlung demnächst? */
export function authorizationExpiresAt(payment: Pick<PaymentRow, "authorizedAt">): Date | null {
  if (!payment.authorizedAt) return null;
  return new Date(payment.authorizedAt.getTime() + AUTHORIZATION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Taugt diese Zahlung noch dazu, einen Vorgang abzuschliessen?
 *
 * Die Regel stand in vier Fassungen im Code — im Ring zweimal, beim
 * Zweiertausch einmal mit umgedrehtem Vorzeichen, und in der Ringsuche noch
 * einmal andersherum. Jede Änderung daran hätte an allen vier Stellen
 * nachgezogen werden müssen; ein Vergessen heisst entweder, tote Reservierungen
 * abzuwickeln, oder lebende zurückzuweisen. Deshalb nur noch hier.
 *
 * Der Rückbuchungsteil ist neu: Ist ein Betrag angefochten, hat Stripe ihn
 * bereits vom Plattformkonto abgezogen. Wer ihn trotzdem einzieht und
 * weiterleitet, bezahlt die Gegenseite aus eigener Tasche. Eine gewonnene
 * Anfechtung («won») zählt nicht mehr — dort ist das Geld zurück.
 */
export type Zahlungsstand = Pick<
  PaymentRow,
  "status" | "authorizedAt" | "disputedAt" | "disputeStatus"
>;

export function zahlungBrauchbar<T extends Zahlungsstand>(
  payment: T | null | undefined,
): payment is T {
  if (!payment) return false;
  if (payment.disputedAt && payment.disputeStatus !== "won") return false;
  if (payment.status === "eingezogen" || payment.status === "ausgezahlt") return true;
  if (payment.status !== "autorisiert") return false;
  // Eine verfallene Reservierung zählt nicht, auch wenn das Ereignis von
  // Stripe noch nicht angekommen ist.
  return (authorizationExpiresAt(payment)?.getTime() ?? Infinity) >= Date.now();
}

let cached: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY ist nicht gesetzt — Zahlungen sind nicht verfügbar.");
  }
  cached ??= new Stripe(process.env.STRIPE_SECRET_KEY, {
    // Ohne Angabe nimmt das SDK die Version, gegen die es gebaut wurde.
    typescript: true,
    maxNetworkRetries: 2,
  });
  return cached;
}

export function toMinor(chf: number): number {
  return Math.round(chf * 100);
}

/** Wer zahlt an wen? Bei einem Ausgleich von null fliesst kein Geld. */
export function paymentParties(deal: Pick<DealRow, "cashDelta" | "initiatorId" | "counterpartyId">) {
  if (deal.cashDelta === 0) return null;
  return deal.cashDelta > 0
    ? { payerId: deal.initiatorId, payeeId: deal.counterpartyId, amount: deal.cashDelta }
    : { payerId: deal.counterpartyId, payeeId: deal.initiatorId, amount: -deal.cashDelta };
}

/* ------------------------------------------------------------------ */
/* Connect-Onboarding für Auszahlungen                                 */
/* ------------------------------------------------------------------ */

export async function ensureConnectAccount(userId: string, email: string): Promise<string> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) throw new Error("Konto nicht gefunden.");
  if (user.stripeAccountId) return user.stripeAccountId;

  /*
   * Zwei gleichzeitige Klicks legten hier zwei Express-Konten an: Beide lasen
   * `stripeAccountId = null`, beide riefen Stripe, und der zweite Schreibvorgang
   * überschrieb den ersten. Die Person schloss dann womöglich die Einrichtung
   * für das Konto ab, auf das die Zeile nicht mehr zeigt — und «Auszahlungen
   * freigeschaltet» wurde nie wahr.
   *
   * Der Idempotenzschlüssel sorgt dafür, dass Stripe beim zweiten Aufruf
   * dasselbe Konto zurückgibt; die Bedingung im UPDATE dafür, dass eine
   * bereits eingetragene Kennung nicht überschrieben wird.
   */
  const account = await stripe().accounts.create(
    {
      type: "express",
      country: "CH",
      email,
      business_type: "individual",
      capabilities: { transfers: { requested: true } },
      metadata: { carswap_user_id: userId },
    },
    { idempotencyKey: `connect:${userId}` },
  );

  const gesetzt = await db
    .update(users)
    .set({ stripeAccountId: account.id, updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.stripeAccountId)))
    .returning({ id: users.stripeAccountId });
  if (gesetzt.length) return account.id;

  // Jemand war schneller — dessen Kennung gilt.
  const [aktuell] = await db
    .select({ stripeAccountId: users.stripeAccountId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return aktuell?.stripeAccountId ?? account.id;
}

export async function connectOnboardingUrl(accountId: string): Promise<string> {
  const link = await stripe().accountLinks.create({
    account: accountId,
    refresh_url: `${siteUrl()}/konto?stripe=erneut`,
    return_url: `${siteUrl()}/konto?stripe=fertig`,
    type: "account_onboarding",
  });
  return link.url;
}

/** Fragt bei Stripe nach, ob Auszahlungen freigeschaltet sind. */
export async function refreshPayoutStatus(userId: string): Promise<boolean> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user?.stripeAccountId) return false;

  const account = await stripe().accounts.retrieve(user.stripeAccountId);
  const enabled = Boolean(account.payouts_enabled && account.charges_enabled);
  if (enabled !== user.stripePayoutsEnabled) {
    await db
      .update(users)
      .set({ stripePayoutsEnabled: enabled, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }
  return enabled;
}

/* ------------------------------------------------------------------ */
/* Treuhand                                                            */
/* ------------------------------------------------------------------ */

export interface EscrowCheckout {
  url: string;
  paymentId: string;
}

/**
 * Legt die Checkout-Session für die Ausgleichszahlung an. Der Betrag wird
 * reserviert, nicht eingezogen.
 */
export async function createEscrowCheckout(
  deal: DealRow,
  description: string,
): Promise<EscrowCheckout> {
  const parties = paymentParties(deal);
  if (!parties) throw new Error("Für diesen Tausch ist keine Ausgleichszahlung nötig.");

  const s = stripe();

  // Bereits angelegte Zahlungen zu diesem Tausch prüfen: eine noch offene
  // Session wird wiederverwendet, eine abgelaufene entwertet. Ohne das würde
  // der Idempotenzschlüssel unten eine tote Session zurückgeben.
  const existing = await db
    .select()
    .from(payments)
    .where(eq(payments.dealId, deal.id))
    .orderBy(desc(payments.createdAt));

  for (const row of existing) {
    if (row.status === "autorisiert" || row.status === "eingezogen" || row.status === "ausgezahlt") {
      throw new Error("Für diesen Tausch ist bereits ein Betrag hinterlegt.");
    }
    if (row.status === "erstellt" && row.stripeSessionId) {
      const session = await s.checkout.sessions.retrieve(row.stripeSessionId);
      if (session.status === "open" && session.url) {
        return { url: session.url, paymentId: row.id };
      }
      /*
       * «complete» heisst bezahlt — der Webhook ist nur noch nicht da. Diese
       * Session wie eine abgelaufene zu entwerten und eine zweite zu öffnen,
       * war der kürzeste Weg zu einer doppelten Belastung: Der Webhook setzt
       * die erste Zeile danach wieder auf «autorisiert», und die zweite
       * Zahlung liegt zusätzlich auf der Karte.
       */
      if (session.status === "complete") {
        throw new Error(
          "Deine Zahlung wird gerade verarbeitet. Lade die Seite in ein paar Sekunden neu.",
        );
      }
      await markPayment(row.id, "storniert", "Checkout-Session nicht mehr offen");
    }
  }

  const paymentId = newId("pay");
  const amountMinor = toMinor(parties.amount);
  const feeMinor = platformFee(amountMinor);
  const chargeMinor = amountMinor + feeMinor;
  // Der Versuchszähler hält den Idempotenzschlüssel eindeutig, wenn ein
  // früherer Anlauf abgelaufen ist.
  const attempt = existing.length + 1;

  const session = await s.checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: deal.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: chargeMinor,
            product_data: {
              name: "autotauschen — hinterlegter Ausgleich",
              description: `${description} — davon ${(feeMinor / 100).toFixed(2)} CHF Zahlungsgebühr`,
            },
          },
        },
      ],
      payment_intent_data: {
        capture_method: "manual",
        transfer_group: deal.id,
        description: `autotauschen Tausch ${deal.id}`,
        metadata: { carswap_deal_id: deal.id, carswap_payment_id: paymentId },
      },
      metadata: { carswap_deal_id: deal.id, carswap_payment_id: paymentId },
      success_url: `${siteUrl()}/deals/${deal.id}?treuhand=ok`,
      cancel_url: `${siteUrl()}/deals/${deal.id}?treuhand=abgebrochen`,
      /*
       * Eine Stunde, nicht dreissig Minuten: Stripe verlangt mindestens
       * dreissig Minuten in der Zukunft, und `Math.floor` plus die Laufzeit
       * der Anfrage nagen genau an dieser Grenze — der Aufruf kann mit
       * «Invalid timestamp» scheitern, und dann lässt sich überhaupt nichts
       * hinterlegen. Eine Stunde ist auch für den Zahlenden angenehmer.
       */
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    },
    // Idempotenz: ein erneuter Klick erzeugt keine zweite Session
    { idempotencyKey: `escrow:${deal.id}:${deal.cashDelta}:${attempt}` },
  );

  // Zwei gleichzeitige Klicks bekommen über den Idempotenzschlüssel dieselbe
  // Stripe-Session zurück. Der Unique-Index auf der Session-ID entscheidet,
  // welcher der beiden die Zeile anlegt; der andere übernimmt sie.
  const insertedRows = await db
    .insert(payments)
    .values({
      id: paymentId,
      dealId: deal.id,
      payerId: parties.payerId,
      payeeId: parties.payeeId,
      amountMinor,
      feeMinor,
      currency: CURRENCY,
      status: "erstellt",
      stripeSessionId: session.id,
    })
    .onConflictDoNothing({ target: payments.stripeSessionId })
    .returning({ id: payments.id });

  let storedId = insertedRows[0]?.id;
  if (!storedId) {
    const [existingRow] = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.stripeSessionId, session.id))
      .limit(1);
    storedId = existingRow?.id;
  }
  if (!storedId) throw new Error("Die Zahlung konnte nicht gespeichert werden.");

  if (!session.url) throw new Error("Stripe hat keine Checkout-URL geliefert.");
  return { url: session.url, paymentId: storedId };
}

/**
 * Zieht den reservierten Betrag ein und leitet ihn an die Gegenseite weiter.
 * Beide Schritte sind idempotent über den Zahlungsstatus abgesichert.
 */
export async function captureAndPayout(payment: PaymentRow): Promise<PaymentRow> {
  const s = stripe();

  if (payment.status === "ausgezahlt") return payment;
  if (payment.status !== "autorisiert" && payment.status !== "eingezogen") {
    // Storniert, erstattet, fehlgeschlagen oder noch gar nicht bezahlt: hier
    // darf nichts stillschweigend durchgehen, sonst wechselt das Auto den
    // Besitzer, ohne dass Geld geflossen ist.
    throw new PaymentStateError(payment.status);
  }
  /*
   * Eine offene Rückbuchung hat Stripe längst vom Plattformkonto abgezogen.
   * Wer sie hier trotzdem einzieht und weiterleitet, bezahlt die Gegenseite
   * aus eigener Tasche — und hat das Geld zweimal verloren. Bisher wurde
   * `disputedAt` nur gemeldet und nirgends geprüft.
   */
  if (payment.disputedAt && payment.disputeStatus !== "won") {
    throw new PaymentStateError(`angefochten (${payment.disputeStatus ?? "offen"})`);
  }
  if (!payment.stripePaymentIntentId) {
    throw new Error("Zu dieser Zahlung ist keine Stripe-Transaktion hinterlegt.");
  }

  // Erst prüfen, ob die Gegenseite das Geld überhaupt annehmen kann. Solange
  // das nicht steht, bleibt der Betrag reserviert statt eingezogen — eine
  // Reservierung verfällt von selbst, eingezogenes Geld müsste erstattet
  // werden.
  const ready = await payoutReady(payment.payeeId);
  if (!ready) throw new PayoutBlockedError(payment.payeeId);

  // 1) Einziehen
  if (payment.status === "autorisiert") {
    const intent = await s.paymentIntents.capture(
      payment.stripePaymentIntentId,
      {},
      { idempotencyKey: `capture:${payment.id}` },
    );
    if (intent.status !== "succeeded") {
      await markPayment(payment.id, "fehlgeschlagen", `Capture-Status ${intent.status}`);
      throw new Error("Der Betrag konnte nicht eingezogen werden.");
    }
    payment = await markPayment(payment.id, "eingezogen");
  }

  // 2) Weiterleiten — nur der Nettobetrag, die Gebühr deckt Stripes Anteil.
  const payeeRows = await db.select().from(users).where(eq(users.id, payment.payeeId)).limit(1);
  const payee = payeeRows[0];
  if (!payee?.stripeAccountId) throw new PayoutBlockedError(payment.payeeId);

  const transfer = await s.transfers.create(
    {
      amount: payment.amountMinor,
      currency: payment.currency,
      destination: payee.stripeAccountId,
      transfer_group: payment.dealId ?? payment.ringId ?? undefined,
      metadata: { carswap_payment_id: payment.id, ...vorgangMetadata(payment) },
    },
    { idempotencyKey: `payout:${payment.id}` },
  );
  return await markPayment(payment.id, "ausgezahlt", null, { stripeTransferId: transfer.id });
}

/**
 * Kann dieser Nutzer Geld empfangen? Der gespeicherte Stand wird bei Bedarf
 * an Stripe nachgefragt, damit ein zwischenzeitlich abgeschlossenes
 * Onboarding nicht übersehen wird.
 */
export async function payoutReady(userId: string): Promise<boolean> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user?.stripeAccountId) return false;
  if (user.stripePayoutsEnabled) return true;
  return await refreshPayoutStatus(userId);
}

/** Gibt eine reservierte, aber nicht eingezogene Zahlung wieder frei. */
export async function releaseAuthorization(payment: PaymentRow): Promise<void> {
  if (!payment.stripePaymentIntentId) return;
  if (payment.status === "autorisiert") {
    await stripe().paymentIntents.cancel(payment.stripePaymentIntentId);
    await markPayment(payment.id, "storniert");
  } else if (payment.status === "eingezogen") {
    await stripe().refunds.create(
      { payment_intent: payment.stripePaymentIntentId },
      { idempotencyKey: `refund:${payment.id}` },
    );
    await markPayment(payment.id, "erstattet");
  }
}

/**
 * Setzt einen Zahlungsstatus nur, wenn die Zahlung noch in einem der
 * erlaubten Ausgangszustände steht. Verspätete oder doppelt zugestellte
 * Stripe-Ereignisse können damit keinen weiter fortgeschrittenen Zustand
 * überschreiben — ein nachgereichtes „payment_failed“ darf eine längst
 * autorisierte Zahlung nicht entwerten.
 */
export async function markPaymentIfIn(
  id: string,
  from: PaymentRow["status"][],
  status: PaymentRow["status"],
  lastError: string | null = null,
  extra: Partial<PaymentRow> = {},
): Promise<PaymentRow | null> {
  const rows = await db
    .update(payments)
    .set({ status, lastError, updatedAt: new Date(), ...extra })
    .where(and(eq(payments.id, id), inArray(payments.status, from)))
    .returning();
  return rows[0] ?? null;
}

export async function markPayment(
  id: string,
  status: PaymentRow["status"],
  lastError: string | null = null,
  extra: Partial<PaymentRow> = {},
): Promise<PaymentRow> {
  const rows = await db
    .update(payments)
    .set({ status, lastError, updatedAt: new Date(), ...extra })
    .where(eq(payments.id, id))
    .returning();
  /*
   * Ohne diese Prüfung gab die Funktion `undefined` zurück, obwohl der Typ
   * eine Zeile verspricht — und der Webhook schob den Tausch danach trotzdem
   * in die Treuhandphase, ohne dass irgendwo eine hinterlegte Zahlung stand.
   * Lieber laut scheitern: Stripe stellt das Ereignis dann erneut zu.
   */
  const row = rows[0];
  if (!row) throw new Error(`Zahlung ${id} nicht gefunden.`);
  return row;
}

/* ------------------------------------------------------------------ */
/* Ringtausch                                                          */
/* ------------------------------------------------------------------ */

/** Zu welchem Vorgang gehört diese Zahlung? Für Stripe-Metadaten. */
function vorgangMetadata(payment: Pick<PaymentRow, "dealId" | "ringId">): Record<string, string> {
  if (payment.dealId) return { carswap_deal_id: payment.dealId };
  if (payment.ringId) return { carswap_ring_id: payment.ringId };
  return {};
}

/**
 * Legt die Checkout-Session für eine einzelne Zahlung innerhalb eines Rings an.
 * Aufbau und Absicherung entsprechen `createEscrowCheckout`; unterschieden wird
 * nur, wonach die bisherigen Versuche gesucht werden — beim Ring nach dem Paar
 * aus Zahler und Empfänger, weil es je Ring mehrere Wege geben kann.
 */
export async function createRingCheckout(
  ringId: string,
  transfer: RingTransfer,
  description: string,
): Promise<EscrowCheckout> {
  const s = stripe();

  const existing = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.ringId, ringId),
        eq(payments.payerId, transfer.payerId),
        eq(payments.payeeId, transfer.payeeId),
      ),
    )
    .orderBy(desc(payments.createdAt));

  for (const row of existing) {
    if (row.status === "autorisiert" || row.status === "eingezogen" || row.status === "ausgezahlt") {
      throw new Error("Für diesen Weg ist bereits ein Betrag hinterlegt.");
    }
    if (row.status === "erstellt" && row.stripeSessionId) {
      const session = await s.checkout.sessions.retrieve(row.stripeSessionId);
      if (session.status === "open" && session.url) {
        return { url: session.url, paymentId: row.id };
      }
      await markPayment(row.id, "storniert", "Checkout-Session nicht mehr offen");
    }
  }

  const paymentId = newId("pay");
  const amountMinor = toMinor(transfer.amount);
  const feeMinor = platformFee(amountMinor);
  const chargeMinor = amountMinor + feeMinor;
  const attempt = existing.length + 1;

  const session = await s.checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: ringId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: chargeMinor,
            product_data: {
              name: "autotauschen — hinterlegter Ausgleich (Ringtausch)",
              description: `${description} — davon ${(feeMinor / 100).toFixed(2)} CHF Zahlungsgebühr`,
            },
          },
        },
      ],
      payment_intent_data: {
        capture_method: "manual",
        transfer_group: ringId,
        description: `autotauschen Ringtausch ${ringId}`,
        metadata: { carswap_ring_id: ringId, carswap_payment_id: paymentId },
      },
      metadata: { carswap_ring_id: ringId, carswap_payment_id: paymentId },
      success_url: `${siteUrl()}/ringe/${ringId}?treuhand=ok`,
      cancel_url: `${siteUrl()}/ringe/${ringId}?treuhand=abgebrochen`,
      /*
       * Eine Stunde, nicht dreissig Minuten: Stripe verlangt mindestens
       * dreissig Minuten in der Zukunft, und `Math.floor` plus die Laufzeit
       * der Anfrage nagen genau an dieser Grenze — der Aufruf kann mit
       * «Invalid timestamp» scheitern, und dann lässt sich überhaupt nichts
       * hinterlegen. Eine Stunde ist auch für den Zahlenden angenehmer.
       */
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    },
    {
      idempotencyKey: `ring:${ringId}:${transfer.payerId}:${transfer.payeeId}:${transfer.amount}:${attempt}`,
    },
  );

  const insertedRows = await db
    .insert(payments)
    .values({
      id: paymentId,
      ringId,
      payerId: transfer.payerId,
      payeeId: transfer.payeeId,
      amountMinor,
      feeMinor,
      currency: CURRENCY,
      status: "erstellt",
      stripeSessionId: session.id,
    })
    .onConflictDoNothing({ target: payments.stripeSessionId })
    .returning({ id: payments.id });

  let storedId = insertedRows[0]?.id;
  if (!storedId) {
    const [row] = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.stripeSessionId, session.id))
      .limit(1);
    storedId = row?.id;
  }
  if (!storedId) throw new Error("Die Zahlung konnte nicht gespeichert werden.");

  if (!session.url) throw new Error("Stripe hat keine Checkout-URL geliefert.");
  return { url: session.url, paymentId: storedId };
}

/**
 * Die aktuelle Zahlung je Weg innerhalb eines Rings. Frühere, verfallene
 * Versuche zum selben Paar bleiben in der Tabelle stehen — für die Abwicklung
 * zählt nur der jüngste.
 */
export async function currentRingPayments(
  ringId: string,
  /*
   * Wer in einer Transaktion steht, muss hier dieselbe übergeben. Sonst liefe
   * die Abfrage über eine zweite Verbindung aus dem Pool — sie sähe zwar
   * dieselben Daten, aber eine offene Transaktion, die auf eine zweite
   * Verbindung wartet, ist genau das Muster, das bei ausgelastetem Pool
   * blockiert.
   */
  ausfuehrer: Ausfuehrer = db,
): Promise<PaymentRow[]> {
  const rows = await ausfuehrer
    .select()
    .from(payments)
    .where(eq(payments.ringId, ringId))
    .orderBy(desc(payments.createdAt));

  const latest = new Map<string, PaymentRow>();
  for (const row of rows) {
    const key = `${row.payerId}|${row.payeeId}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()];
}

/**
 * Die Zahlung, die für einen Zweiertausch zählt. Es kann mehrere Zeilen
 * geben — ein abgebrochener erster Anlauf, danach ein zweiter —, und die
 * neueste ist dann ausgerechnet die stornierte. Wer nur sie ansieht, hält
 * hinterlegtes Geld für verschwunden.
 *
 * Gibt es keine brauchbare, kommt die jüngste zurück: die Seite soll den
 * letzten Versuch zeigen können, statt zu behaupten, es habe nie einen
 * gegeben. `zahlungBrauchbar` beantwortet dann, ob wirklich Geld liegt.
 */
export async function currentDealPayment(
  dealId: string,
  ausfuehrer: Ausfuehrer = db,
): Promise<PaymentRow | null> {
  const alle = await ausfuehrer
    .select()
    .from(payments)
    .where(eq(payments.dealId, dealId))
    .orderBy(desc(payments.createdAt));
  return alle.find(zahlungBrauchbar) ?? alle[0] ?? null;
}
