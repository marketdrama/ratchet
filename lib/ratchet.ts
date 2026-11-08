// Ratchet bonding curve — a constant-product curve (x*y=k on virtual reserves,
// same as pump.fun / higher.fun) with a floor vault that only clicks up.
//
// Funding: every BUY pays a flat 1.25% tax, 100% of which goes into a locked
// floor vault (no platform or creator skim). The floor price = vault / circulating, ratcheted so it can
// only rise. Sells are paid max(curvePrice, floorPrice): if the curve has dumped
// below the floor, the vault buys the seller out at the floor and burns the tokens.
// Solvent by construction. At graduation, curve SOL + vault migrate to the pool.

export interface CurveParams {
  initialVirtualTokenReserves: bigint;
  initialVirtualSolReserves: bigint;
  initialRealTokenReserves: bigint; // sellable supply on the curve
  tokenTotalSupply: bigint;
  feeBps: bigint;        // BUY tax, routed 100% INTO the floor vault (125 = 1.25%)
  sellFeeBps: bigint;    // SELL tax, routed 100% INTO the floor vault (125 = 1.25%). Not charged on
                         // floor-backstop payouts (that would undercut the guaranteed floor price).
  creatorFeeBps: bigint; // creator fee, paid out to creator (not the floor) — unused (0)
  floorCutBps: bigint;   // extra principal cut to the floor vault — unused (0); tax lives in feeBps
}

export const DEFAULT_PARAMS: CurveParams = {
  initialVirtualTokenReserves: 1_073_000_000_000_000n,
  initialVirtualSolReserves: 30_000_000_000n, // 30 SOL virtual (pump-like)
  initialRealTokenReserves: 793_100_000_000_000n,
  tokenTotalSupply: 1_000_000_000_000_000n,
  feeBps: 125n,        // 1.25% BUY tax -> 100% into the floor vault
  sellFeeBps: 125n,    // 1.25% SELL tax -> 100% into the floor vault
  creatorFeeBps: 0n,
  floorCutBps: 0n,     // no extra principal cut; the whole tax is feeBps
};

const BPS = 10_000n;
const SCALE = 1_000_000_000_000_000_000n; // 1e18, floor price fixed-point
const TOKEN_DECIMALS = 6;
// A dev's launch buy seeds the floor: 25% of it goes straight into the vault, the
// rest buys on the curve. The coin opens with a real, ratcheting floor.
export const DEV_FLOOR_CUT_BPS = 2500n; // 25%

export interface Snapshot {
  vSol: bigint; vTok: bigint; realTok: bigint;
  floorVault: bigint; circulating: bigint; floorScaled: bigint;
  complete: boolean;
}

export interface TradeResult {
  kind: "buy" | "sell";
  solIn?: bigint; solOut?: bigint;
  tokens: bigint;
  toFloor?: bigint;        // lamports added to vault (buys)
  paidFromFloor?: boolean; // true if a sell was backstopped by the vault
  spotAfter: number;       // SOL per whole token
  floorAfter: number;      // SOL per whole token
  clicked: boolean;        // did the floor ratchet up on this trade
}

export class RatchetCurve {
  vSol: bigint; vTok: bigint; realTok: bigint;
  realSol = 0n;
  floorVault = 0n;
  circulating = 0n;
  floorScaled = 0n; // floor price per base token, * 1e18 — monotonic non-decreasing
  complete = false;
  readonly p: CurveParams;

  constructor(params: CurveParams = DEFAULT_PARAMS) {
    this.p = params;
    this.vSol = params.initialVirtualSolReserves;
    this.vTok = params.initialVirtualTokenReserves;
    this.realTok = params.initialRealTokenReserves;
  }

  snapshot(): Snapshot {
    return { vSol: this.vSol, vTok: this.vTok, realTok: this.realTok,
      floorVault: this.floorVault, circulating: this.circulating,
      floorScaled: this.floorScaled, complete: this.complete };
  }

  /** SOL per whole token from the live curve. */
  spotPrice(): number {
    if (this.vTok === 0n) return 0;
    return (Number(this.vSol) / 1e9) / (Number(this.vTok) / 10 ** TOKEN_DECIMALS);
  }

  /** SOL per whole token guaranteed by the floor. */
  floorPrice(): number {
    return (Number(this.floorScaled) / Number(SCALE)) * 10 ** TOKEN_DECIMALS / 1e9;
  }

  /** 0..100 of sellable supply sold. */
  progress(): number {
    const initial = this.p.initialRealTokenReserves;
    if (initial === 0n) return 0;
    const sold = initial - this.realTok;
    return Math.min(100, Number((sold * 10_000n) / initial) / 100);
  }

  /** Dev launch buy: 25% of `solIn` seeds the floor vault, the rest buys on the
   *  curve for the dev. Mirrors the program's `create` dev_buy — call once at
   *  creation so the coin opens with a non-zero, ratcheting floor. */
  devBuy(solIn: bigint): TradeResult {
    if (solIn <= 0n) throw new Error("dev buy must be positive");
    const toFloor = (solIn * DEV_FLOOR_CUT_BPS) / BPS; // 25% seeds the floor
    const curveIn = solIn - toFloor;
    if (curveIn <= 0n) throw new Error("dev buy too small");
    let out = (curveIn * this.vTok) / (this.vSol + curveIn);
    if (out > this.realTok) out = this.realTok;
    if (out <= 0n) throw new Error("dev buy too small");
    this.realSol += curveIn;
    this.vSol += curveIn;
    this.vTok -= out;
    this.realTok -= out;
    this.circulating += out;
    this.floorVault += toFloor;
    const clicked = this.ratchet();
    if (this.realTok === 0n) this.complete = true;
    return { kind: "buy", solIn, tokens: out, toFloor,
      spotAfter: this.spotPrice(), floorAfter: this.floorPrice(), clicked };
  }

  /** Buy with `solIn` lamports (gross). Returns tokens received. */
  buy(solIn: bigint): TradeResult {
    if (this.complete) throw new Error("curve complete; trade on the pool");
    if (solIn <= 0n) throw new Error("solIn must be positive");
    const fee = (solIn * this.p.feeBps) / BPS;
    const creatorFee = (solIn * this.p.creatorFeeBps) / BPS;
    const floorCut = (solIn * this.p.floorCutBps) / BPS;
    const curveIn = solIn - fee - creatorFee - floorCut;
    if (curveIn <= 0n) throw new Error("fees exceed input");

    let out = (curveIn * this.vTok) / (this.vSol + curveIn);
    if (out > this.realTok) out = this.realTok; // can't oversell the curve

    // Solvency guard: a buy must never add more floor-liability (out * floor) than
    // it funds into the vault (the 1.25% tax). This only binds if the curve has
    // seeded floor, including during ordinary trading — new tokens must never dilute
    // the existing guarantee. Graduation budget therefore depends on the seed and trade sizes.
    const toFloor0 = fee + floorCut;
    if (this.floorScaled > 0n) {
      const maxOut = (toFloor0 * SCALE) / this.floorScaled;
      if (out > maxOut) out = maxOut;
    }
    if (out <= 0n) throw new Error("buy too small to back new tokens at the floor");

    this.realSol += curveIn;
    this.vSol += curveIn;
    this.vTok -= out;
    this.realTok -= out;
    this.circulating += out;

    // the whole 1.25% tax funds the floor (fee + floorCut; floorCut is 0)
    const toFloor = fee + floorCut;
    this.floorVault += toFloor;

    const clicked = this.ratchet();
    if (this.realTok === 0n) this.complete = true;
    return { kind: "buy", solIn, tokens: out, toFloor,
      spotAfter: this.spotPrice(), floorAfter: this.floorPrice(), clicked };
  }

  /** Sell `tokens` base units. Paid at max(curve, floor). */
  sell(tokens: bigint): TradeResult {
    if (tokens <= 0n) throw new Error("tokens must be positive");
    if (tokens > this.circulating) throw new Error("selling more than circulating");

    let curveOut = (tokens * this.vSol) / (this.vTok + tokens);
    if (curveOut > this.realSol) curveOut = this.realSol;
    // SELL tax on the curve proceeds -> floor vault. Decide backstop vs curve on the
    // NET curve proceeds so a seller is never paid below the guaranteed floor.
    const sellTax = (curveOut * this.p.sellFeeBps) / BPS;
    const curveNet = curveOut - sellTax;
    const floorOut = (tokens * this.floorScaled) / SCALE;

    let solOut: bigint;
    let paidFromFloor = false;
    let clicked = false;
    if (floorOut > curveNet) {
      // floor backstop: vault buys and burns the tokens, curve untouched. NOT taxed —
      // the floor price is a hard guarantee.
      solOut = floorOut;
      this.floorVault -= floorOut;
      this.circulating -= tokens;
      paidFromFloor = true;
    } else {
      // normal curve sell: reserves pay curveOut; the tax stays as floor vault.
      solOut = curveNet;
      this.realSol -= curveOut;
      this.vSol -= curveOut;
      this.vTok += tokens;
      this.realTok += tokens;
      this.circulating -= tokens;
      this.floorVault += sellTax;
      // vault grew + circulating shrank → the floor can click up on a sell too.
      clicked = this.ratchet();
    }
    this.complete = this.realTok === 0n;
    return { kind: "sell", solOut, tokens, paidFromFloor,
      spotAfter: this.spotPrice(), floorAfter: this.floorPrice(), clicked };
  }

  /** Raise the floor to vault/circulating if that's higher. Returns true on a click. */
  private ratchet(): boolean {
    if (this.circulating === 0n) return false;
    const candidate = (this.floorVault * SCALE) / this.circulating;
    if (candidate > this.floorScaled) { this.floorScaled = candidate; return true; }
    return false;
  }

}
