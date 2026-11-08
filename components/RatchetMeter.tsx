"use client";
import type { CoinView } from "@/lib/coinview";
import { Price, vaultUsd } from "./num";
import { rungsFor } from "./RungBadge";

// The floor story. Leading with a "floor as % of spot" bar fails — it's ~0.3% during the
// curve phase, an invisible sliver. So lead with the real guarantee: SOL locked in the
// vault, which can only grow, and a ratchet staircase that makes "clicks up, never down"
// legible. The floor/spot % is kept as an honest secondary readout.
export function RatchetMeter({ coin }: { coin: CoinView }) {
  const pct = coin.spot > 0 ? (coin.floor / coin.spot) * 100 : 0;
  const pctLabel = pct >= 1 ? pct.toFixed(1) : pct.toFixed(2);

  // Illustrative ratchet: discrete steps rising to the current floor. The number of lit
  // rungs scales with how far the floor has ratcheted vs spot (more post-graduation).
  const STEPS = 7;
  const lit = Math.max(2, Math.round((rungsFor(coin) / 5) * STEPS));
  const sw = 232, sh = 76, bw = sw / STEPS;

  return (
    <div className="floor-panel">
      <div className="floor-head">
        <div>
          <div className="k">ratchet floor</div>
          <div className="floor-vault mono">{coin.vaultSol.toFixed(3)} SOL</div>
          <div className="floor-sub">locked · {vaultUsd(coin.vaultSol)} backing the floor</div>
        </div>
        <span className="clicks-up">↑ only clicks up</span>
      </div>

      <svg viewBox={`0 0 ${sw} ${sh}`} width="100%" height={sh} className="ratchet-svg" preserveAspectRatio="none">
        {Array.from({ length: STEPS }).map((_, i) => {
          const h = 10 + (i / (STEPS - 1)) * (sh - 16);
          const on = i < lit;
          return (
            <rect key={i} x={i * bw + 2} y={sh - h} width={bw - 4} height={h} rx="2"
              fill={on ? "var(--up)" : "var(--bg-2)"} opacity={on ? 0.35 + (i / STEPS) * 0.5 : 1}
              stroke={on ? "var(--up)" : "var(--border)"} strokeWidth="1" />
          );
        })}
      </svg>

      <div className="floor-stats">
        <div className="fs">
          <div className="k">floor price</div>
          <div className="fs-v mono up"><Price sol={coin.floor} /></div>
        </div>
        <div className="fs">
          <div className="k">spot price</div>
          <div className="fs-v mono"><Price sol={coin.spot} /></div>
        </div>
        <div className="fs">
          <div className="k">floor / spot</div>
          <div className="fs-v mono">{pctLabel}%</div>
        </div>
      </div>
      <p className="floor-note">
        Sellers are always paid <b>max(spot, floor)</b>. The floor sits {pctLabel}% under spot
        today and rises with every buy{coin.graduated ? " — now locked as pool liquidity." : "."}
      </p>
    </div>
  );
}
