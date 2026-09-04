import type { ReportReason } from "../db/schema";

/**
 * Auswahl für die Meldefunktion. Steht bewusst nicht in der Server-Action:
 * aus einer «use server»-Datei darf nur exportiert werden, was auch eine
 * Aktion ist — eine Konstante bricht dort den Build.
 */
export const REPORT_REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: "betrugsverdacht", label: "Betrugsverdacht" },
  { value: "falsche angaben", label: "Falsche Angaben zum Fahrzeug" },
  { value: "verbotenes fahrzeug", label: "Fahrzeug darf nicht gehandelt werden" },
  { value: "beleidigend", label: "Beleidigender oder unzulässiger Inhalt" },
  { value: "anderes", label: "Anderes" },
];
