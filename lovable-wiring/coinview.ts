"use client";
import type { CoinAccount } from "./ratchetClient";

export const SOL_USD = 180;
const DEC = 6;
const INITIAL_REAL_TOKEN = 793_100_000_000_000n; // PARAMS.realToken
const TOTAL_SUPPLY_WHOLE = 1_000_000_000; // 1e15 / 1e6

export interface CoinView {
  mint: string; name: string; symbol: string; emoji: string; creator: string;
  spot: number; floor: number; vaultSol: number; progress: number;
  complete: boolean; graduated: boolean; mcUsd: number;
  floorPctOfSpot: number; vaultUsd: number;
  poolAddress: string;
  sellTaxPct: number; // this coin's sell tax, % (1.25..5)
}

const EMOJIS = ["🪜", "📈", "🚀", "💎", "🔧", "⚙️", "🧱", "🪨", "💊", "🐈", "🛸", "🔩", "🌙", "🔥", "⛰️"];
export function emojiFor(mint: string): string {
  let h = 0;
  for (let i = 0; i < mint.length; i++) h = (h * 31 + mint.charCodeAt(i)) >>> 0;
  return EMOJIS[h % EMOJIS.length];
}

export function spotPrice(c: CoinAccount): number {
  if (c.graduated) {
    if (c.poolTokens === 0n) return 0;
    return (Number(c.marketSol) / 1e9) / (Number(c.poolTokens) / 10 ** DEC);
  }
  if (c.virtualToken === 0n) return 0;
  return (Number(c.virtualSol) / 1e9) / (Number(c.virtualToken) / 10 ** DEC);
}
export function floorPrice(c: CoinAccount): number {
  return (Number(c.floorScaled) / 1e18) * 10 ** DEC / 1e9;
}
export function progress(c: CoinAccount): number {
  if (c.complete || c.graduated) return 100;
  const sold = c.initialRealToken - c.realToken;
  return Math.min(100, Math.max(0, Number((sold * 10_000n) / c.initialRealToken) / 100));
}
export function marketCapUsd(c: CoinAccount): number {
  return spotPrice(c) * TOTAL_SUPPLY_WHOLE * SOL_USD;
}

export function view(c: CoinAccount): CoinView {
  return {
    mint: c.mint, name: c.name, symbol: c.symbol, emoji: emojiFor(c.mint), creator: c.creator,
    spot: spotPrice(c), floor: floorPrice(c), vaultSol: Number(c.floorVault) / 1e9,
    progress: progress(c), complete: c.complete, graduated: c.graduated, mcUsd: marketCapUsd(c),
    sellTaxPct: c.sellFeeBps / 100, poolAddress: c.poolAddress,
    floorPctOfSpot: spotPrice(c)>0?floorPrice(c)/spotPrice(c)*100:0, vaultUsd:Number(c.floorVault)/1e9*SOL_USD,
  };
}

export function priceParts(solPerToken: number): { lead: string; zeros: number | null; digits: string } {
  const usd = solPerToken * SOL_USD;
  if (usd <= 0) return { lead: "$0", zeros: null, digits: "" };
  if (usd >= 1) return { lead: `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, zeros: null, digits: "" };
  if (usd >= 0.001) return { lead: `$${usd.toFixed(4)}`, zeros: null, digits: "" };
  const exp = Math.floor(Math.log10(usd));
  const zeros = -exp - 1;
  const digits = String(Math.round(usd / Math.pow(10, exp - 2))).padStart(3, "0").slice(0, 3);
  return { lead: "$0.0", zeros, digits };
}
export function priceStr(solPerToken: number): string {
  const p = priceParts(solPerToken);
  return p.zeros == null ? p.lead : `$0.0(${p.zeros})${p.digits}`;
}
export function usdCompact(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1e6).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1e3).toFixed(1)}K`;
  return `$${usd.toFixed(0)}`;
}
export function floorPctLabel(pct: number): string {
  return pct >= 1 ? pct.toFixed(1) : pct.toFixed(2); // never shows a misleading "0%"
}
