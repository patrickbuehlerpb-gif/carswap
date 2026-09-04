import { vehicleGradient } from "@/lib/format";

/**
 * Platzhalter-Visual statt Fotos: ein aus der Fahrzeug-ID abgeleiteter
 * Farbverlauf mit Karosserie-Silhouette. Deterministisch, damit Server- und
 * Client-Rendering übereinstimmen.
 */
export function VehicleVisual({
  id,
  body,
  className = "",
  label,
}: {
  id: string;
  body: string;
  className?: string;
  label?: string;
}) {
  const g = vehicleGradient(id);
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }}
    >
      <div className="absolute inset-0 grid-noise opacity-50" />
      <svg
        viewBox="0 0 200 80"
        className="absolute bottom-[10%] left-1/2 h-auto w-[78%] -translate-x-1/2 text-mist-100/90"
        fill="none"
      >
        <Silhouette body={body} />
      </svg>
      {label && (
        <span className="absolute left-3 top-3 rounded-md bg-ink-950/55 px-2 py-0.5 text-[11px] font-medium text-mist-100 backdrop-blur-sm">
          {label}
        </span>
      )}
    </div>
  );
}

interface Shape {
  body: string;
  glass: string;
  wheels: [number, number];
  wheelR: number;
  /** x-Position der Türfuge */
  door: number;
  beltline: [number, number, number];
}

/**
 * Je Karosserieform eine eigene Kontur — Dachhöhe, Überhänge und Radstand
 * unterscheiden sich deutlich genug, dass SUV, Kombi und Limousine auf einen
 * Blick auseinanderzuhalten sind.
 */
const SHAPES: Record<string, Shape> = {
  suv: {
    body: "M8 62 L9 44 C10 37 15 34 24 33 L46 31 L64 18 C68 15 74 14 82 14 L142 14 C154 14 164 16 171 21 L182 30 C189 36 191 44 191 52 L191 62 Z",
    glass: "M67 20 C71 16 77 15 85 15 L141 15 C151 15 159 17 165 22 L172 31 L61 31 Z",
    wheels: [50, 154],
    wheelR: 12,
    door: 108,
    beltline: [26, 180, 33],
  },
  kombi: {
    body: "M6 62 L7 46 C8 39 13 36 22 35 L44 33 L62 20 C66 17 72 16 80 16 L150 16 C163 16 172 19 179 24 L188 31 C192 34 193 40 193 47 L193 62 Z",
    glass: "M69 21 C73 17 79 16 87 16 L150 16 C160 16 168 19 174 24 L180 33 L63 33 Z",
    wheels: [46, 156],
    wheelR: 11,
    door: 106,
    beltline: [24, 184, 35],
  },
  limousine: {
    body: "M6 62 L7 46 C8 39 13 36 22 35 L46 33 L66 20 C70 17 76 16 84 16 L124 16 C132 16 138 18 143 22 L163 36 L183 40 C190 42 193 46 193 52 L193 62 Z",
    glass: "M71 21 C75 17 81 16 89 16 L123 16 C130 16 136 18 141 23 L151 33 L65 33 Z",
    wheels: [48, 154],
    wheelR: 11,
    door: 100,
    beltline: [24, 178, 35],
  },
  kompakt: {
    body: "M14 62 L15 46 C16 39 21 36 30 35 L52 33 L70 19 C74 16 80 15 88 15 L132 15 C142 15 149 18 154 25 L167 41 C173 48 175 54 175 62 Z",
    glass: "M74 20 C78 16 84 15 92 15 L131 15 C139 15 145 18 150 25 L156 33 L68 33 Z",
    wheels: [50, 144],
    wheelR: 11,
    door: 100,
    beltline: [32, 168, 35],
  },
  coupe: {
    body: "M6 62 L7 47 C8 40 13 37 22 36 L48 34 L72 19 C78 16 86 15 96 16 L118 18 C128 20 136 24 143 30 L176 44 C186 48 192 52 193 57 L193 62 Z",
    glass: "M77 21 C83 17 91 16 99 17 L118 19 C127 21 134 25 140 31 L145 35 L71 35 Z",
    wheels: [50, 152],
    wheelR: 11,
    door: 104,
    beltline: [24, 180, 37],
  },
  van: {
    body: "M8 62 L9 38 C10 28 15 23 26 22 L44 21 L54 13 C58 10 64 9 72 9 L156 9 C172 9 182 14 186 26 L190 40 C192 46 192 54 192 62 Z",
    glass: "M59 15 C63 11 69 10 77 10 L154 10 C166 10 174 14 179 23 L183 30 L53 30 Z",
    wheels: [46, 158],
    wheelR: 11,
    door: 104,
    beltline: [22, 186, 32],
  },
};

function Silhouette({ body }: { body: string }) {
  const s = SHAPES[body] ?? SHAPES.suv;
  return (
    <>
      {/* Karosserie */}
      <path
        d={s.body}
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      {/* Verglasung */}
      <path d={s.glass} fill="currentColor" fillOpacity="0.2" />
      {/* Gürtellinie und Türfuge */}
      <path
        d={`M${s.beltline[0]} ${s.beltline[2]} L${s.beltline[1]} ${s.beltline[2]}`}
        stroke="currentColor"
        strokeWidth="1.1"
        strokeOpacity="0.4"
      />
      <path
        d={`M${s.door} ${s.beltline[2] - 16} L${s.door} ${s.beltline[2] + 12}`}
        stroke="currentColor"
        strokeWidth="1.1"
        strokeOpacity="0.4"
      />
      {/* Räder */}
      {s.wheels.map((x) => (
        <g key={x}>
          <circle cx={x} cy={62} r={s.wheelR} fill="#0b0d0f" fillOpacity="0.55" />
          <circle cx={x} cy={62} r={s.wheelR} stroke="currentColor" strokeWidth="2.1" />
          <circle cx={x} cy={62} r={s.wheelR * 0.42} fill="currentColor" fillOpacity="0.75" />
        </g>
      ))}
    </>
  );
}
