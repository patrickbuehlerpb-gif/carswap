import { Card } from "@/components/ui";
import type { Kontakt } from "@/lib/queries";

/**
 * Die Telefonnummern der anderen Beteiligten, sobald der Tausch verbindlich
 * ist. Vorher lädt die Seite sie gar nicht erst — die Regel steht in
 * lib/queries, nicht hier.
 *
 * Für die Übergabe braucht es einen Weg aneinander, der nicht durch die
 * Anwendung läuft: Termin verschieben, verspätet sein, das Auto vor der Tür
 * nicht finden. Nichts davon wartet auf die nächste Anmeldung.
 */
export function KontaktKarte({ kontakte }: { kontakte: Kontakt[] }) {
  if (!kontakte.length) return null;

  return (
    <Card className="mt-6 p-5">
      <h2 className="text-sm font-semibold text-ink">
        {kontakte.length > 1 ? "Telefonnummern" : "Telefonnummer"}
      </h2>
      <p className="mt-1 text-xs text-ink-3">
        Ihr habt zugesagt — deshalb seht ihr euch gegenseitig. Für die Übergabe.
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        {kontakte.map((k) => (
          <li key={k.userId} className="flex items-baseline justify-between gap-4">
            <span className="text-ink-3">{k.name}</span>
            <a href={`tel:${k.phone.replace(/\s+/g, "")}`} className="tabular text-marke hover:underline">
              {k.phone}
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
