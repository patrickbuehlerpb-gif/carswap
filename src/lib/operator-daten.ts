/**
 * Angaben zur Betreiberin.
 *
 * Sie standen bisher ausschliesslich in der Umgebung, mit der Begründung, dass
 * rechtlich verbindliche Angaben nicht aus einem Platzhalter im Repository
 * stammen dürfen. Das galt, solange es keine geprüfte Quelle gab. Inzwischen
 * liegt der beglaubigte Handelsregisterauszug vor, und die Werte unten sind
 * daraus abgeschrieben — kein Platzhalter, sondern öffentliche Registerdaten,
 * die im Impressum ohnehin stehen müssen.
 *
 * Im Code sind sie besser aufgehoben als in einer Umgebungsvariablen: Sie
 * lassen sich beim Deployment nicht vergessen, sie stehen in der Versionierung,
 * und wenn die Firma sich ändert, ist die Änderung eine nachvollziehbare
 * Zeile statt einer stillen Änderung in einer Weboberfläche.
 *
 * Die Umgebung sticht sie weiterhin — für eine zweite Installation unter
 * anderem Betreiber, und damit sich eine falsche Angabe notfalls sofort
 * korrigieren lässt, ohne auf ein Deployment zu warten.
 *
 * Fehlt eine Pflichtangabe, sagen Impressum, AGB und Datenschutzerklärung
 * offen, dass sie unvollständig sind — statt eine vollständige Rechtsseite
 * vorzutäuschen.
 */

/**
 * Handelsregisteramt des Kantons Zürich, beglaubigter Auszug vom 29.04.2024,
 * Eintragung vom 24.04.2024, Übertrag CH-020.4.084.243-5.
 *
 * Nicht enthalten und deshalb hier nicht gesetzt: die Kontaktadresse. Sie
 * steht in keinem Registerauszug, und eine geratene Adresse im Impressum wäre
 * schlimmer als eine fehlende — sie muss über OPERATOR_EMAIL kommen.
 */
const REGISTEREINTRAG = {
  name: "HMZ craftsmanship GmbH",
  legalForm: "Gesellschaft mit beschränkter Haftung (GmbH)",
  address: "c/o SpaceP5 GmbH, Heinrichstrasse 267, 8005 Zürich",
  uid: "CHE-352.722.533",
  register: "Handelsregister des Kantons Zürich",
} as const;
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
    name: clean(process.env.OPERATOR_NAME) ?? REGISTEREINTRAG.name,
    legalForm: clean(process.env.OPERATOR_LEGAL_FORM) ?? REGISTEREINTRAG.legalForm,
    address: clean(process.env.OPERATOR_ADDRESS) ?? REGISTEREINTRAG.address,
    uid: clean(process.env.OPERATOR_UID) ?? REGISTEREINTRAG.uid,
    register: clean(process.env.OPERATOR_REGISTER) ?? REGISTEREINTRAG.register,
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

/**
 * Ist überhaupt etwas über die Betreiberin bekannt?
 *
 * Nicht dasselbe wie `operatorComplete`: Die Rechtsseiten haben bisher den
 * ganzen Block versteckt, sobald eine einzige Pflichtangabe fehlte — und
 * verschwiegen damit auch Firmenname, Adresse und UID, die längst feststehen.
 * Wer die Betreiberin sucht, findet dann gar nichts, obwohl fast alles da
 * ist. Gezeigt wird deshalb, was bekannt ist; was fehlt, sagt der Hinweis
 * darüber.
 */
export function operatorHatAngaben(op = operator()): boolean {
  return Boolean(op.name || op.address || op.uid);
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
