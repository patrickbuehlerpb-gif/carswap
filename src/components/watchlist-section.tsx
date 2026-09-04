"use client";

import Link from "next/link";
import { VehicleCard } from "@/components/vehicle-card";
import { SectionHead } from "@/components/ui";
import { getListing, requireVehicle } from "@/lib/data/vehicles";
import { useStore } from "@/lib/store";

export function WatchlistSection() {
  const { watchlist, hydrated } = useStore();
  const items = watchlist
    .map((id) => getListing(id))
    .filter((l): l is NonNullable<typeof l> => Boolean(l));

  return (
    <section>
      <SectionHead
        title="Merkliste"
        sub="Inserate, die du dir gemerkt hast. Der Ausgleich wird laufend neu berechnet."
        action={
          <Link href="/markt" className="text-sm text-volt-400 hover:text-volt-300">
            Weitere Fahrzeuge →
          </Link>
        }
      />
      {!hydrated ? (
        <div className="h-40 animate-pulse rounded-xl border border-ink-800 bg-ink-900" />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-700 p-10 text-center text-sm text-mist-400">
          Noch nichts gemerkt. Auf jedem Inserat findest du oben rechts «merken».
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((l) => (
            <VehicleCard key={l.id} vehicle={requireVehicle(l.vehicleId)} listing={l} />
          ))}
        </div>
      )}
    </section>
  );
}
