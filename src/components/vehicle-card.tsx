import Link from "next/link";
import { Badge, ScorePill } from "@/components/ui";
import { VehicleVisual } from "@/components/vehicle-visual";
import { getUser } from "@/lib/data/users";
import { chf, km, label, vehicleFullTitle } from "@/lib/format";
import type { Listing, Vehicle } from "@/lib/types";
import { valueAt } from "@/lib/valuation";

export function VehicleCard({
  vehicle,
  listing,
  cashDelta,
  score,
  mutual,
}: {
  vehicle: Vehicle;
  listing?: Listing;
  /** Ausgleich aus Sicht des Nutzers: positiv = er zahlt drauf */
  cashDelta?: number;
  score?: number;
  mutual?: boolean;
}) {
  const owner = listing ? getUser(listing.ownerId) : undefined;
  const value = valueAt(vehicle);

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-900 transition-colors hover:border-ink-600">
      <Link href={`/fahrzeug/${vehicle.id}`} className="block">
        <VehicleVisual
          id={vehicle.id}
          body={vehicle.body}
          className="aspect-[16/9] w-full"
          label={`${vehicle.year} · ${label.fuel(vehicle.fuel)}`}
        />
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <div className="flex items-start justify-between gap-3">
            <Link href={`/fahrzeug/${vehicle.id}`} className="min-w-0">
              <h3 className="truncate text-[15px] font-semibold tracking-tight text-mist-100 group-hover:text-volt-400">
                {vehicle.make} {vehicle.model}
              </h3>
              <p className="truncate text-xs text-mist-400">{vehicle.trim}</p>
            </Link>
            {mutual && <Badge tone="volt">beidseitig</Badge>}
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-mist-400">Laufleistung</dt>
            <dd className="tabular text-mist-200">{km(vehicle.mileageKm)}</dd>
          </div>
          <div>
            <dt className="text-mist-400">Leistung</dt>
            <dd className="tabular text-mist-200">{vehicle.powerPs} PS</dd>
          </div>
          <div>
            <dt className="text-mist-400">Antrieb</dt>
            <dd className="text-mist-200">{label.drive(vehicle.drivetrain)}</dd>
          </div>
        </dl>

        <div className="mt-auto space-y-2 border-t border-ink-800 pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-mist-400">Marktwert</span>
            <span className="text-sm font-semibold tabular text-mist-100">{chf(value)}</span>
          </div>

          {cashDelta !== undefined && (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-mist-400">
                {cashDelta > 0 ? "Du zahlst" : cashDelta < 0 ? "Du erhältst" : "Ausgleich"}
              </span>
              <span
                className={`text-sm font-semibold tabular ${
                  cashDelta > 0 ? "text-amber-warn" : cashDelta < 0 ? "text-good" : "text-mist-200"
                }`}
              >
                {chf(Math.abs(cashDelta))}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            {owner ? (
              <span className="flex items-center gap-1.5 text-xs text-mist-400">
                <span
                  className="h-4 w-4 rounded-full"
                  style={{ background: owner.avatarColor }}
                  aria-hidden
                />
                {owner.location}
              </span>
            ) : (
              <span className="text-xs text-mist-400">Dein Fahrzeug</span>
            )}
            {score !== undefined && <ScorePill score={score} />}
          </div>
        </div>
      </div>
    </article>
  );
}

export function VehicleRow({ vehicle }: { vehicle: Vehicle }) {
  return (
    <div className="flex items-center gap-3">
      <VehicleVisual
        id={vehicle.id}
        body={vehicle.body}
        className="h-12 w-20 shrink-0 rounded-md"
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-mist-100">{vehicleFullTitle(vehicle)}</p>
        <p className="truncate text-xs text-mist-400 tabular">
          {vehicle.year} · {km(vehicle.mileageKm)} · {chf(valueAt(vehicle))}
        </p>
      </div>
    </div>
  );
}
