import Link from "next/link";
import { Badge, ScorePill } from "@/components/ui";
import { VehicleVisual } from "@/components/vehicle-visual";
import { chf, km, label, vehicleFullTitle } from "@/lib/format";
import type { Listing, User, Vehicle } from "@/lib/types";
import { valueAt } from "@/lib/valuation";

export function VehicleCard({
  vehicle,
  listing,
  owner,
  cashDelta,
  score,
  mutual,
  watched,
}: {
  vehicle: Vehicle;
  listing?: Listing;
  owner?: User;
  /** Ausgleich aus Sicht des Nutzers: positiv = er zahlt drauf */
  cashDelta?: number;
  score?: number;
  mutual?: boolean;
  watched?: boolean;
}) {
  const value = valueAt(vehicle);
  const photo = vehicle.photos?.[0];

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface card-shadow transition-colors hover:border-line-strong">
      <Link href={`/fahrzeug/${vehicle.id}`} className="block">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.url}
            alt={`${vehicleFullTitle(vehicle)}, ${vehicle.color}`}
            width={photo.width}
            height={photo.height}
            className="aspect-[16/9] w-full object-cover"
            loading="lazy"
          />
        ) : (
          <VehicleVisual
            id={vehicle.id}
            body={vehicle.body}
            className="aspect-[16/9] w-full"
            label={`${vehicle.year} · ${label.fuel(vehicle.fuel)}`}
          />
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/fahrzeug/${vehicle.id}`} className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold tracking-tight text-ink group-hover:text-marke">
              {vehicle.make} {vehicle.model}
            </h3>
            <p className="truncate text-xs text-ink-3">{vehicle.trim || " "}</p>
          </Link>
          <div className="flex shrink-0 gap-1.5">
            {mutual && <Badge tone="marke">beidseitig</Badge>}
            {watched && <Badge tone="info">gemerkt</Badge>}
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-ink-3">Laufleistung</dt>
            <dd className="tabular text-ink-2">{km(vehicle.mileageKm)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Leistung</dt>
            <dd className="tabular text-ink-2">{vehicle.powerPs} PS</dd>
          </div>
          <div>
            <dt className="text-ink-3">Antrieb</dt>
            <dd className="text-ink-2">{label.drive(vehicle.drivetrain)}</dd>
          </div>
        </dl>

        <div className="mt-auto space-y-2 border-t border-line pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-ink-3">Marktwert</span>
            <span className="text-sm font-semibold tabular text-ink">{chf(value)}</span>
          </div>

          {cashDelta !== undefined && (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-ink-3">
                {cashDelta > 0 ? "Du zahlst" : cashDelta < 0 ? "Du erhältst" : "Ausgleich"}
              </span>
              <span
                className={`text-sm font-semibold tabular ${
                  cashDelta > 0 ? "text-warn" : cashDelta < 0 ? "text-good" : "text-ink-2"
                }`}
              >
                {chf(Math.abs(cashDelta))}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            {owner ? (
              <span className="flex items-center gap-1.5 text-xs text-ink-3">
                <span
                  className="h-4 w-4 rounded-full"
                  style={{ background: owner.avatarColor }}
                  aria-hidden
                />
                {owner.location || owner.name}
              </span>
            ) : (
              <span className="text-xs text-ink-3">Dein Fahrzeug</span>
            )}
            {score !== undefined && score > 0 && <ScorePill score={score} />}
          </div>
        </div>
      </div>
    </article>
  );
}

export function VehicleRow({ vehicle }: { vehicle: Vehicle }) {
  return (
    <div className="flex items-center gap-3">
      <VehicleVisual id={vehicle.id} body={vehicle.body} className="h-12 w-20 shrink-0 rounded-md" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{vehicleFullTitle(vehicle)}</p>
        <p className="truncate text-xs text-ink-3 tabular">
          {vehicle.year} · {km(vehicle.mileageKm)} · {chf(valueAt(vehicle))}
        </p>
      </div>
    </div>
  );
}
