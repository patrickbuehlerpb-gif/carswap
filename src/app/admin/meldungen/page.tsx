import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { Badge, Card, SectionHead } from "@/components/ui";
import { ReportActions } from "@/components/report-actions";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listings, reports, users, vehicles } from "@/lib/db/schema";
import { dateLabel } from "@/lib/format";
import { REPORT_REASONS } from "@/lib/data/report-reasons";

export const metadata: Metadata = { title: "Meldungen" };
export const dynamic = "force-dynamic";

/**
 * Die Betreiberinnen-Ansicht für gemeldete Inserate.
 *
 * Bewusst schmal: eine Liste, ein Link zum Inserat, ein Knopf zum Abhaken.
 * Eine Meldefunktion ohne diese Seite wäre eine Tabelle, die niemand ansieht.
 * Wer kein Admin ist, sieht die Seite nicht — auch nicht, dass es sie gibt.
 */
export default async function MeldungenPage() {
  const me = await getSessionUser();
  if (!me?.isAdmin) notFound();

  const rows = await db
    .select({
      report: reports,
      vehicle: vehicles,
      melderName: users.name,
      melderEmail: users.email,
    })
    .from(reports)
    .innerJoin(listings, eq(listings.id, reports.listingId))
    .innerJoin(vehicles, eq(vehicles.id, listings.vehicleId))
    .innerJoin(users, eq(users.id, reports.reporterId))
    .orderBy(desc(reports.createdAt))
    .limit(200);

  const offen = rows.filter((r) => r.report.status === "offen");
  const erledigt = rows.filter((r) => r.report.status !== "offen");
  const bezeichnung = new Map(REPORT_REASONS.map((r) => [r.value, r.label]));

  return (
    <div>
      <SectionHead
        title="Gemeldete Inserate"
        sub="Was Nutzerinnen und Nutzer als auffällig markiert haben — neueste zuerst."
      />

      {rows.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-sm text-ink-2">Keine Meldungen. Gut so.</p>
        </Card>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink">
              Offen <span className="tabular text-ink-3">({offen.length})</span>
            </h2>
            {offen.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-ink-3">
                Nichts offen.
              </p>
            ) : (
              <ul className="space-y-3">
                {offen.map(({ report, vehicle, melderName, melderEmail }) => (
                  <li key={report.id}>
                    <Card className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone="warn">{bezeichnung.get(report.reason) ?? report.reason}</Badge>
                            <Link
                              href={`/fahrzeug/${vehicle.id}`}
                              className="text-sm font-medium text-ink hover:text-volt-ink"
                            >
                              {vehicle.make} {vehicle.model}
                            </Link>
                          </div>
                          <p className="mt-1 text-xs text-ink-3">
                            {melderName} ({melderEmail}) · {dateLabel(report.createdAt.toISOString())}
                          </p>
                          {report.note && <p className="mt-2 text-sm text-ink-2">{report.note}</p>}
                        </div>
                        <ReportActions reportId={report.id} />
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {erledigt.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-ink">
                Geprüft <span className="tabular text-ink-3">({erledigt.length})</span>
              </h2>
              <ul className="space-y-2">
                {erledigt.map(({ report, vehicle }) => (
                  <li key={report.id} className="text-sm text-ink-3">
                    <Link href={`/fahrzeug/${vehicle.id}`} className="hover:text-ink">
                      {vehicle.make} {vehicle.model}
                    </Link>{" "}
                    · {bezeichnung.get(report.reason) ?? report.reason} ·{" "}
                    {dateLabel(report.createdAt.toISOString())}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
