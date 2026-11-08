// In-browser simulated market. Each coin runs a real RatchetCurve (lib/ratchet.ts);
// bots trade on a tick so the launchpad feels alive without a chain. The on-chain
// phase (Anchor pump fork) replaces this store with an indexer — the UI stays the same.
import { RatchetCurve, DEFAULT_PARAMS } from "./ratchet";

export const SOL_USD = 180;
export type Grade = "A" | "B" | "C" | "D" | "F";

export interface Point { t: number; spot: number; floor: number }
export interface Trade { t: number; kind: "buy" | "sell"; who: string; sol: number; tokens: number; floor: boolean }

export interface Coin {
  mint: string;
  name: string;
  symbol: string;
  emoji: string;
  creator: string;
  createdAt: number;
  curve: RatchetCurve;
  grade: Grade;
  snipers: number;
  bundled: number;
  clicks: number;
  history: Point[];
  trades: Trade[];
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
type Rng = () => number;
// Small seeded PRNG so the seed coins (and their mints) are identical on every
// page load — otherwise a full load of /coin/<mint> rebuilds the market with new
// random mints and the coin can't be found.
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]) => a[rnd(a.length)];
const idFrom = (rng: Rng, len: number) => Array.from({ length: len }, () => B58[Math.floor(rng() * B58.length)]).join("");
export const mintId = (rng: Rng = Math.random) => idFrom(rng, 40) + "high";
const wallet = (rng: Rng = Math.random) => idFrom(rng, 44);

const SEED: Array<[string, string, string]> = [
  ["only up", "UP", "📈"], ["Ratchet Cat", "RCAT", "🐈"], ["Click Clack", "CLACK", "🔧"],
  ["Never Down", "NVRD", "🚀"], ["Floor Gang", "FLOOR", "🧱"], ["Higher Pill", "PILL", "💊"],
  ["Diamond Ratchet", "DRCH", "💎"], ["Up Mechanism", "MECH", "⚙️"], ["Stonks Only", "STONK", "📊"],
  ["Bedrock", "ROCK", "🪨"], ["The Ladder", "LADR", "🪜"], ["Antigravity", "AGRAV", "🛸"],
];

function gradeFrom(snipers: number, bundled: number): Grade {
  const risk = snipers * 1.2 + bundled;
  if (risk < 4) return "A";
  if (risk < 9) return "B";
  if (risk < 16) return "C";
  if (risk < 24) return "D";
  return "F";
}

function record(c: Coin) {
  c.history.push({ t: Date.now(), spot: c.curve.spotPrice(), floor: c.curve.floorPrice() });
  if (c.history.length > 160) c.history.shift();
}

function newCoin(name: string, symbol: string, emoji: string, creator?: string, ageMin = 0, rng: Rng = Math.random): Coin {
  const snipers = Math.floor(rng() * 9);
  const bundled = Math.floor(rng() * 12);
  const curve = new RatchetCurve(DEFAULT_PARAMS);
  const c: Coin = {
    mint: mintId(rng), name, symbol, emoji, creator: creator ?? wallet(rng),
    createdAt: Date.now() - ageMin * 60_000,
    curve, grade: gradeFrom(snipers, bundled), snipers, bundled,
    clicks: 0, history: [], trades: [],
  };
  record(c);
  return c;
}

function trade(c: Coin, kind: "buy" | "sell", who: string, amount: number): Trade | null {
  if (c.curve.complete) return null;
  let t: Trade;
  try {
    if (kind === "buy") {
      const r = c.curve.buy(BigInt(Math.round(amount * 1e9)));
      if (r.clicked) c.clicks++;
      t = { t: Date.now(), kind, who, sol: amount, tokens: Number(r.tokens) / 1e6, floor: false };
    } else {
      const tokens = BigInt(Math.round(amount));
      if (tokens <= 0n || tokens > c.curve.circulating) return null;
      const r = c.curve.sell(tokens);
      t = { t: Date.now(), kind, who, sol: Number(r.solOut) / 1e9, tokens: Number(tokens) / 1e6, floor: !!r.paidFromFloor };
    }
  } catch { return null; }
  c.trades.unshift(t);
  if (c.trades.length > 60) c.trades.pop();
  record(c);
  return t;
}

class Market {
  coins: Coin[] = [];
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const srng = mulberry32(0xC0FFEE);
    this.coins = SEED.map(([n, s, e], i) => newCoin(n, s, e, undefined, (SEED.length - i) * 7, srng));
    // warm the seeded coins with some history so charts aren't empty
    for (const c of this.coins) {
      const buys = 2 + rnd(30);
      for (let i = 0; i < buys; i++) trade(c, "buy", wallet(), 0.2 + Math.random() * 2.5);
      const sells = rnd(8);
      for (let i = 0; i < sells; i++) trade(c, "sell", wallet(), Number(c.curve.circulating) * (0.01 + Math.random() * 0.06));
    }
  }

  start() {
    if (this.timer || typeof window === "undefined") return;
    this.timer = setInterval(() => this.tick(), 1600);
  }

  private tick() {
    const n = 1 + rnd(3);
    for (let i = 0; i < n; i++) {
      const c = pick(this.coins);
      if (c.curve.complete) continue;
      const sell = Math.random() < 0.38 && c.curve.circulating > 0n;
      if (sell) trade(c, "sell", wallet(), Number(c.curve.circulating) * (0.01 + Math.random() * 0.08));
      else trade(c, "buy", wallet(), 0.1 + Math.random() * 3);
    }
    this.emit();
  }

  get(mint: string) { return this.coins.find((c) => c.mint === mint); }

  createCoin(name: string, symbol: string, emoji: string, creator: string) {
    const c = newCoin(name || "Unnamed", symbol || "COIN", emoji || "🪙", creator, 0);
    this.coins.unshift(c);
    this.emit();
    return c;
  }

  userTrade(mint: string, kind: "buy" | "sell", amount: number, who = "you"): Trade | null {
    const c = this.get(mint);
    if (!c) return null;
    const t = trade(c, kind, who, amount);
    this.emit();
    return t;
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); this.start(); return () => { this.listeners.delete(fn); }; };
  private emit() { this.version++; for (const fn of this.listeners) fn(); }
  version = 0;
  getSnapshot = () => this.version;
}

let _m: Market | null = null;
export function market(): Market {
  if (!_m) _m = new Market();
  return _m;
}

export function marketCapUsd(c: Coin): number {
  const wholeSupply = Number(c.curve.p.tokenTotalSupply) / 1e6;
  return c.curve.spotPrice() * wholeSupply * SOL_USD;
}
