import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./security-headers";

/**
 * Die Richtlinie ist an mehreren Stellen mühsam erarbeitet worden. Ohne
 * Prüfung rutscht sie zurück: ein `'unsafe-inline'` in `script-src` ist schnell
 * eingefügt, wenn irgendein Skript nicht läuft — und macht den ganzen Schutz
 * wertlos, ohne dass irgendetwas sichtbar kaputtgeht.
 */
describe("Sicherheitsrichtlinie", () => {
  const csp = contentSecurityPolicy("abc123");

  /*
   * Fehlt die Direktive, muss die Prüfung scheitern und nicht stillschweigend
   * bestehen: Ein `expect("").not.toContain("'unsafe-inline'")` ist grün,
   * gerade wenn jemand `script-src` umbenannt oder entfernt hat — also genau
   * dann, wenn diese Datei etwas hätte merken sollen.
   */
  function teil(name: string): string {
    const gefunden = csp.split("; ").find((d) => d.startsWith(`${name} `));
    if (!gefunden) throw new Error(`Die Richtlinie hat keine Direktive «${name}»: ${csp}`);
    return gefunden;
  }

  it("gibt jeder Antwort ihre Nonce mit", () => {
    expect(teil("script-src")).toContain("'nonce-abc123'");
  });

  it("erlaubt keine eingebetteten Skripte", () => {
    expect(teil("script-src")).not.toContain("'unsafe-inline'");
    expect(teil("script-src")).not.toContain("'unsafe-eval'");
  });

  it("lässt keine Schriften von fremden Hosts holen", () => {
    // next/font lädt sie beim Bauen; zur Laufzeit erfährt niemand, wer die
    // Seite aufruft.
    expect(csp).not.toContain("googleapis");
    expect(csp).not.toContain("gstatic");
  });

  it("verbietet das Einbetten in fremde Seiten und fremde Formularziele", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(teil("form-action")).toBe("form-action 'self' https://checkout.stripe.com");
  });

  it("lässt Zahlungen und Fotos durch — sonst nichts", () => {
    expect(teil("connect-src")).toContain("https://api.stripe.com");
    expect(teil("img-src")).toContain("blob.vercel-storage.com");
    expect(teil("default-src")).toBe("default-src 'self'");
    expect(teil("object-src")).toBe("object-src 'none'");
  });
});
