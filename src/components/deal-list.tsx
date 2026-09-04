import Link from "next/link";
import { VehicleVisual } from "@/components/vehicle-visual";
import { Badge, Card } from "@/components/ui";
import { chf, relativeAge } from "@/lib/format";
import type { DealView } from "@/lib/queries";
import type { DealStatus } from "@/lib/types";

export const STATUS_META: Record<
  DealStatus,
  { text: string; tone: "neutral" | "volt" | "good" | "bad" | "warn" | "info" }
> = {
  vorschlag: { text: "Vorschlag offen", tone: "info" },
  verhandlung: { text: "In Verhandlung", tone: "warn" },
  angenommen: { text: "Angenommen", tone: "volt" },
  treuhand: { text: "Geld im Treuhandkonto", tone: "volt" },
  abwicklung: { text: "Auszahlung läuft", tone: "volt" },
  abgeschlossen: { text: "Abgeschlossen", tone: "good" },
  abgelehnt: { text: "Abgelehnt", tone: "bad" },
  storniert: { text: "Storniert", tone: "bad" },
};

const CLOSED: DealStatus[] = ["abgeschlossen", "abgelehnt", "storniert"];

export function DealList({ deals }: { deals: DealView[] }) {
  const open = deals.filter((d) => !CLOSED.includes(d.deal.status));
  const closed = deals.filter((d) => CLOSED.includes(d.deal.status));

  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">
          Laufend <span className="text-ink-3 tabular">({open.length})</span>
        </h2>
        {open.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong p-10 text-center">
            <p className="text-sm text-ink-3">Keine laufenden Tausche.</p>
            <Link href="/matches" className="mt-2 inline-block text-sm text-volt-ink hover:underline">
              Passende Fahrzeuge suchen →
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {open.map((d) => (
              <DealRow key={d.deal.id} view={d} />
            ))}
          </ul>
        )}
      </section>

      {closed.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink">
            Abgeschlossen <span className="text-ink-3 tabular">({closed.length})</span>
          </h2>
          <ul className="space-y-3">
            {closed.map((d) => (
              <DealRow key={d.deal.id} view={d} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DealRow({ view }: { view: DealView }) {
  const { deal, fromVehicle, toVehicle, other, iAmInitiator } = view;
  const meta = STATUS_META[deal.status];

  // Aus meiner Sicht: gebe ich das Fahrzeug ab oder erhalte ich es?
  const iGive = iAmInitiator ? fromVehicle : toVehicle;
  const iGet = iAmInitiator ? toVehicle : fromVehicle;
  const myCash = iAmInitiator ? deal.cashDelta : -deal.cashDelta;
  const messages = deal.messageCount ?? deal.messages.length;

  return (
    <Card as="li" className="p-4 transition-colors hover:border-line-strong">
      <Link href={`/deals/${deal.id}`} className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <VehicleVisual id={iGive.id} body={iGive.body} className="h-12 w-20 shrink-0 rounded-md" />
          <span className="text-ink-3" aria-hidden>
            ⇄
          </span>
          <VehicleVisual id={iGet.id} body={iGet.body} className="h-12 w-20 shrink-0 rounded-md" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            {iGive.make} {iGive.model} <span className="text-ink-3">gegen</span> {iGet.make}{" "}
            {iGet.model}
          </p>
          <p className="mt-0.5 text-xs text-ink-3">
            mit {other.name} · {relativeAge(deal.createdAt, new Date().toISOString().slice(0, 10))} ·{" "}
            {messages} Nachricht{messages === 1 ? "" : "en"}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {myCash !== 0 && (
            <span
              className={`text-sm font-semibold tabular ${myCash > 0 ? "text-warn" : "text-good"}`}
            >
              {myCash > 0 ? "−" : "+"}
              {chf(Math.abs(myCash))}
            </span>
          )}
          <Badge tone={meta.tone}>{meta.text}</Badge>
        </div>
      </Link>
    </Card>
  );
}
