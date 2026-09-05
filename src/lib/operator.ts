import "server-only";

/**
 * Angaben zur Betreiberin. Sie stehen bewusst in der Umgebung und nicht im
 * Code: Firmenname, Adresse und UID sind rechtlich verbindlich und dürfen
 * nicht aus einem Platzhalter im Repository stammen.
 *
 * Fehlen sie, sagen Impressum, AGB und Datenschutzerklärung offen, dass sie
 * unvollständig sind — statt eine vollständige Rechtsseite vorzutäuschen.
 */
export interface Operator {
  name?: string;
  legalForm?: string;
  address?: string;
  uid?: string;
  register?: string;
  email?: string;
  phone?: string;
  /**
   * Wer die Datenbank betreibt, wie es in der Datenschutzerklärung stehen
   * soll — etwa «Neon Inc. (USA), Server in Frankfurt».
   *
   * Die übrigen Dienstleister stehen fest im Code: Vercel, Stripe und Resend
   * sind eingebaut, sie lassen sich nicht wegkonfigurieren. Die Datenbank
   * dagegen ist nur eine Adresse in `DATABASE_URL` — welcher Anbieter
   * dahintersteht, weiss die Anwendung nicht. Raten wäre hier das Schlimmste:
   * die Datenschutzerklärung muss sagen, wer die Daten tatsächlich hat.
   */
  dbProvider?: string;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function operator(): Operator {
  return {
    name: clean(process.env.OPERATOR_NAME),
    legalForm: clean(process.env.OPERATOR_LEGAL_FORM),
    address: clean(process.env.OPERATOR_ADDRESS),
    uid: clean(process.env.OPERATOR_UID),
    register: clean(process.env.OPERATOR_REGISTER),
    email: clean(process.env.OPERATOR_EMAIL),
    phone: clean(process.env.OPERATOR_PHONE),
    dbProvider: clean(process.env.OPERATOR_DB_PROVIDER),
  };
}

/**
 * Die Angaben, ohne die der Betrieb in der Schweiz nicht zulässig ist —
 * derselbe Umfang, den der Hinweis im Impressum aufzählt. Wären es weniger,
 * verschwände der Hinweis bei halber Konfiguration und die Seite sähe
 * vollständig aus, obwohl UID und Rechtsform fehlen.
 */
export function operatorComplete(op = operator()): boolean {
  return Boolean(op.name && op.legalForm && op.address && op.uid && op.email);
}

/** Welche Pflichtangaben fehlen noch? Für Hinweis und Betriebsprüfung. */
export function missingOperatorFields(op = operator()): string[] {
  const pflicht: Array<[keyof Operator, string]> = [
    ["name", "Firmenname"],
    ["legalForm", "Rechtsform"],
    ["address", "Adresse"],
    ["uid", "UID/MWST-Nummer"],
    ["email", "Kontaktadresse"],
  ];
  return pflicht.filter(([k]) => !op[k]).map(([, bez]) => bez);
}
