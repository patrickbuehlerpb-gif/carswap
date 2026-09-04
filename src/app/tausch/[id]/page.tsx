import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SwapConfigurator } from "@/components/swap-configurator";
import { SectionHead } from "@/components/ui";
import { getVehicle, myVehicleIds } from "@/lib/data/vehicles";
import { vehicleFullTitle } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const v = getVehicle(id);
  return { title: v ? `Tausch gegen ${vehicleFullTitle(v)}` : "Tausch" };
}

export default async function TauschPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mine?: string }>;
}) {
  const { id } = await params;
  const { mine } = await searchParams;
  const vehicle = getVehicle(id);
  if (!vehicle || myVehicleIds.includes(id)) notFound();

  return (
    <div>
      <SectionHead
        title={`Tausch gegen ${vehicle.make} ${vehicle.model}`}
        sub="Der Ausgleich ergibt sich aus der Differenz der beiden Marktwerte. Du kannst davon abweichen — die Gegenseite sieht dann, um wie viel."
      />
      <SwapConfigurator targetId={vehicle.id} defaultMineId={mine} />
    </div>
  );
}
