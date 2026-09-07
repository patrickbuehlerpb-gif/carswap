import { Card } from "@/components/ui";

/**
 * Platzhalter für den Moment zwischen Klick und fertiger Seite.
 *
 * Fast jede Seite hier wird bei jedem Aufruf neu gerechnet — sie liest die
 * Sitzung, zählt Inserate, rechnet Werte. Ohne einen Ladezustand passiert
 * nach einem Klick sichtbar *nichts*, bis der Server fertig ist: Der Browser
 * bleibt auf der alten Seite stehen, und es sieht aus, als wäre der Klick
 * verlorengegangen. Genau das war die Beschwerde.
 *
 * Next zeigt eine `loading.tsx` sofort und schiebt den Inhalt nach, sobald er
 * da ist. Der Platzhalter wird dabei mit dem Link vorgeladen, ist also schon
 * im Browser, bevor geklickt wird — er erscheint ohne jede Wartezeit.
 *
 * Die Umrisse ahmen die echte Seite nach, damit der Wechsel nicht springt.
 */

/** Ein grauer Balken. `w` und `h` als Tailwind-Klassen. */
export function Balken({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-3 ${className}`} aria-hidden />;
}

/** Überschrift plus Unterzeile, wie `SectionHead` sie setzt. */
export function KopfSkelett() {
  return (
    <div className="mb-4">
      <Balken className="h-6 w-56" />
      <Balken className="mt-2 h-4 w-full max-w-lg" />
    </div>
  );
}

/** Eine Fahrzeugkarte im Raster. */
export function KarteSkelett() {
  return (
    <Card className="overflow-hidden">
      <Balken className="aspect-[16/9] w-full rounded-none" />
      <div className="space-y-3 p-4">
        <Balken className="h-4 w-2/3" />
        <div className="grid grid-cols-3 gap-2">
          <Balken className="h-8" />
          <Balken className="h-8" />
          <Balken className="h-8" />
        </div>
        <Balken className="h-4 w-1/2" />
      </div>
    </Card>
  );
}

/** Ein Raster aus Fahrzeugkarten — Marktplatz, Garage, Treffer. */
export function RasterSkelett({ anzahl = 6 }: { anzahl?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: anzahl }, (_, i) => (
        <KarteSkelett key={i} />
      ))}
    </div>
  );
}

/**
 * Der allgemeine Fall: Überschrift und ein Kasten. Sagt nichts Falsches über
 * eine Seite aus, deren Form wir hier nicht kennen.
 */
export default function Skelett() {
  return (
    <div>
      <KopfSkelett />
      <Card className="p-6">
        <Balken className="h-4 w-1/3" />
        <Balken className="mt-3 h-4 w-full" />
        <Balken className="mt-2 h-4 w-5/6" />
        <Balken className="mt-2 h-4 w-2/3" />
      </Card>
    </div>
  );
}
