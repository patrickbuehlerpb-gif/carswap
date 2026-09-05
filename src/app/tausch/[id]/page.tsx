import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SwapConfigurator } from "@/components/swap-configurator";
import { Card, SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { getListingByVehicle, getMyVehicles, getVehicle } from "@/lib/queries";
import { currentMonth } from "@/lib/valuation";
import { vehicleFullTitle } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const v = await getVehicle(id);
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

  const me = await getSessionUser();
  if (!me) redirect(`/konto/anmelden?next=/tausch/${id}`);

  const view = await getListingByVehicle(id);
  if (!view || view.listing.status !== "aktiv") notFound();
  if (view.vehicle.ownerId === me.id) redirect(`/auto/${id}`);

  const myVehicles = await getMyVehicles(me.id);

  if (myVehicles.length === 0) {
    return (
      <Card className="p-12 text-center">
        <h1 className="text-lg font-semibold text-ink">Erst dein Auto, dann der Tausch</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">
          Ohne ein Auto auf deiner Seite gibt es nichts zu vergleichen und keinen Ausgleich zu
          rechnen.
        </p>
        <Link
          href="/inserat/neu"
          className="mt-5 inline-block rounded-lg bg-marke px-5 py-2.5 text-sm font-semibold text-onmarke transition-colors hover:bg-marke-hi"
        >
          Auto einstellen
        </Link>
      </Card>
    );
  }

  return (
    <div>
      <SectionHead
        title={`Tausch gegen ${view.vehicle.make} ${view.vehicle.model}`}
        sub="Der Ausgleich ist die Differenz der beiden Werte. Du kannst einen anderen Betrag bieten. Die Gegenseite sieht dann, um wie viel du abweichst."
      />
      <SwapConfigurator
        target={view.vehicle}
        listing={view.listing}
        owner={view.owner}
        myVehicles={myVehicles}
        defaultMineId={mine}
        asOf={currentMonth()}
      />
    </div>
  );
}
