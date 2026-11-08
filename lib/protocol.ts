// Integer quotes shared by the browser, release tooling and regression tests.
export const SCALE = 10n ** 18n;
export const BPS = 10_000n;
export const MIGRATION_RESERVE = 300_000_000n;
export const PRODUCTION = {
  virtualSol: 30_000_000_000n, virtualToken: 1_073_000_000_000_000n,
  realToken: 793_100_000_000_000n, totalSupply: 1_000_000_000_000_000n,
  feeBps: 125, floorCutBps: 0,
};
// Test fixture belongs on a separate test deployment. Never initialize mainnet with it.
export const TEST_PARAMS = { ...PRODUCTION, virtualSol: 500_000_000n };
export interface QuoteState {
  virtualSol: bigint; virtualToken: bigint; realSol: bigint; realToken: bigint;
  floorVault: bigint; floorScaled: bigint; sellFeeBps: number; graduated: boolean;
}
export function quoteBuy(c: QuoteState, sol: bigint): bigint {
  if (c.graduated || c.realToken === 0n || sol <= 0n) return 0n;
  const fee = sol * 125n / BPS;
  const net = sol - fee;
  let out = net * c.virtualToken / (c.virtualSol + net);
  if (out > c.realToken) out = c.realToken;
  if (c.floorScaled > 0n) {
    const backed = fee * SCALE / c.floorScaled;
    if (out > backed) out = backed;
  }
  return out;
}
export function quoteSell(c: QuoteState, tokens: bigint): bigint {
  if (tokens <= 0n) return 0n;
  const floor = tokens * c.floorScaled / SCALE;
  if (c.graduated) return floor;
  let curve = tokens * c.virtualSol / (c.virtualToken + tokens);
  if (curve > c.realSol) curve = c.realSol;
  const net = curve - curve * BigInt(c.sellFeeBps) / BPS;
  return floor > net ? floor : net;
}
export function migrationBudget(realSol: bigint, vault: bigint, floor: bigint, supply: bigint) {
  const liability = (supply * floor + SCALE - 1n) / SCALE;
  const retainedFloor = liability > vault ? liability : vault;
  const topUp = retainedFloor - vault;
  const liquidity = realSol - topUp - MIGRATION_RESERVE;
  if (liquidity <= 0n) throw new Error("Reserves cannot cover all-token floor backing and migration costs");
  return { retainedFloor, topUp, liquidity };
}
export function minOutput(quote: bigint, bps = 100): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 500) throw new Error("Slippage must be 0–500 bps");
  const out = quote * (BPS - BigInt(bps)) / BPS;
  if (out <= 0n) throw new Error("Amount too small for a protected trade");
  return out;
}
export function solAmount(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(Math.round(value * 1e9))) throw new Error("Invalid SOL amount");
  return BigInt(Math.round(value * 1e9));
}
