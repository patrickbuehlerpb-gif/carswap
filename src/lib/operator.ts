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
  };
}

/** Die Angaben, ohne die der Betrieb in der Schweiz nicht zulässig ist. */
export function operatorComplete(op = operator()): boolean {
  return Boolean(op.name && op.address && op.email);
}
