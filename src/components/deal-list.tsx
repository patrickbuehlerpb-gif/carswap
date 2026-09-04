"use client";

import Link from "next/link";
import { VehicleVisual } from "@/components/vehicle-visual";
import { Badge, Card } from "@/components/ui";
import { CURRENT_USER_ID, getUser } from "@/lib/data/users";
import { requireVehicle } from "@/lib/data/vehicles";
import { chf, relativeAge } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Deal, DealStatus } from "@/lib/types";

export const STATUS_META: Record<DealStatus, { text: string; tone: "neutral" | "volt" | "good" | "bad" | "warn" | "info" }> = {
  vorschlag: { text: "Vorschlag offen", tone: "info" },
  verhandlung: { text: "In Verhandlung", tone: "warn" },
  angenommen: { text: "Angenommen", tone: "volt" },
  treuhand: { text: "Geld im Treuhandkonto", tone: "volt" },
  abgeschlossen: { text: "Abgeschlossen", tone: "good" },
  abgelehnt: { text: "Abgelehnt", tone: "bad" },
};

export function DealList() {
  const { deals, hydrated } = useStore();
  const open = deals.filter((d) => !["abgeschlossen", "abgelehnt"].includes(d.status));
  const closed = deals.filter((d) => ["abgeschlossen", "abgelehnt"].includes(d.status));

  if (!hydrated) {
    return <div className="h-56 animate-pulse rounded-xl border border-ink-800 bg-ink-900" />;
  }

  return (
    <div className="space-y-10">
      <section>
        <h3 className="mb-3 text-sm font-semibold text-mist-100">
          Laufend <span className="text-mist-400 tabular">({open.length})</span>
        </h3>
        {open.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-700 p-10 text-center">
            <p className="text-sm text-mist-400">Keine laufenden Tausche.</p>
            <Link href="/matches" className="mt-2 inline-block text-sm text-volt-400">
              Passende Fahrzeuge suchen →
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {open.map((d) => (
              <DealRow key={d.id} deal={d} />
            ))}
          </ul>
        )}
      </section>

      {closed.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-mist-100">
            Abgeschlossen <span className="text-mist-400 tabular">({closed.length})</span>
          </h3>
          <ul className="space-y-3">
            {closed.map((d) => (
              <DealRow key={d.id} deal={d} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DealRow({ deal }: { deal: Deal }) {
  const from = requireVehicle(deal.fromVehicleId);
  const to = requireVehicle(deal.toVehicleId);
  const iAmInitiator = deal.initiatorId === CURRENT_USER_ID;
  const other = getUser(iAmInitiator ? deal.counterpartyId : deal.initiatorId);
  const meta = STATUS_META[deal.status];

  // Aus meiner Sicht: gebe ich das Fahrzeug ab oder erhalte ich es?
  const iGive = iAmInitiator ? from : to;
  const iGet = iAmInitiator ? to : from;
  const myCash = iAmInitiator ? deal.cashDelta : -deal.cashDelta;

  return (
    <Card as="li" className="p-4 transition-colors hover:border-ink-600">
      <Link href={`/deals/${deal.id}`} className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <VehicleVisual id={iGive.id} body={iGive.body} className="h-12 w-20 shrink-0 rounded-md" />
          <span className="text-mist-500" aria-hidden>
            ⇄
          </span>
          <VehicleVisual id={iGet.id} body={iGet.body} className="h-12 w-20 shrink-0 rounded-md" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-mist-100">
            {iGive.make} {iGive.model} <span className="text-mist-400">gegen</span> {iGet.make}{" "}
            {iGet.model}
          </p>
          <p className="mt-0.5 text-xs text-mist-400">
            mit {other.name} · {relativeAge(deal.createdAt)} · {deal.messages.length} Nachricht
            {deal.messages.length === 1 ? "" : "en"}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <span
            className={`text-sm font-semibold tabular ${
              myCash > 0 ? "text-amber-warn" : myCash < 0 ? "text-good" : "text-mist-200"
            }`}
          >
            {myCash > 0 ? "−" : myCash < 0 ? "+" : ""}
            {chf(Math.abs(myCash))}
          </span>
          <Badge tone={meta.tone}>{meta.text}</Badge>
        </div>
      </Link>
    </Card>
  );
}
