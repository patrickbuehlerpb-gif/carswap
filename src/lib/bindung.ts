import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "./db";
import { dealVehicleLocks, deals, ringLegs, ringSwaps } from "./db/schema";

/**
 * Steckt dieses Fahrzeug in einem verbindlichen Vorgang?
 *
 * Es gibt zwei Arten, gebunden zu sein — ein zugesagter Zweiertausch und ein
 * zugesagter Ring —, und drei Stellen im Code fragten das nur für die erste
 * ab. Die Folgen waren jedes Mal dieselbe Sorte Schaden: Ein Auto in einem
 * Ring mit hinterlegtem Geld liess sich bearbeiten, archivieren und sperren,
 * während zwei andere Leute längst bezahlt hatten.
 *
 * Gefragt wird beides. Die Sperrtabelle ist die eigentliche Quelle — sie
 * kennt beide Arten und hält den Primärschlüssel auf der Fahrzeug-ID, der
 * zwei gleichzeitige Zusagen auseinanderhält. Die Statusabfragen daneben sind
 * Gürtel und Hosenträger: Bliebe eine Sperrzeile einmal aus, wäre die Antwort
 * hier trotzdem richtig, und das ist die Richtung, in die sich ein Fehler
 * hier irren darf.
 */
export async function istGebunden(vehicleId: string): Promise<boolean> {
  const [gesperrt] = await db
    .select({ vehicleId: dealVehicleLocks.vehicleId })
    .from(dealVehicleLocks)
    .where(eq(dealVehicleLocks.vehicleId, vehicleId))
    .limit(1);
  if (gesperrt) return true;

  const [tausch] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(
      and(
        or(eq(deals.fromVehicleId, vehicleId), eq(deals.toVehicleId, vehicleId)),
        inArray(deals.status, ["angenommen", "treuhand", "abwicklung"]),
      ),
    )
    .limit(1);
  if (tausch) return true;

  const [ring] = await db
    .select({ id: ringSwaps.id })
    .from(ringLegs)
    .innerJoin(ringSwaps, eq(ringSwaps.id, ringLegs.ringId))
    .where(
      and(
        eq(ringLegs.vehicleId, vehicleId),
        inArray(ringSwaps.status, ["angenommen", "treuhand", "abwicklung"]),
      ),
    )
    .limit(1);
  return Boolean(ring);
}
