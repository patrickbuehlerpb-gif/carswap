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
    console.info(
      `[mail] Kein RESEND_API_KEY/MAIL_FROM gesetzt — Nachricht nicht versendet.\n` +
        `  An:      ${mail.to}\n  Betreff: ${mail.subject}\n${mail.text}`,
    );
    return { delivered: false, reason: "kein Mailversand konfiguriert" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
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
      return { delivered: false, reason: `Mailversand fehlgeschlagen (${res.status})` };
    }
    return { delivered: true };
  } catch (err) {
    console.error("[mail] Netzwerkfehler:", err);
    return { delivered: false, reason: "Mailserver nicht erreichbar" };
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
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3000";
}
