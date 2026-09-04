import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EMPTY_FORM, ListingForm } from "@/components/listing-form";
import { SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { currentMonth } from "@/lib/valuation";

export const metadata: Metadata = { title: "Fahrzeug anbieten" };
export const dynamic = "force-dynamic";

export default async function NeuesInseratPage() {
  const me = await getSessionUser();
  if (!me) redirect("/konto/anmelden?next=/inserat/neu");

  return (
    <div>
      <SectionHead
        title="Fahrzeug anbieten"
        sub="Die Bewertung entsteht live aus deinen Angaben. Was du hier einträgst, ist die Grundlage jeder Wertdifferenz — also lieber genau als optimistisch."
      />
      <ListingForm
        mode="create"
        initial={EMPTY_FORM}
        asOf={currentMonth()}
        uploadsEnabled={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
      />
    </div>
  );
}
