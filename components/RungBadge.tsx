"use client";
import type { CoinView } from "@/lib/coinview";

// Floor strength as ladder rungs, 1..5 — a neutral, on-brand signal driven by the real
// floor/spot ratio (and a boost once graduated, where the floor is locked pool depth).
// Replaces the old A–F letter grade, which stamped a scary "F" on every healthy young
// curve coin (floors are naturally ~0.3% of spot before graduation).
export function rungsFor(c: { floor: number; spot: number; graduated: boolean }): number {
  const r = c.spot > 0 ? c.floor / c.spot : 0;
  if (c.graduated) return r > 0.4 ? 5 : r > 0.2 ? 4 : 3;
  if (r > 0.12) return 4;
  if (r > 0.06) return 3;
  if (r > 0.02) return 2;
  return 1;
}

export function RungBadge({ coin, size = 18 }: { coin: CoinView; size?: number }) {
  const n = rungsFor(coin);
  const bars = [0, 1, 2, 3, 4];
  const strong = n >= 4;
  return (
    <span className="rungs" title={`floor strength ${n}/5`} aria-label={`floor strength ${n} of 5`}
      style={{ ["--rsz" as string]: `${size}px` }}>
      {bars.map((i) => (
        <i key={i} className={i < n ? "on" : ""}
          style={{
            height: `${30 + i * 17.5}%`,
            background: i < n ? (strong ? "var(--up)" : "var(--accent)") : "var(--border-2)",
          }} />
      ))}
    </span>
  );
}
