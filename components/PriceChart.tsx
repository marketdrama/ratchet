"use client";
import type { CoinView } from "@/lib/coinview";
import { curveSamples, curvePriceAt } from "./curve";
import { priceStr } from "./num";

// The bonding curve, drawn exactly from on-chain params (see curve.ts). X = journey to
// graduation (0 → 100%); Y = price. Solid accent = priced in so far, faint = the road
// ahead. A green band at the bottom is the ratcheting floor: the price can fall into the
// shaded zone, but the vault catches every seller at the floor line — and that line only
// ever rises. The pulsing dot is the live spot price, polled on-chain.
export function PriceChart({ coin }: { coin: CoinView }) {
  const W = 720, H = 268, L = 10, R = 54, T = 16, B = 30;
  const samples = curveSamples(56);
  const prog = Math.max(0.0001, Math.min(1, coin.progress / 100));

  const top = Math.max(curvePriceAt(1), coin.spot) * 1.12;
  const x = (f: number) => L + f * (W - L - R);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);

  const path = (pts: { x: number; p: number }[]) =>
    pts.map((d, i) => `${i ? "L" : "M"}${x(d.x).toFixed(1)} ${y(d.p).toFixed(1)}`).join(" ");

  const soFar = samples.filter((s) => s.x <= prog);
  // make sure the solid part reaches exactly the current position
  soFar.push({ x: prog, p: curvePriceAt(prog) });
  const ahead = samples.filter((s) => s.x >= prog);

  const dotX = x(prog), dotY = y(coin.spot);
  const floorY = y(coin.floor);
  const area = `${path(soFar)} L${x(prog).toFixed(1)} ${H - B} L${L} ${H - B} Z`;

  const gid = `g-${coin.mint.slice(0, 6)}`;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* floor protected band */}
        <rect x={L} y={floorY} width={W - L - R} height={Math.max(0, H - B - floorY)}
          fill="rgba(43,213,118,0.08)" />
        <line x1={L} y1={floorY} x2={W - R} y2={floorY} stroke="var(--up)" strokeWidth="1.5"
          strokeDasharray="5 4" />

        {/* road ahead (faint) */}
        <path d={path(ahead)} fill="none" stroke="var(--border-2)" strokeWidth="2"
          strokeDasharray="3 4" />
        {/* priced in */}
        <path d={area} fill={`url(#${gid})`} />
        <path d={path(soFar)} fill="none" stroke="var(--accent)" strokeWidth="2.5"
          strokeLinejoin="round" strokeLinecap="round" />

        {/* graduation marker */}
        <line x1={x(1)} y1={T} x2={x(1)} y2={H - B} stroke="var(--border-2)" strokeWidth="1" />
        <text x={x(1)} y={T - 4} textAnchor="end" fontSize="10" fill="var(--dim)">graduation</text>

        {/* current spot dot */}
        <circle cx={dotX} cy={dotY} r="8" fill="var(--accent)" opacity="0.18">
          <animate attributeName="r" values="7;12;7" dur="2.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.22;0;0.22" dur="2.2s" repeatCount="indefinite" />
        </circle>
        <circle cx={dotX} cy={dotY} r="4.5" fill="var(--accent)" stroke="var(--bg)" strokeWidth="2" />

        {/* labels on the right gutter */}
        <text x={W - R + 6} y={dotY + 4} fontSize="11" fill="var(--text)" fontWeight="700"
          className="mono">{priceStr(coin.spot)}</text>
        <text x={W - R + 6} y={Math.min(H - B - 2, floorY + 13)} fontSize="10" fill="var(--up)"
          className="mono">floor</text>
      </svg>
      <div className="chart-x">
        <span>launch</span>
        <span className="mono">{coin.progress.toFixed(0)}% in{coin.graduated ? " · graduated" : ""}</span>
        <span>graduation →</span>
      </div>
    </div>
  );
}
