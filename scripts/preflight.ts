import { readdirSync } from "node:fs";
import { sql as raw } from "drizzle-orm";
import { connect, databaseUrl } from "./db-connect";

/**
 * Startklar-Prüfung vor dem Livegang.
 *
 * Beantwortet eine Frage: Was fehlt noch, damit echte Menschen die Plattform
 * benutzen können? Jede Zeile nennt die Folge, nicht nur den fehlenden Namen —
 * «RESEND_API_KEY fehlt» hilft niemandem, «niemand kann sein Passwort
 * zurücksetzen» schon.
 */
type Grad = "ok" | "warnung" | "fehler";

interface Befund {
  grad: Grad;
  titel: string;
  folge?: string;
  hinweis?: string;
}

const befunde: Befund[] = [];

function pruefe(bedingung: boolean, titel: string, wennFehlt: Omit<Befund, "titel" | "grad"> & { grad: Grad }) {
  befunde.push(bedingung ? { grad: "ok", titel } : { ...wennFehlt, titel });
}

function gesetzt(...namen: string[]): boolean {
  return namen.some((n) => Boolean(process.env[n]?.trim()));
}

async function main() {
  /* ---------------- Datenbank ---------------- */

  if (!databaseUrl()) {
    befunde.push({
      grad: "fehler",
      titel: "Datenbank",
      folge: "Ohne Datenbank läuft keine einzige Seite.",
      hinweis: "DATABASE_URL oder POSTGRES_URL setzen.",
    });
  } else {
    const { db, sql } = connect();
    try {
      const angewendet = await db
        .execute(raw`select count(*)::int as n from drizzle.__drizzle_migrations`)
        .then((r) => Number((r as unknown as Array<{ n: number }>)[0]?.n ?? 0))
        .catch(() => 0);
      const vorhanden = readdirSync("drizzle").filter((f) => f.endsWith(".sql")).length;

      befunde.push({ grad: "ok", titel: "Datenbank erreichbar" });
      pruefe(angewendet >= vorhanden, `Migrationen (${angewendet}/${vorhanden})`, {
        grad: "fehler",
        folge: "Das Schema ist älter als der Code — Abfragen scheitern zur Laufzeit.",
        hinweis: "npm run db:migrate",
      });
    } catch (err) {
      befunde.push({
        grad: "fehler",
        titel: "Datenbank erreichbar",
        folge: err instanceof Error ? err.message.slice(0, 160) : "Verbindung fehlgeschlagen.",
      });
    } finally {
      await sql.end();
    }
  }

  /* ---------------- Zahlungen ---------------- */

  pruefe(gesetzt("STRIPE_SECRET_KEY"), "Stripe-Schlüssel", {
    grad: "fehler",
    folge: "Tausche mit Wertdifferenz sind nicht möglich — nur wertgleiche gehen durch.",
    hinweis: "STRIPE_SECRET_KEY setzen.",
  });
  pruefe(gesetzt("STRIPE_WEBHOOK_SECRET"), "Stripe-Webhook", {
    grad: "fehler",
    folge:
      "Eine Einzahlung kommt nie in der Anwendung an: der Tausch bleibt auf «angenommen» stehen, " +
      "obwohl bezahlt wurde.",
    hinweis: "STRIPE_WEBHOOK_SECRET aus dem Ereignisziel setzen.",
  });
  if (process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    befunde.push({
      grad: "warnung",
      titel: "Stripe läuft im Testmodus",
      folge: "Echte Karten werden nicht belastet.",
      hinweis: "Für den Livegang den Live-Schlüssel eintragen.",
    });
  }

  /* ---------------- Mail ---------------- */

  pruefe(gesetzt("RESEND_API_KEY") && gesetzt("MAIL_FROM"), "Mailversand", {
    grad: "fehler",
    folge:
      "Keine Bestätigungs- und Reset-Mails. Wer sein Passwort vergisst, kommt nicht mehr ins " +
      "Konto, und die Pflicht zur bestätigten Adresse entfällt.",
    hinweis: "RESEND_API_KEY und MAIL_FROM setzen.",
  });

  /* ---------------- Adressen und Speicher ---------------- */

  pruefe(gesetzt("SITE_URL", "NEXT_PUBLIC_SITE_URL", "VERCEL_PROJECT_PRODUCTION_URL"), "Basisadresse", {
    grad: "fehler",
    folge: "Links in E-Mails und die Rücksprungadressen von Stripe zeigen auf localhost.",
    hinweis: "SITE_URL setzen.",
  });
  pruefe(gesetzt("BLOB_READ_WRITE_TOKEN"), "Fotospeicher", {
    grad: "warnung",
    folge: "Inserate lassen sich anlegen, aber ohne Fotos.",
    hinweis: "Vercel Blob verbinden (BLOB_READ_WRITE_TOKEN).",
  });

  /* ---------------- Recht ---------------- */

  const pflicht: Array<[string, string]> = [
    ["OPERATOR_NAME", "Firmenname"],
    ["OPERATOR_LEGAL_FORM", "Rechtsform"],
    ["OPERATOR_ADDRESS", "Adresse"],
    ["OPERATOR_UID", "UID/MWST-Nummer"],
    ["OPERATOR_EMAIL", "Kontaktadresse"],
  ];
  const fehlend = pflicht.filter(([n]) => !gesetzt(n)).map(([, bez]) => bez);
  pruefe(fehlend.length === 0, "Impressum", {
    grad: "fehler",
    folge: `Es fehlen: ${fehlend.join(", ")}. Ohne diese Angaben ist der Betrieb in der Schweiz nicht zulässig (Art. 3 Abs. 1 lit. s UWG).`,
    hinweis: "OPERATOR_* setzen.",
  });
  pruefe(gesetzt("OPERATOR_EMAIL"), "Empfänger für Meldungen", {
    grad: "warnung",
    folge: "Meldungen zu Inseraten landen nur in der Datenbank, niemand wird benachrichtigt.",
    hinweis: "OPERATOR_EMAIL setzen.",
  });

  /* ---------------- Betrieb ---------------- */

  pruefe(gesetzt("HEALTH_TOKEN"), "Betriebsprüfung", {
    grad: "warnung",
    folge: "/api/health gibt in Produktion keine Details heraus — auch nicht an dein Monitoring.",
    hinweis: "HEALTH_TOKEN setzen und als Bearer-Token mitschicken.",
  });

  /* ---------------- Ausgabe ---------------- */

  const zeichen: Record<Grad, string> = { ok: "✓", warnung: "!", fehler: "✗" };
  const fehler = befunde.filter((b) => b.grad === "fehler");
  const warnungen = befunde.filter((b) => b.grad === "warnung");

  console.log("\nquitt — startklar?\n");
  for (const b of befunde) {
    console.log(`  ${zeichen[b.grad]} ${b.titel}`);
    if (b.folge) console.log(`      ${b.folge}`);
    if (b.hinweis) console.log(`      → ${b.hinweis}`);
  }

  console.log("");
  if (fehler.length) {
    console.log(
      `${fehler.length} Punkt(e) blockieren den Livegang, ${warnungen.length} Hinweis(e).\n`,
    );
    process.exit(1);
  }
  console.log(
    warnungen.length
      ? `Startklar — mit ${warnungen.length} Hinweis(en).\n`
      : "Startklar.\n",
  );
}

main().catch((err) => {
  console.error("Prüfung fehlgeschlagen:", err);
  process.exit(1);
});
