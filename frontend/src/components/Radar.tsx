// Exporters on a radar: distance from the centre = anomaly risk, a sweep keeps turning.
import { shortHex } from "../lib/contract";
import { riskClass, type RiskExporter } from "../lib/risk";

const R = 130;
const C = 150;

export default function Radar({ exporters, caption }: { exporters: RiskExporter[]; caption: string }) {
  return (
    <figure className="radar-wrap">
      <svg viewBox="0 0 300 300" className="radar" role="img" aria-label={caption}>
        <defs>
          <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="rgb(var(--leaf-rgb))" stopOpacity="0" />
            <stop offset="1" stopColor="rgb(var(--leaf-rgb))" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        {[0.33, 0.66, 1].map((k) => (
          <circle key={k} cx={C} cy={C} r={R * k} className="ring" />
        ))}
        <line x1={C} y1={C - R} x2={C} y2={C + R} className="axis" />
        <line x1={C - R} y1={C} x2={C + R} y2={C} className="axis" />
        <g className="sweep">
          <path d={`M${C},${C} L${C + R},${C} A${R},${R} 0 0 0 ${C + R * Math.cos(-0.7)},${C + R * Math.sin(-0.7)} Z`} fill="url(#sweep)" />
          <line x1={C} y1={C} x2={C + R} y2={C} className="beam" />
        </g>
        {exporters.map((e, i) => {
          const a = i * 2.399 + 0.6;
          const r = 18 + e.risk_score * (R - 28);
          const x = C + r * Math.cos(a);
          const y = C + r * Math.sin(a);
          const cls = riskClass(e.risk_score);
          return (
            <g key={e.address} className={`blip ${cls}`}>
              <circle cx={x} cy={y} r={cls === "bad" ? 7 : 5} />
              {cls === "bad" && <circle cx={x} cy={y} r={7} className="halo" />}
              <text x={x + (x > C ? -12 : 12)} y={y + 4} textAnchor={x > C ? "end" : "start"}>
                {shortHex(e.address, 3)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
