import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ListingForm, type ListingFormValues } from "@/components/listing-form";
import { SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { getListingByVehicle, getVehicle } from "@/lib/queries";
import { currentMonth } from "@/lib/valuation";
import { ListingControls } from "@/components/listing-controls";

export const metadata: Metadata = { title: "Inserat bearbeiten" };
export const dynamic = "force-dynamic";

export default async function InseratBearbeitenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getSessionUser();
  if (!me) redirect(`/konto/anmelden?next=/inserat/${id}/bearbeiten`);

  const vehicle = await getVehicle(id);
  if (!vehicle) notFound();
  if (vehicle.ownerId !== me.id) redirect(`/fahrzeug/${id}`);

  const view = await getListingByVehicle(id);
  const wish = view?.listing.wish;

  const initial: ListingFormValues = {
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    firstRegistration: vehicle.firstRegistration.slice(0, 7),
    mileageKm: vehicle.mileageKm,
    fuel: vehicle.fuel,
    body: vehicle.body,
    drivetrain: vehicle.drivetrain,
    powerPs: vehicle.powerPs,
    listPriceNew: vehicle.listPriceNew,
    condition: vehicle.condition,
    color: vehicle.color,
    rangeKm: vehicle.rangeKm ?? undefined,
    batterySoh: vehicle.batterySoh ?? 95,
    features: vehicle.features,
    notes: vehicle.notes ?? "",
    defects: vehicle.defects ?? [],
    serviceHistory: vehicle.serviceHistory,
    previousOwners: vehicle.previousOwners,
    accidentFree: vehicle.accidentFree,
    mfkUntil: vehicle.mfkUntil ?? "",
    photos: vehicle.photos,
    wishMakes: wish?.makes ?? [],
    wishBodies: wish?.bodies ?? [],
    wishFuels: wish?.fuels ?? [],
    wishMinYear: wish?.minYear,
    wishMaxMileageKm: wish?.maxMileageKm,
    wishMaxCashOut: wish?.maxCashOut,
    wishNotes: wish?.notes ?? "",
    askPremium: view?.listing.askPremium ?? 0,
  };

  return (
    <div className="space-y-6">
      <SectionHead
        title={`${vehicle.make} ${vehicle.model} bearbeiten`}
        sub="Halte vor allem den Kilometerstand aktuell — davon hängt die Bewertung am stärksten ab."
        action={<ListingControls vehicleId={vehicle.id} status={view?.listing.status ?? "aktiv"} />}
      />
      <ListingForm
        mode="edit"
        vehicleId={vehicle.id}
        initial={initial}
        asOf={currentMonth()}
        uploadsEnabled={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
      />
    </div>
  );
}
