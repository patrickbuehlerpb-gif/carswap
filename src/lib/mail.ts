import "server-only";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Steckbarer Mailversand. Mit gesetztem RESEND_API_KEY geht die Nachricht
 * über Resend raus; ohne Schlüssel landet sie im Server-Log, damit sich der
 * Ablauf lokal vollständig durchspielen lässt.
 */
export async function sendMail(mail: Mail): Promise<{ delivered: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  if (!key || !from) {
    // Der Text enthält Bestätigungs- und Passwort-Links. Im Log wären sie für
    // jeden lesbar, der Zugriff auf die Protokolle hat — in Produktion also
    // nur die Tatsache vermerken, nicht den Inhalt.
    if (process.env.NODE_ENV === "production") {
      console.error(
        `[mail] Kein RESEND_API_KEY/MAIL_FROM gesetzt — «${mail.subject}» wurde NICHT zugestellt.`,
      );
    } else {
      console.info(
        `[mail] Kein RESEND_API_KEY/MAIL_FROM gesetzt — Nachricht nicht versendet.\n` +
          `  An:      ${mail.to}\n  Betreff: ${mail.subject}\n${mail.text}`,
      );
    }
    return { delivered: false, reason: "kein Mailversand konfiguriert" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      // Ohne Frist blockiert ein hängender Aufruf die ganze Server Action —
      // etwa die Registrierung — bis zum Timeout der Plattform.
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("[mail] Resend hat abgelehnt:", res.status, detail.slice(0, 400));
      await vermerkeFehler(mail, `abgelehnt (${res.status})`);
      return { delivered: false, reason: `Mailversand fehlgeschlagen (${res.status})` };
    }
    return { delivered: true };
  } catch (err) {
    console.error("[mail] Netzwerkfehler:", err);
    await vermerkeFehler(mail, "nicht erreichbar");
    return { delivered: false, reason: "Mailserver nicht erreichbar" };
  }
}

/**
 * Hält einen gescheiterten Versuch fest, damit ihn jemand sieht.
 *
 * Das Server-Log allein reicht hier nicht: Wenn der Versand klemmt, meldet die
 * Registrierung weiterhin Erfolg, nur kommt nie eine Bestätigung an — und der
 * tägliche Lagebericht kann es nicht melden, weil er selbst eine Mail ist.
 * Gelesen wird die Tabelle von /api/health, der Betriebsübersicht und dem
 * Lagebericht.
 *
 * Nur der konfigurierte Fall kommt hierher. Ein fehlender Schlüssel ist kein
 * Fehlversuch, sondern ein Einrichtungszustand — den melden preflight und
 * /api/health längst, und lokal wäre jede Mail ein Eintrag.
 *
 * Gespeichert wird die Domain, nicht die Adresse: «alles an gmail.com
 * scheitert» gegen «alles scheitert» ist der Unterschied, auf den es bei der
 * Diagnose ankommt. Die volle Adresse wäre ein Personendatum in einem
 * Fehlerprotokoll, das niemand braucht.
 *
 * Die Importe stehen absichtlich in der Funktion: `siteUrl()` aus dieser Datei
 * braucht auch die Sitemap, und die soll nicht bei jedem Aufruf den
 * Datenbanktreiber mitladen.
 *
 * Scheitert das Schreiben selbst, bleibt es beim Log. Ein Fehler beim
 * Vermerken eines Fehlers darf den Aufrufer nicht umwerfen — sonst bricht die
 * Registrierung ausgerechnet dann ab, wenn ohnehin schon etwas klemmt.
 */
async function vermerkeFehler(mail: Mail, grund: string): Promise<void> {
  try {
    const { db } = await import("./db");
    const { mailFailures } = await import("./db/schema");
    const { newId } = await import("./db/ids");
    await db.insert(mailFailures).values({
      id: newId("mfl"),
      domain: mail.to.split("@").pop()?.toLowerCase() ?? "unbekannt",
      subject: mail.subject.slice(0, 200),
      reason: grund,
    });
  } catch (err) {
    console.error("[mail] Fehlversuch liess sich nicht vermerken:", err);
  }
}

/**
 * Basis-URL der Anwendung, für Links in E-Mails, Stripe-Weiterleitungen,
 * robots.txt und Sitemap.
 *
 * Wird ausschliesslich serverseitig gelesen, deshalb ist `SITE_URL` die
 * richtige Schreibweise. `NEXT_PUBLIC_SITE_URL` bleibt als Rückfallebene
 * bestehen, damit vorhandene Installationen weiterlaufen — das Präfix würde
 * den Wert allerdings unnötig in das Browser-Bundle schreiben.
 */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) {
    const ohneSchraegstrich = explicit.replace(/\/+$/, "");
    // Ein Tippfehler — «autotauschen.app» statt «https://autotauschen.app» — darf nicht die
    // ganze Seite umwerfen. Die Adresse steckt inzwischen auch in
    // metadataBase, und ein ungültiger Wert würde dort beim Rendern werfen.
    if (istAbsolut(ohneSchraegstrich)) return ohneSchraegstrich;
    if (!warnedAboutSiteUrl) {
      warnedAboutSiteUrl = true;
      console.error(
        `[config] SITE_URL ist keine vollständige Adresse: «${explicit}». ` +
          "Erwartet wird etwas wie https://autotauschen.app — bis dahin wird localhost verwendet.",
      );
    }
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.NODE_ENV === "production" && !warnedAboutSiteUrl) {
    warnedAboutSiteUrl = true;
    console.error(
      "[config] Weder SITE_URL noch VERCEL_PROJECT_PRODUCTION_URL gesetzt — Links in E-Mails " +
        "und die Rücksprungadressen von Stripe zeigen auf localhost.",
    );
  }
  return "http://localhost:3000";
}

/** Kann diese Installation überhaupt E-Mails verschicken? */
export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

/** Ist die Basis-URL überhaupt konfiguriert? Für die Betriebsprüfung. */
export function siteUrlConfigured(): boolean {
  const explicit = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  // Eine ungültige Adresse ist so gut wie keine — sonst meldete die
  // Betriebsprüfung «konfiguriert», während alle Links auf localhost zeigen.
  if (explicit) return istAbsolut(explicit.replace(/\/+$/, ""));
  return Boolean(process.env.VERCEL_PROJECT_PRODUCTION_URL);
}

function istAbsolut(wert: string): boolean {
  try {
    const url = new URL(wert);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

let warnedAboutSiteUrl = false;
