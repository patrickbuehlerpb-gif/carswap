/**
 * Rechenregeln für den Ringtausch. Bewusst ohne Datenbank- und Stripe-Bezug,
 * damit sie sich einzeln prüfen lassen — die Aktionen in
 * `app/actions/rings.ts` bauen darauf auf.
 */

export interface RingCashLeg {
  userId: string;
  /** Positiv: zahlt in den Topf. Negativ: bekommt aus dem Topf. In Franken. */
  cash: number;
}

/** Eine einzelne Zahlung von einer Person an eine andere. */
export interface RingTransfer {
  payerId: string;
  payeeId: string;
  /** In ganzen Franken, immer positiv. */
  amount: number;
}

/**
 * Zerlegt den Ring in einzelne Zahlungen. Im Ring zahlt niemand direkt an die
 * Person, von der er das Auto bekommt — die Summe aller Ausgleiche ist null,
 * also lässt sich der Topf in Überweisungen von den Zahlenden zu den
 * Empfangenden auflösen. Bei drei Parteien entstehen dabei höchstens zwei.
 *
 * Der Vorteil dieser Zerlegung: jede Zahlung hat wie beim Zweiertausch genau
 * einen Zahler und einen Empfänger und läuft durch denselben, bereits
 * abgesicherten Weg — Reservierung, Einzug, Weiterleitung.
 *
 * Die Reihenfolge der Beine bestimmt das Ergebnis, deshalb müssen sie nach
 * Position sortiert hereinkommen. So entsteht bei jedem Aufruf dieselbe
 * Aufteilung.
 */
export function ringTransfers(legs: RingCashLeg[]): RingTransfer[] {
  const payers = legs.filter((l) => l.cash > 0).map((l) => ({ id: l.userId, rest: l.cash }));
  const payees = legs.filter((l) => l.cash < 0).map((l) => ({ id: l.userId, rest: -l.cash }));

  const transfers: RingTransfer[] = [];
  let i = 0;
  let j = 0;
  while (i < payers.length && j < payees.length) {
    const amount = Math.min(payers[i].rest, payees[j].rest);
    transfers.push({ payerId: payers[i].id, payeeId: payees[j].id, amount });
    payers[i].rest -= amount;
    payees[j].rest -= amount;
    if (payers[i].rest === 0) i++;
    if (payees[j].rest === 0) j++;
  }
  return transfers;
}

/** Stimmt die Summe? Ein Ring, dessen Ausgleiche sich nicht aufheben, ist ungültig. */
export function ringBalanced(legs: RingCashLeg[]): boolean {
  return legs.reduce((sum, l) => sum + l.cash, 0) === 0;
}

/**
 * Prüft, ob die Beine wirklich einen Ring bilden: jede Person gibt genau ein
 * Fahrzeug ab und bekommt genau eines, und der Weg führt über alle Beteiligten
 * zurück zum Anfang. Zwei getrennte Zweiertausche in einer Liste sind kein Ring.
 */
export function ringClosed(legs: { userId: string; receiverId: string }[]): boolean {
  if (legs.length < 3) return false;
  const next = new Map(legs.map((l) => [l.userId, l.receiverId]));
  if (next.size !== legs.length) return false;
  if (new Set(legs.map((l) => l.receiverId)).size !== legs.length) return false;
  if (legs.some((l) => l.userId === l.receiverId)) return false;

  let cur = legs[0].userId;
  for (let step = 0; step < legs.length; step++) {
    const nxt = next.get(cur);
    if (!nxt) return false;
    cur = nxt;
  }
  return cur === legs[0].userId;
}
