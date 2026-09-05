import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Body, Condition, Drivetrain, Fuel, ServiceHistory } from "../types";

/**
 * Geldbeträge werden durchgehend als ganze Franken (integer) gespeichert.
 * Erst an der Stripe-Grenze wird in Rappen umgerechnet — siehe lib/payments.
 */

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /**
     * Angefragte neue Adresse. Sie wird erst zur echten, wenn der Link an
     * diese Adresse angeklickt wurde — sonst könnte jemand mit einer fremden
     * Sitzung das Konto auf seine eigene Adresse umhängen und es über
     * «Passwort vergessen» endgültig übernehmen.
     */
    pendingEmail: text("pending_email"),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    location: text("location").notNull().default(""),
    canton: text("canton").notNull().default(""),
    phone: text("phone"),
    avatarColor: text("avatar_color").notNull().default("#0e4c46"),
    ratingSum: integer("rating_sum").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    swapsCompleted: integer("swaps_completed").notNull().default(0),
    /** Identität geprüft (Ausweis) — heute manuell, später über einen Anbieter */
    identityVerified: boolean("identity_verified").notNull().default(false),
    /** Stripe-Connect-Konto für Auszahlungen */
    stripeAccountId: text("stripe_account_id"),
    stripePayoutsEnabled: boolean("stripe_payouts_enabled").notNull().default(false),
    isAdmin: boolean("is_admin").notNull().default(false),
    /**
     * Mail, wenn jemand auftaucht, der das eigene Auto sucht. Standardmässig
     * an — ohne diese Meldung erfährt niemand je von einem Treffer, denn das
     * Matching läuft nur, solange jemand die Seite offen hat.
     */
    notifyMatches: boolean("notify_matches").notNull().default(true),
    /**
     * Gelöschte Konten bleiben als anonymisierte Hülle bestehen: abgeschlossene
     * Tausche verweisen darauf und dürfen aus buchhalterischen Gründen nicht
     * verschwinden. Alles Persönliche ist dann entfernt.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Von der Betreiberin stillgelegt — Anmeldung bleibt möglich, Handeln nicht. */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_key").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Nur der SHA-256-Hash des Tokens liegt in der Datenbank. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_key").on(t.tokenHash),
    index("sessions_user_id_idx").on(t.userId),
  ],
);

/** Einmal-Token für E-Mail-Bestätigung, Passwort-Reset und Adresswechsel. */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose")
      .$type<"verify_email" | "reset_password" | "change_email">()
      .notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("auth_tokens_token_hash_key").on(t.tokenHash),
    index("auth_tokens_user_purpose_idx").on(t.userId, t.purpose),
  ],
);

/** Einfacher Zähler für Ratenbegrenzung, Fenster über bucket_start. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  },
);

export interface VehiclePhoto {
  url: string;
  width: number;
  height: number;
}

export const vehicles = pgTable(
  "vehicles",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    make: text("make").notNull(),
    model: text("model").notNull(),
    trim: text("trim").notNull().default(""),
    /** Erstzulassung als ISO-Datum YYYY-MM-DD */
    firstRegistration: text("first_registration").notNull(),
    mileageKm: integer("mileage_km").notNull(),
    fuel: text("fuel").$type<Fuel>().notNull(),
    body: text("body").$type<Body>().notNull(),
    drivetrain: text("drivetrain").$type<Drivetrain>().notNull(),
    powerPs: integer("power_ps").notNull(),
    /** Listenpreis fabrikneu in ganzen Franken */
    listPriceNew: integer("list_price_new").notNull(),
    condition: text("condition").$type<Condition>().notNull(),
    color: text("color").notNull().default(""),
    rangeKm: integer("range_km"),
    batterySoh: smallint("battery_soh"),
    features: jsonb("features").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    defects: jsonb("defects").$type<string[]>().notNull().default([]),
    serviceHistory: text("service_history").$type<ServiceHistory>().notNull(),
    previousOwners: smallint("previous_owners").notNull().default(1),
    accidentFree: boolean("accident_free").notNull().default(true),
    mfkUntil: text("mfk_until"),
    photos: jsonb("photos").$type<VehiclePhoto[]>().notNull().default([]),
    /** Aus dem Verkehr gezogen — bleibt für abgeschlossene Tausche referenzierbar */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("vehicles_owner_idx").on(t.ownerId)],
);

export const listings = pgTable(
  "listings",
  {
    id: text("id").primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    wishMakes: jsonb("wish_makes").$type<string[]>().notNull().default([]),
    wishBodies: jsonb("wish_bodies").$type<Body[]>().notNull().default([]),
    wishFuels: jsonb("wish_fuels").$type<Fuel[]>().notNull().default([]),
    wishMinYear: integer("wish_min_year"),
    wishMaxMileageKm: integer("wish_max_mileage_km"),
    /** Positiv: bereit so viel zuzuzahlen. Negativ: erwartet mindestens so viel. */
    wishMaxCashOut: integer("wish_max_cash_out"),
    wishNotes: text("wish_notes"),
    askPremium: integer("ask_premium").notNull().default(0),
    views: integer("views").notNull().default(0),
    status: text("status")
      .$type<"aktiv" | "pausiert" | "in verhandlung" | "getauscht">()
      .notNull()
      .default("aktiv"),
    /**
     * Von der Betreiberin gesperrt. Getrennt vom Status, damit das Sperren
     * nicht mit «pausiert» verwechselt wird — der Besitzer darf ein
     * gesperrtes Inserat nicht einfach wieder aktivieren.
     */
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    blockedReason: text("blocked_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("listings_vehicle_key").on(t.vehicleId),
    index("listings_status_idx").on(t.status),
    index("listings_owner_idx").on(t.ownerId),
  ],
);

export type DealStatusDb =
  | "vorschlag"
  | "verhandlung"
  | "angenommen"
  | "treuhand"
  /** Beide haben bestätigt, das Geld wird gerade eingezogen und weitergeleitet. */
  | "abwicklung"
  | "abgeschlossen"
  | "abgelehnt"
  | "storniert";

export const deals = pgTable(
  "deals",
  {
    id: text("id").primaryKey(),
    /** Fahrzeug, das der Initiator abgibt */
    fromVehicleId: text("from_vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    /** Fahrzeug, das der Initiator erhält */
    toVehicleId: text("to_vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    initiatorId: text("initiator_id")
      .notNull()
      .references(() => users.id),
    counterpartyId: text("counterparty_id")
      .notNull()
      .references(() => users.id),
    /** Positiv: der Initiator zahlt. Negativ: der Initiator erhält. In Franken. */
    cashDelta: integer("cash_delta").notNull().default(0),
    status: text("status").$type<DealStatusDb>().notNull().default("vorschlag"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    escrowAt: timestamp("escrow_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    initiatorConfirmed: boolean("initiator_confirmed").notNull().default(false),
    counterpartyConfirmed: boolean("counterparty_confirmed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("deals_initiator_idx").on(t.initiatorId),
    index("deals_counterparty_idx").on(t.counterpartyId),
    index("deals_status_idx").on(t.status),
    // Abschluss, Zusage und Inseratsprüfung filtern nach Fahrzeug
    index("deals_from_vehicle_idx").on(t.fromVehicleId),
    index("deals_to_vehicle_idx").on(t.toVehicleId),
  ],
);

export type RingStatusDb =
  | "vorschlag"
  | "angenommen"
  | "treuhand"
  /** Alle drei haben bestätigt, das Geld wird gerade eingezogen und weitergeleitet. */
  | "abwicklung"
  | "abgeschlossen"
  | "abgelehnt"
  | "storniert";

/**
 * Ringtausch über drei Parteien. Anders als beim Zweiertausch gibt es keinen
 * Initiator und keine Gegenseite, sondern drei gleichrangige Teilnehmer — die
 * Rollen stehen in den Beinen (ring_legs).
 */
export const ringSwaps = pgTable(
  "ring_swaps",
  {
    id: text("id").primaryKey(),
    /** Wer den Ring vorgeschlagen hat. Nur für Anzeige und Systemnachrichten. */
    initiatorId: text("initiator_id")
      .notNull()
      .references(() => users.id),
    status: text("status").$type<RingStatusDb>().notNull().default("vorschlag"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    escrowAt: timestamp("escrow_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ring_swaps_status_idx").on(t.status)],
);

/**
 * Ein Bein des Rings: `userId` gibt `vehicleId` an `receiverId` ab und zahlt
 * `cash` in den Topf (positiv) oder bekommt daraus (negativ). Jede Person
 * kommt genau einmal als Geber und einmal als Empfänger vor, die Summe aller
 * `cash` ist null — beides wird beim Anlegen geprüft.
 */
export const ringLegs = pgTable(
  "ring_legs",
  {
    id: text("id").primaryKey(),
    ringId: text("ring_id")
      .notNull()
      .references(() => ringSwaps.id, { onDelete: "cascade" }),
    /** 0, 1, 2 — die Reihenfolge im Ring, und damit auch die Anzeigereihenfolge. */
    position: smallint("position").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    /** Wer dieses Fahrzeug bekommt. */
    receiverId: text("receiver_id")
      .notNull()
      .references(() => users.id),
    /** Positiv: zahlt in den Topf. Negativ: bekommt aus dem Topf. In Franken. */
    cash: integer("cash").notNull().default(0),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ring_legs_position_key").on(t.ringId, t.position),
    // Niemand ist zweimal im selben Ring, und kein Fahrzeug steht doppelt drin.
    uniqueIndex("ring_legs_user_key").on(t.ringId, t.userId),
    uniqueIndex("ring_legs_vehicle_key").on(t.ringId, t.vehicleId),
    index("ring_legs_user_idx").on(t.userId),
    index("ring_legs_vehicle_idx").on(t.vehicleId),
  ],
);

/**
 * Verlauf zu einem Vorgang. Eine Nachricht gehört entweder zu einem
 * Zweiertausch oder zu einem Ring — nie zu beidem und nie zu keinem, dafür
 * sorgt die Prüfbedingung.
 */
export const dealMessages = pgTable(
  "deal_messages",
  {
    id: text("id").primaryKey(),
    dealId: text("deal_id").references(() => deals.id, { onDelete: "cascade" }),
    ringId: text("ring_id").references(() => ringSwaps.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    offerCash: integer("offer_cash"),
    /** Systemnachrichten (Statuswechsel) werden anders dargestellt */
    system: boolean("system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("deal_messages_deal_idx").on(t.dealId, t.createdAt),
    index("deal_messages_ring_idx").on(t.ringId, t.createdAt),
    check("deal_messages_owner_check", sql`num_nonnulls(${t.dealId}, ${t.ringId}) = 1`),
  ],
);

export type PaymentStatus =
  | "erstellt"
  | "autorisiert"
  | "eingezogen"
  | "ausgezahlt"
  | "storniert"
  | "erstattet"
  | "fehlgeschlagen";

export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    /** Gesetzt bei einem Zweiertausch — dann ist ringId leer, und umgekehrt. */
    dealId: text("deal_id").references(() => deals.id, { onDelete: "cascade" }),
    ringId: text("ring_id").references(() => ringSwaps.id, { onDelete: "cascade" }),
    payerId: text("payer_id")
      .notNull()
      .references(() => users.id),
    payeeId: text("payee_id")
      .notNull()
      .references(() => users.id),
    /** Betrag in Rappen, der beim Empfänger ankommt */
    amountMinor: integer("amount_minor").notNull(),
    /** Aufschlag in Rappen, den der Zahlende zusätzlich trägt (Stripe-Gebühr) */
    feeMinor: integer("fee_minor").notNull().default(0),
    currency: text("currency").notNull().default("chf"),
    status: text("status").$type<PaymentStatus>().notNull().default("erstellt"),
    stripeSessionId: text("stripe_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeTransferId: text("stripe_transfer_id"),
    /** Zeitpunkt der Reservierung — Stripe lässt sie nach sieben Tagen verfallen. */
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    /**
     * Rückbuchung: die Bank des Zahlenden holt sich das Geld zurück.
     *
     * Eine eigene Spalte und kein Status, weil beides gleichzeitig gilt: eine
     * Zahlung kann längst ausgezahlt und trotzdem angefochten sein. Als Status
     * geschrieben ginge der Abwicklungsstand verloren — und damit die Angabe,
     * ob das Geld überhaupt schon beim Empfänger war.
     */
    disputedAt: timestamp("disputed_at", { withTimezone: true }),
    /** Stand bei Stripe: needs_response, under_review, won, lost … */
    disputeStatus: text("dispute_status"),
    /** Angefochtener Betrag in Rappen — kann kleiner sein als der ganze. */
    disputeAmountMinor: integer("dispute_amount_minor"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payments_deal_idx").on(t.dealId),
    index("payments_ring_idx").on(t.ringId),
    uniqueIndex("payments_session_key").on(t.stripeSessionId),
    uniqueIndex("payments_intent_key").on(t.stripePaymentIntentId),
    check("payments_owner_check", sql`num_nonnulls(${t.dealId}, ${t.ringId}) = 1`),
  ],
);

/**
 * Ein Fahrzeug darf nur in einem einzigen verbindlichen Tausch stecken. Der
 * Primärschlüssel auf der Fahrzeug-ID erzwingt das in der Datenbank — zwei
 * gleichzeitige Zusagen können sich damit nicht gegenseitig überholen.
 */
export const dealVehicleLocks = pgTable(
  "deal_vehicle_locks",
  {
    vehicleId: text("vehicle_id")
      .primaryKey()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    dealId: text("deal_id").references(() => deals.id, { onDelete: "cascade" }),
    ringId: text("ring_id").references(() => ringSwaps.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("deal_vehicle_locks_deal_idx").on(t.dealId),
    index("deal_vehicle_locks_ring_idx").on(t.ringId),
    check("deal_vehicle_locks_owner_check", sql`num_nonnulls(${t.dealId}, ${t.ringId}) = 1`),
  ],
);

/** Verarbeitete Stripe-Ereignisse, damit Webhooks idempotent bleiben. */
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Fehlgeschlagene Mailversuche.
 *
 * Der Versand ist die stillste Stelle der Anwendung: Lehnt Resend ab — Domain
 * nicht verifiziert, Schlüssel zurückgezogen, Kontingent aufgebraucht —, läuft
 * alles andere weiter. Die Registrierung meldet Erfolg, nur bekommt niemand
 * mehr eine Bestätigung, und wer sein Passwort vergisst, kommt nicht ins Konto.
 * Bisher stand das ausschliesslich im Server-Log, und der tägliche Lagebericht
 * kann es nicht melden — er ist ja selbst eine Mail.
 *
 * Gespeichert wird die Empfängerdomain, nicht die Adresse: für die Diagnose
 * («alles an gmail.com scheitert» gegen «alles scheitert») reicht sie, und der
 * Rest wäre ein Personendatum in einem Fehlerprotokoll.
 */
export const mailFailures = pgTable(
  "mail_failures",
  {
    id: text("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    domain: text("domain").notNull(),
    subject: text("subject").notNull(),
    reason: text("reason").notNull(),
    /**
     * Liegt es an uns oder an dieser einen Adresse?
     *
     * Ein zurückgezogener Schlüssel, ein abgelaufenes Kontingent oder ein
     * ausgefallener Dienst trifft jede Mail — eine abgewiesene Empfängeradresse
     * nur diese eine. Nur das Erste ist ein Betriebsausfall, und nur dafür darf
     * die Betriebsprüfung Alarm schlagen. Ohne die Unterscheidung könnte sich
     * jeder mit drei Anmeldungen an erfundene Adressen ein 503 der ganzen
     * Anwendung erzeugen.
     */
    systemic: boolean("systemic").notNull().default(false),
  },
  (t) => [index("mail_failures_created_at_idx").on(t.createdAt)],
);

export const watchlist = pgTable(
  "watchlist",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.listingId] })],
);

/**
 * Welcher Person welches Inserat schon als Treffer gemeldet wurde.
 *
 * Ohne diese Zeilen käme derselbe Treffer jeden Tag erneut per Mail. Der
 * Schlüssel steht auf (Person, Inserat) und nicht auf dem eigenen Fahrzeug:
 * ein Inserat ist eine Nachricht wert, nicht drei, nur weil jemand drei Autos
 * eingestellt hat.
 */
export const matchNotices = pgTable(
  "match_notices",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.listingId] })],
);

export type ReportReason =
  | "betrugsverdacht"
  | "falsche angaben"
  | "verbotenes fahrzeug"
  | "beleidigend"
  | "anderes";

/**
 * Meldungen zu Inseraten. Auf einem Marktplatz, auf dem sich Fremde ein Auto
 * übergeben, ist das der einzige Weg, auf dem ein Verdacht überhaupt bei der
 * Betreiberin ankommt.
 */
export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").$type<ReportReason>().notNull(),
    note: text("note"),
    status: text("status").$type<"offen" | "geprüft">().notNull().default("offen"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reports_status_idx").on(t.status),
    // Dieselbe Person meldet dasselbe Inserat nicht zweimal.
    uniqueIndex("reports_listing_reporter_key").on(t.listingId, t.reporterId),
  ],
);

/**
 * Bewertungen nach abgeschlossenem Tausch. Im Zweiertausch bewertet jede Seite
 * genau eine andere Person, im Ring jede zwei — deshalb greift dort ein
 * eigener Eindeutigkeitsschlüssel über die bewertete Person.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    dealId: text("deal_id").references(() => deals.id, { onDelete: "cascade" }),
    ringId: text("ring_id").references(() => ringSwaps.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: text("subject_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stars: real("stars").notNull(),
    body: text("body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Postgres behandelt NULL-Werte in eindeutigen Indizes als verschieden:
    // Ringbewertungen (deal_id ist leer) laufen hier nicht auf.
    uniqueIndex("reviews_deal_author_key").on(t.dealId, t.authorId),
    uniqueIndex("reviews_ring_author_key").on(t.ringId, t.authorId, t.subjectId),
    index("reviews_subject_idx").on(t.subjectId),
    check("reviews_owner_check", sql`num_nonnulls(${t.dealId}, ${t.ringId}) = 1`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type VehicleRow = typeof vehicles.$inferSelect;
export type ListingRow = typeof listings.$inferSelect;
export type DealRow = typeof deals.$inferSelect;
export type DealMessageRow = typeof dealMessages.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type DealVehicleLockRow = typeof dealVehicleLocks.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;
export type RingSwapRow = typeof ringSwaps.$inferSelect;
export type RingLegRow = typeof ringLegs.$inferSelect;
