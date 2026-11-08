// Exact bonding-curve price path, derived from the same constant-product params the
// on-chain program uses (lib/chain.ts PARAMS, pump.fun / higher.fun economics):
//   virtualSol 30, virtualToken 1.073e9, realToken 7.931e8 (whole tokens)
//   price(sold) = (vSol * vToken) / (vToken - sold)^2   [SOL per whole token]
// This is deterministic from `progress`, so the chart always renders a real curve
// even before any live ticks arrive. Display only — never routed into a trade.
const V_SOL = 30;
const V_TOKEN = 1.073e9;
const REAL_TOKEN = 7.931e8;
const K = V_SOL * V_TOKEN;

export function curvePriceAt(progressFrac: number): number {
  const sold = Math.max(0, Math.min(1, progressFrac)) * REAL_TOKEN;
  const reserve = V_TOKEN - sold;
  return K / (reserve * reserve);
}

// Sample the curve across the whole journey, 0..1 of graduation.
export function curveSamples(n = 48): { x: number; p: number }[] {
  const out: { x: number; p: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    out.push({ x, p: curvePriceAt(x) });
  }
  return out;
}

export const CURVE = { priceLaunch: curvePriceAt(0), priceGrad: curvePriceAt(1) };
