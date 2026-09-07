import "server-only";

/**
 * Die Angaben zur Betreiberin — mit dem Wächter davor, der verhindert, dass
 * das Lesen der Umgebung versehentlich im Browser landet.
 *
 * Der Inhalt steht in `operator-daten.ts`, weil `server-only` ausserhalb von
 * Next wirft und `scripts/preflight.ts` dieselben Angaben prüfen muss.
 * Vorher zählte das Skript die Pflichtfelder ein zweites Mal auf, gegen die
 * Umgebung statt gegen diese Funktionen — und meldete deshalb «es fehlt
 * alles», als die Werte längst im Code standen.
 */
export * from "./operator-daten";
