import "server-only";
import { and, eq, isNotNull, isNull, lt, sql as raw } from "drizzle-orm";
import { db } from "./db";
import { deals, payments, reports, ringSwaps } from "./db/schema";
import { sendMail, siteUrl } from "./mail";
import { operator } from "./operator";
import { mailFehler, type NachgeholteAbschluesse } from "./wartung";

/**
 * Der tägliche Blick auf den Betrieb — als Mail statt als Seite, die jemand
 * aufrufen muss.
 *
 * Der Wartungslauf misst inzwischen alles Wichtige, aber die Zahlen sieht nur,
 * wer /admin/betrieb öffnet. Eine Rückbuchung mit einer Frist, Geld auf dem
 * Plattformkonto, ein Abschluss, der nicht durchläuft: all das wartet sonst
 * darauf, dass jemand zufällig nachschaut.
 *
 * Geschickt wird nur, wenn wirklich etwas zu tun ist. Eine tägliche
 * «alles in Ordnung»-Mail liest nach einer Woche niemand mehr — und dann geht
 * auch die eine unter, die zählt.
 */

export interface Punkt {
  /** Kurz, für die Betreffzeile. */
  kurz: string;
  /** Was zu tun ist. */
  text: string;
}

export interface Lagebericht {
  punkte: Punkt[];
  verschickt: boolean;
  /** Warum nicht verschickt wurde, falls nicht. */
  grund?: "nichts zu melden" | "keine Empfängeradresse";
}

const TAG_MS = 24 * 60 * 60 * 1000;
/** Ab wann ein offener Vorgang als liegengeblieben gilt. */
const ALTER_TAGE = 3;

function chf(minor: number): string {
  return `${(minor / 100).toFixed(2)} CHF`;
}

/**
 * Sammelt die Punkte, ohne etwas zu verschicken.
 *
 * Getrennt vom Versand, weil sonst jeder Blick auf die Lage eine Mail
 * auslösen würde — der Health-Check zum Beispiel wird von einem Monitoring
 * im Minutentakt abgefragt.
 */
export async function sammlePunkte(abschluesse?: NachgeholteAbschluesse): Promise<Punkt[]> {
  const punkte: Punkt[] = [];

  // 1. Rückbuchungen. Die haben eine Frist und stehen deshalb zuoberst.
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
  if (angefochten.anzahl > 0) {
    punkte.push({
      kurz: `${angefochten.anzahl} Rückbuchung(en)`,
      text:
        `${angefochten.anzahl} Rückbuchung(en) über ${chf(angefochten.summe)} sind offen. ` +
        "Der Betrag ist bereits vom Plattformkonto abgezogen. Ohne fristgerechte Stellungnahme " +
        "im Stripe-Dashboard bleibt er weg.",
    });
  }

  // 2. Geld, das eingezogen und nicht weitergeleitet ist.
  const [liegen] = await db
    .select({
      anzahl: raw<number>`count(*)::int`,
      summe: raw<number>`coalesce(sum(${payments.amountMinor}), 0)::int`,
    })
    .from(payments)
    .where(and(eq(payments.status, "eingezogen"), isNull(payments.stripeTransferId)));
  if (liegen.anzahl > 0) {
    punkte.push({
      kurz: `${chf(liegen.summe)} liegen`,
      text:
        `${liegen.anzahl} Zahlung(en) über ${chf(liegen.summe)} sind eingezogen, aber nicht ` +
        "weitergeleitet. Der nächtliche Lauf versucht es erneut; bleibt es stehen, fehlt der " +
        "Gegenseite das Auszahlungskonto oder es braucht einen Menschen.",
    });
  }

  // 3. Was der Lauf gerade nicht heilen konnte.
  if (abschluesse && abschluesse.festgefahren > 0) {
    punkte.push({
      kurz: `${abschluesse.festgefahren} Abschluss/Abschlüsse hängen`,
      text:
        `${abschluesse.festgefahren} Abschluss/Abschlüsse liessen sich im heutigen Lauf nicht ` +
        "durchbringen. Die Autos sind nicht umgeschrieben. Einzelheiten stehen im Log.",
    });
  }

  // 4. Vorgänge, die seit Tagen in der Treuhandphase feststecken. Die
  //    Kartenreservierung verfällt nach sieben Tagen — danach muss neu
  //    eingezahlt werden, und das ärgert beide Seiten.
  const grenze = new Date(Date.now() - ALTER_TAGE * TAG_MS);
  const [alteDeals] = await db
    .select({ n: raw<number>`count(*)::int` })
    .from(deals)
    .where(and(eq(deals.status, "treuhand"), lt(deals.escrowAt, grenze)));
  const [alteRinge] = await db
    .select({ n: raw<number>`count(*)::int` })
    .from(ringSwaps)
    .where(and(eq(ringSwaps.status, "treuhand"), lt(ringSwaps.escrowAt, grenze)));
  const alt = alteDeals.n + alteRinge.n;
  if (alt > 0) {
    punkte.push({
      kurz: `${alt} Vorgang/Vorgänge warten`,
      text:
        `${alt} Vorgang/Vorgänge stehen seit mehr als ${ALTER_TAGE} Tagen mit hinterlegtem Geld ` +
        "in der Treuhandphase. Die Kartenreservierung verfällt nach sieben Tagen — danach muss " +
        "neu eingezahlt werden.",
    });
  }

  // 5. Gescheiterter Mailversand. Steht bewusst in diesem Bericht, obwohl er
  //    selbst eine Mail ist: Scheitert der Versand nur an einzelnen Domains,
  //    kommt die Meldung durch — und dann ist sie die einzige Chance, es
  //    überhaupt zu erfahren. Scheitert er ganz, meldet /api/health es.
  //
  //    Dass der Bericht damit auch sein eigenes Scheitern zählen kann, ist in
  //    Kauf genommen: Bounct die Adresse der Betreiberin, gibt es täglich
  //    einen Versuch, der wieder scheitert und den Punkt neu setzt. Das kostet
  //    eine Anfrage pro Tag. Die Alternative wäre, Fehler an die eigene
  //    Adresse auszublenden — und damit ausgerechnet die zu verschweigen, die
  //    den einzigen Meldeweg betreffen.
  const mails = await mailFehler(24);
  if (mails.anzahl > 0) {
    punkte.push({
      kurz: `${mails.anzahl} Mail(s) nicht zugestellt`,
      text:
        `${mails.anzahl} Mailversuch(e) sind in den letzten 24 Stunden gescheitert ` +
        `(zuletzt: ${mails.letzterGrund}; betroffen: ${mails.domains.join(", ")}). ` +
        "Solange das anhält, bekommt niemand eine Bestätigung, und wer sein Passwort " +
        "vergisst, kommt nicht mehr ins Konto.",
    });
  }

  // 6. Gemeldete Inserate, die niemand angesehen hat.
  const [meldungen] = await db
    .select({ n: raw<number>`count(*)::int` })
    .from(reports)
    .where(eq(reports.status, "offen"));
  if (meldungen.n > 0) {
    punkte.push({
      kurz: `${meldungen.n} Meldung(en) offen`,
      text: `${meldungen.n} gemeldete(s) Inserat(e) warten auf eine Entscheidung.`,
    });
  }

  return punkte;
}

/** Sammelt die Punkte und schickt sie, wenn es welche gibt. */
export async function erstelleLagebericht(
  abschluesse?: NachgeholteAbschluesse,
): Promise<Lagebericht> {
  const punkte = await sammlePunkte(abschluesse);
  if (!punkte.length) return { punkte, verschickt: false, grund: "nichts zu melden" };

  const empfaenger = operator().email;
  if (!empfaenger) {
    console.error(
      `[lagebericht] ${punkte.length} Punkt(e) zu melden, aber OPERATOR_EMAIL ist nicht gesetzt.`,
    );
    return { punkte, verschickt: false, grund: "keine Empfängeradresse" };
  }

  await sendMail({
    to: empfaenger,
    subject: `autotauschen: ${punkte.map((p) => p.kurz).join(", ")}`,
    text:
      "Guten Morgen\n\nDiese Punkte brauchen heute deine Aufmerksamkeit:\n\n" +
      punkte.map((p) => `• ${p.text}`).join("\n\n") +
      `\n\nÜbersicht: ${siteUrl()}/admin/betrieb\n\n` +
      "Diese Nachricht kommt nur, wenn etwas zu tun ist.\n",
  });
  return { punkte, verschickt: true };
}

