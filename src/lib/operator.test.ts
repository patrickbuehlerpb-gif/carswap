import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { missingOperatorFields, operator, operatorComplete } from "@/lib/operator-daten";

/**
 * Die Angaben zur Betreiberin stehen im Impressum, in den AGB und in der
 * Datenschutzerklärung. Sie sind rechtlich verbindlich — hier steht deshalb
 * schwarz auf weiss, was die Anwendung ausgibt, damit ein Tippfehler nicht
 * unbemerkt auf drei Rechtsseiten landet.
 *
 * Quelle ist der beglaubigte Auszug des Handelsregisteramts des Kantons
 * Zürich vom 29.04.2024.
 */

const SCHLUESSEL = [
  "OPERATOR_NAME",
  "OPERATOR_LEGAL_FORM",
  "OPERATOR_ADDRESS",
  "OPERATOR_UID",
  "OPERATOR_REGISTER",
  "OPERATOR_EMAIL",
  "OPERATOR_PHONE",
];

const gemerkt: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of SCHLUESSEL) {
    gemerkt[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  // `process.env.X = undefined` schriebe die Zeichenkette "undefined" hinein.
  for (const k of SCHLUESSEL) {
    if (gemerkt[k] === undefined) delete process.env[k];
    else process.env[k] = gemerkt[k];
  }
});

describe("Angaben zur Betreiberin", () => {
  it("nennt ohne Umgebung die Angaben aus dem Handelsregister", () => {
    const op = operator();
    expect(op.name).toBe("HMZ craftsmanship GmbH");
    expect(op.legalForm).toBe("Gesellschaft mit beschränkter Haftung (GmbH)");
    expect(op.address).toBe("c/o SpaceP5 GmbH, Heinrichstrasse 267, 8005 Zürich");
    expect(op.uid).toBe("CHE-352.722.533");
    expect(op.register).toBe("Handelsregister des Kantons Zürich");
  });

  it("rät keine Kontaktadresse", () => {
    // Sie steht in keinem Registerauszug. Eine erfundene Adresse im Impressum
    // wäre schlimmer als eine fehlende: Sie sähe vollständig aus, und die
    // Post käme nie an.
    expect(operator().email).toBeUndefined();
    expect(missingOperatorFields()).toEqual(["Kontaktadresse"]);
    expect(operatorComplete()).toBe(false);
  });

  it("ist vollständig, sobald die Kontaktadresse dazukommt", () => {
    process.env.OPERATOR_EMAIL = "kontakt@autotauschen.app";
    expect(missingOperatorFields()).toEqual([]);
    expect(operatorComplete()).toBe(true);
  });

  it("lässt sich von der Umgebung übersteuern", () => {
    // Für eine zweite Installation unter anderem Betreiber — und damit sich
    // eine falsche Angabe sofort korrigieren lässt, ohne auf ein Deployment
    // zu warten.
    process.env.OPERATOR_NAME = "Andere Firma AG";
    process.env.OPERATOR_UID = "CHE-111.111.111";
    const op = operator();
    expect(op.name).toBe("Andere Firma AG");
    expect(op.uid).toBe("CHE-111.111.111");
    // Was nicht übersteuert wurde, bleibt aus dem Register.
    expect(op.address).toBe("c/o SpaceP5 GmbH, Heinrichstrasse 267, 8005 Zürich");
  });

  it("nimmt eine leere Umgebungsvariable nicht als Angabe", () => {
    // Ein leeres Feld in der Weboberfläche des Anbieters darf die
    // Registerangabe nicht durch nichts ersetzen.
    process.env.OPERATOR_NAME = "   ";
    expect(operator().name).toBe("HMZ craftsmanship GmbH");
  });
});
