import Link from "next/link";
import { VehicleVisual } from "@/components/vehicle-visual";
import { Badge, Card } from "@/components/ui";
import { chf, relativeAge } from "@/lib/format";
import type { RingView } from "@/lib/queries";
import type { RingStatusDb } from "@/lib/db/schema";

export const RING_STATUS_META: Record<
  RingStatusDb,
  { text: string; tone: "neutral" | "marke" | "good" | "bad" | "warn" | "info" }
> = {
  vorschlag: { text: "Vorschlag offen", tone: "info" },
  angenommen: { text: "Alle drei haben zugesagt", tone: "marke" },
  treuhand: { text: "Geld im Treuhandkonto", tone: "marke" },
  abwicklung: { text: "Auszahlung läuft", tone: "marke" },
  abgeschlossen: { text: "Abgeschlossen", tone: "good" },
  abgelehnt: { text: "Abgelehnt", tone: "bad" },
  storniert: { text: "Storniert", tone: "bad" },
};

const CLOSED: RingStatusDb[] = ["abgeschlossen", "abgelehnt", "storniert"];

export function RingList({ rings, meId }: { rings: RingView[]; meId: string }) {
  const offen = rings.filter((r) => !CLOSED.includes(r.status));
  const zu = rings.filter((r) => CLOSED.includes(r.status));

  return (
    <div className="space-y-8">
      {offen.length > 0 && (
        <ul className="space-y-3">
          {offen.map((r) => (
            <RingRow key={r.id} ring={r} meId={meId} />
          ))}
        </ul>
      )}
      {zu.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
            Abgeschlossene Ringe
          </h3>
          <ul className="space-y-3">
            {zu.map((r) => (
              <RingRow key={r.id} ring={r} meId={meId} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RingRow({ ring, meId }: { ring: RingView; meId: string }) {
  const meta = RING_STATUS_META[ring.status];
  const me = ring.participants.find((p) => p.user.id === meId);
  const iGet = ring.participants.find((p) => p.receiverId === meId);
  if (!me || !iGet) return null;

  const offeneZusagen = ring.participants.filter((p) => !p.accepted).length;

  return (
    <Card as="li" className="p-4 transition-colors hover:border-line-strong">
      <Link href={`/ringe/${ring.id}`} className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-1.5">
          {ring.participants.map((p, i) => (
            <span key={p.user.id} className="flex items-center gap-1.5">
              {i > 0 && (
                <span className="text-ink-3" aria-hidden>
                  →
                </span>
              )}
              <VehicleVisual
                id={p.gives.id}
                body={p.gives.body}
                className="h-10 w-16 shrink-0 rounded-md"
              />
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            Ringtausch: {me.gives.make} {me.gives.model} <span className="text-ink-3">gegen</span>{" "}
            {iGet.gives.make} {iGet.gives.model}
          </p>
          <p className="mt-0.5 text-xs text-ink-3">
            mit {ring.participants.filter((p) => p.user.id !== meId).map((p) => p.user.name).join(" und ")}{" "}
            · {relativeAge(ring.createdAt, new Date().toISOString().slice(0, 10))}
            {ring.status === "vorschlag" && offeneZusagen > 0 && (
              <> · {offeneZusagen} Zusage{offeneZusagen === 1 ? "" : "n"} offen</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {me.cash !== 0 && (
            <span
              className={`text-sm font-semibold tabular ${me.cash > 0 ? "text-warn" : "text-good"}`}
            >
              {me.cash > 0 ? "−" : "+"}
              {chf(Math.abs(me.cash))}
            </span>
          )}
          <Badge tone={meta.tone}>{meta.text}</Badge>
        </div>
      </Link>
    </Card>
  );
}
