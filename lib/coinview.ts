"use client";
import type { CoinAccount } from "./chain";

import { getSolPrice, solToUsd } from "./price.ts";
const DEC = 6;

export interface CoinView {
  mint: string; name: string; symbol: string; emoji: string; creator: string;
  spot: number; floor: number; vaultSol: number; progress: number;
  complete: boolean; graduated: boolean; mcUsd: number | null; mcSol: number; usdObservedAt: number | null;
  floorPctOfSpot: number; vaultUsd: number | null;
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
export function marketCapUsd(c: CoinAccount): number | null {
  return solToUsd(spotPrice(c) * (Number(c.totalSupply)/10**DEC));
}

export function view(c: CoinAccount): CoinView {
  return {
    mint: c.mint, name: c.name, symbol: c.symbol, emoji: emojiFor(c.mint), creator: c.creator,
    spot: spotPrice(c), floor: floorPrice(c), vaultSol: Number(c.floorVault) / 1e9,
    progress: progress(c), complete: c.complete, graduated: c.graduated, mcUsd: marketCapUsd(c), mcSol: spotPrice(c)*(Number(c.totalSupply)/10**DEC), usdObservedAt:getSolPrice()?.observedAt??null,
    sellTaxPct: c.sellFeeBps / 100, poolAddress: c.poolAddress,
    floorPctOfSpot: spotPrice(c)>0?floorPrice(c)/spotPrice(c)*100:0, vaultUsd:solToUsd(Number(c.floorVault)/1e9),
  };
}
