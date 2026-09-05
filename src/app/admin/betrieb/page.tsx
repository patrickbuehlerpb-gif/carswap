import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, SectionHead } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { betriebsbild, laufendeMitGeld, neuesteKonten, seitTagen } from "@/lib/betrieb";
import { chf } from "@/lib/format";

export const metadata: Metadata = { title: "Betrieb" };
export const dynamic = "force-dynamic";

/**
 * Die Betriebsübersicht.
 *
 * Nach dem Livegang ist die Frage jeden Morgen dieselbe: läuft es, und liegt
 * irgendwo Geld, das jemand anderem gehört? Bisher stand das nur in
 * /api/health hinter einem Token oder in der Datenbank. Hier steht es auf
 * einer Seite — nur lesend, nichts lässt sich von hier aus auslösen.
 */
export default async function BetriebPage() {
  const me = await getSessionUser();
  if (!me?.isAdmin) notFound();

  const [bild, konten, geldwege] = await Promise.all([
    betriebsbild(),
    neuesteKonten(),
    laufendeMitGeld(),
  ]);

  const laufendeTausche =
    bild.tausche.vorschlag +
    bild.tausche.verhandlung +
    bild.tausche.angenommen +
    bild.tausche.treuhand +
    bild.tausche.abwicklung;

  return (
    <div className="space-y-6">
      <SectionHead
        title="Betrieb"
        sub="Was läuft, was hängt, was noch nicht eingerichtet ist. Nur lesend."
        action={
          <Link href="/admin/meldungen" className="text-sm text-marke hover:underline">
            Meldungen
            {bild.offeneMeldungen > 0 && ` (${bild.offeneMeldungen} offen)`}
          </Link>
        }
      />

      {bild.geld.liegengebliebenAnzahl > 0 && (
        <Card className="border-bad/35 bg-bad/8 p-5">
          <h2 className="text-sm font-semibold text-bad">Geld liegt auf dem Plattformkonto</h2>
          <p className="mt-1 text-sm text-ink-2">
            {bild.geld.liegengebliebenAnzahl} Zahlung(en) über{" "}
            <span className="betrag">{chf(bild.geld.liegengebliebenMinor / 100)}</span> sind
            eingezogen, aber nicht weitergeleitet. Der nächtliche Lauf versucht es erneut. Bleibt
            es stehen, fehlt der Gegenseite das Auszahlungskonto — oder es braucht einen Menschen.
          </p>
        </Card>
      )}

      {bild.nichtEingerichtet.length > 0 && (
        <Card className="border-warn/35 bg-warn/10 p-5">
          <h2 className="text-sm font-semibold text-ink">Noch nicht eingerichtet</h2>
          <ul className="mt-2 space-y-1 text-sm text-ink-2">
            {bild.nichtEingerichtet.map((punkt) => (
              <li key={punkt}>· {punkt}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kennzahl
          titel="Konten"
          wert={bild.konten.gesamt}
          zusatz={`${bild.konten.bestaetigt} bestätigt · ${bild.konten.neuDieseWoche} neu diese Woche`}
        />
        <Kennzahl
          titel="Autos im Markt"
          wert={bild.inserate.aktiv}
          zusatz={`${bild.inserate.pausiert} pausiert · ${bild.inserate.getauscht} getauscht`}
        />
        <Kennzahl
          titel="Laufende Tausche"
          wert={laufendeTausche}
          zusatz={`${bild.tausche.abgeschlossen} abgeschlossen`}
        />
        <Kennzahl
          titel="Gehalten"
          wert={chf(bild.geld.reserviertMinor / 100)}
          zusatz={`${chf(bild.geld.ausgezahltMinor / 100)} ausgezahlt · ${chf(
            bild.geld.gebuehrenMinor / 100,
          )} Gebühren`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink">Tausche nach Zustand</h2>
          <Verteilung werte={bild.tausche} />
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink">Ringe nach Zustand</h2>
          <Verteilung werte={bild.ringe} />
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink">Geld unterwegs</h2>
        <p className="mt-1 text-xs text-ink-3">
          Reserviert oder eingezogen — alles, was gerade nicht beim Empfänger ist. Die älteste
          Zeile zuerst: was hier lange steht, hängt.
        </p>
        {geldwege.length === 0 ? (
          <p className="mt-4 text-sm text-ink-3">Nichts unterwegs.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-3">
                  <th className="pb-2 font-medium">Vorgang</th>
                  <th className="pb-2 font-medium">Zustand</th>
                  <th className="pb-2 text-right font-medium">Betrag</th>
                  <th className="pb-2 text-right font-medium">Seit</th>
                </tr>
              </thead>
              <tbody>
                {geldwege.map((z) => (
                  <tr key={z.id} className="border-b border-line/60 last:border-0">
                    <td className="py-2">
                      <Link
                        href={z.dealId ? `/deals/${z.dealId}` : `/ringe/${z.ringId}`}
                        className="text-marke hover:underline"
                      >
                        {z.dealId ? "Tausch" : "Ring"}
                      </Link>
                    </td>
                    <td className="py-2">
                      <Badge tone={z.status === "eingezogen" && !z.transfer ? "warn" : "neutral"}>
                        {z.status}
                      </Badge>
                    </td>
                    <td className="py-2 text-right betrag">{chf(z.amountMinor / 100)}</td>
                    <td className="py-2 text-right tabular text-ink-3">
                      {seitTagen(z.seit)} d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink">Zuletzt dazugekommen</h2>
        {konten.length === 0 ? (
          <p className="mt-4 text-sm text-ink-3">Noch keine Konten.</p>
        ) : (
          <ul className="mt-4 space-y-2 text-sm">
            {konten.map((k) => (
              <li key={k.id} className="flex items-baseline justify-between gap-4">
                <span className="truncate text-ink">
                  {k.name}{" "}
                  <span className="text-ink-3">{k.email}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-3">
                  {k.bestaetigt ? "bestätigt" : "offen"} · vor {seitTagen(k.createdAt)} d
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Kennzahl({
  titel,
  wert,
  zusatz,
}: {
  titel: string;
  wert: string | number;
  zusatz: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-xs text-ink-3">{titel}</p>
      <p className="mt-1 text-2xl betrag text-ink">{wert}</p>
      <p className="mt-1 text-xs text-ink-3">{zusatz}</p>
    </Card>
  );
}

/** Eine Zeile je Zustand. Nullen bleiben stehen — sie sind auch eine Aussage. */
function Verteilung({ werte }: { werte: Record<string, number> }) {
  const gesamt = Object.values(werte).reduce((a, b) => a + b, 0);
  return (
    <ul className="mt-3 space-y-1.5 text-sm">
      {Object.entries(werte).map(([zustand, n]) => (
        <li key={zustand} className="flex items-baseline justify-between gap-4">
          <span className={n > 0 ? "text-ink-2" : "text-ink-3"}>{zustand}</span>
          <span className={`tabular ${n > 0 ? "text-ink" : "text-ink-3"}`}>{n}</span>
        </li>
      ))}
      <li className="flex items-baseline justify-between gap-4 border-t border-line pt-1.5">
        <span className="text-ink-3">gesamt</span>
        <span className="tabular text-ink">{gesamt}</span>
      </li>
    </ul>
  );
}
