import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EMPTY_FORM, ListingForm } from "@/components/listing-form";
import { SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { currentMonth } from "@/lib/valuation";

export const metadata: Metadata = { title: "Auto anbieten" };
export const dynamic = "force-dynamic";

export default async function NeuesInseratPage() {
  const me = await getSessionUser();
  if (!me) redirect("/konto/anmelden?next=/inserat/neu");

  return (
    <div>
      <SectionHead
        title="Auto anbieten"
        sub="Der Wert entsteht beim Tippen. Was du hier einträgst, ist die Grundlage für jeden Ausgleich — trag also lieber genau ein als optimistisch."
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
