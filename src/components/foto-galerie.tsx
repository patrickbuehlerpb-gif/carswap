"use client";

import Image from "next/image";
import { useState } from "react";
import { VehicleVisual } from "@/components/vehicle-visual";
import type { VehiclePhoto } from "@/lib/db/schema";

/**
 * Die Fotos eines Inserats.
 *
 * Bis hierher wurden sie zwar hochgeladen, aber nur als Vorschaubild auf der
 * Marktkarte gezeigt — auf der Fahrzeugseite, wo man ein Auto tatsächlich
 * ansieht, stand die generierte Silhouette. Zehn Fotos hochzuladen, die
 * niemand je sieht, ist keine Funktion.
 *
 * Ohne Fotos bleibt die Silhouette: sie ist ein ehrlicher Platzhalter und
 * keine Behauptung über das Fahrzeug.
 */
export function FotoGalerie({
  photos,
  vehicleId,
  body,
  alt,
  label,
}: {
  photos: VehiclePhoto[];
  vehicleId: string;
  body: string;
  alt: string;
  label?: string;
}) {
  const [aktiv, setAktiv] = useState(0);

  if (!photos.length) {
    return (
      <VehicleVisual
        id={vehicleId}
        body={body}
        className="aspect-[16/9] w-full rounded-xl border border-line"
        label={label}
      />
    );
  }

  const gezeigt = photos[Math.min(aktiv, photos.length - 1)];

  return (
    <div>
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-line bg-surface-2">
        <Image
          key={gezeigt.url}
          src={gezeigt.url}
          alt={photos.length > 1 ? `${alt} — Bild ${aktiv + 1} von ${photos.length}` : alt}
          fill
          // Bis zum Umbruch füllt das Bild die Breite, danach knapp zwei
          // Drittel des Rasters. Ohne diese Angabe lädt jedes Telefon die
          // Fassung für einen grossen Bildschirm.
          sizes="(max-width: 1024px) 100vw, 62vw"
          className="object-cover"
          priority
        />
        {label && (
          <span className="absolute left-3 top-3 rounded-md bg-surface/85 px-2 py-0.5 text-[11px] font-medium text-ink backdrop-blur-sm">
            {label}
          </span>
        )}
      </div>

      {photos.length > 1 && (
        <div
          role="group"
          aria-label="Weitere Fotos"
          className="mt-3 flex gap-2 overflow-x-auto pb-1"
        >
          {photos.map((p, i) => (
            <button
              key={p.url}
              type="button"
              onClick={() => setAktiv(i)}
              aria-label={`Bild ${i + 1} anzeigen`}
              aria-current={i === aktiv ? "true" : undefined}
              className={`relative aspect-[4/3] h-16 shrink-0 overflow-hidden rounded-lg border transition-colors ${
                i === aktiv ? "border-marke" : "border-line hover:border-line-strong"
              }`}
            >
              <Image
                src={p.url}
                alt=""
                fill
                sizes="96px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
