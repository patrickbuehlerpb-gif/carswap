import { ImageResponse } from "next/og";

/**
 * Das Vorschaubild für geteilte Links.
 *
 * Wer eine Adresse in einen Chat wirft, sieht sonst nur die nackte URL. Für
 * einen Marktplatz, der davon lebt, dass Leute «schau dir das an»
 * weiterschicken, ist das eine verschenkte Runde.
 *
 * Bewusst ohne Schriftdatei: `ImageResponse` müsste sie sonst bei jedem
 * Aufruf laden, und fällt der Abruf aus, gibt es gar kein Bild. Die
 * Systemschrift genügt für vier Wörter.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "quitt — Autos tauschen statt verkaufen";

const CANVAS = "#f3efe6";
const INK = "#141210";
const MARKE = "#0e4c46";
const GOLD = "#b0730f";

const ZEILE = {
  fontSize: 84,
  fontWeight: 800,
  color: INK,
  letterSpacing: -3,
  lineHeight: 1.06,
} as const;

export default function Bild() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: CANVAS,
          padding: "72px 80px 84px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Signet />
          <span style={{ fontSize: 52, fontWeight: 800, color: INK, letterSpacing: -2 }}>
            quitt
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {/* Zwei eigene Zeilen statt <br />: der Renderer hinter
              ImageResponse kennt keinen Zeilenumbruch im Fliesstext und
              klebte «tauschenstatt» zusammen. */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={ZEILE}>Autos tauschen</span>
            <span style={ZEILE}>statt verkaufen</span>
          </div>
          <span style={{ fontSize: 32, color: "#5c554b", lineHeight: 1.35 }}>
            Wir rechnen aus, was deines wert ist — den Rest legt ihr fest.
          </span>
        </div>
      </div>
    ),
    size,
  );
}

/** Die Gleichung: zwei gleich lange Balken, der untere endet in Gold. */
function Signet() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ width: 96, height: 20, borderRadius: 6, background: MARKE }} />
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ width: 63, height: 20, borderRadius: 6, background: MARKE }} />
        <div style={{ width: 25, height: 20, borderRadius: 6, background: GOLD }} />
      </div>
    </div>
  );
}
