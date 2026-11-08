import { test } from "node:test";
import assert from "node:assert/strict";
import { RatchetCurve, DEFAULT_PARAMS, type CurveParams } from "../lib/ratchet.ts";

const SOL = (n: number) => BigInt(Math.round(n * 1e9));
const SCALE = 1_000_000_000_000_000_000n;

// A floorless control: same curve, no tax diversion (buy or sell), no floor cut.
const FLOORLESS: CurveParams = { ...DEFAULT_PARAMS, feeBps: 0n, sellFeeBps: 0n, floorCutBps: 0n };

test("buyer gets fewer tokens than a floorless curve (they fund the floor)", () => {
  const ratchet = new RatchetCurve(DEFAULT_PARAMS);
  const control = new RatchetCurve(FLOORLESS);
  const got = ratchet.buy(SOL(1)).tokens;
  const base = control.buy(SOL(1)).tokens;
  assert.ok(got < base, "ratchet buyer should receive fewer tokens");
  // 1.25% tax to floor -> ~1.25% fewer tokens, within rounding
  const ratio = Number(got) / Number(base);
  assert.ok(ratio > 0.985 && ratio < 0.99, `token ratio ${ratio} ~ 0.9875`);
});

test("floor only ever clicks up, never down", () => {
  const c = new RatchetCurve(DEFAULT_PARAMS);
  let prev = 0n;
  const ops: Array<["buy" | "sell", number]> = [
    ["buy", 2], ["buy", 5], ["sell", 0.3], ["buy", 1], ["sell", 0.9], ["buy", 3], ["sell", 0.5],
  ];
  for (const [kind, amt] of ops) {
    if (kind === "buy") c.buy(SOL(amt));
    else c.sell((c.circulating * BigInt(Math.round(amt * 100))) / 100n);
    assert.ok(c.floorScaled >= prev, `floor dropped: ${c.floorScaled} < ${prev}`);
    prev = c.floorScaled;
  }
});

test("always solvent: vault can pay the floor to every holder", () => {
  const c = new RatchetCurve(DEFAULT_PARAMS);
  const SCALE = 1_000_000_000_000_000_000n;
  const check = () => {
    const owed = (c.circulating * c.floorScaled) / SCALE;
    assert.ok(c.floorVault >= owed, `insolvent: vault ${c.floorVault} < owed ${owed}`);
  };
  c.buy(SOL(3)); check();
  c.buy(SOL(7)); check();
  // everyone dumps in pieces — floor must cover each exit
  for (let i = 0; i < 8; i++) { if (c.circulating > 0n) c.sell(c.circulating / 3n); check(); }
});

// A seller is always paid at least the floor price (the hard guarantee). Normal curve
// sells are taxed into the vault; the tax is taken from the proceeds, never pushing the
// seller below the floor.
test("seller never paid below the floor; normal sells are taxed to the vault", () => {
  const c = new RatchetCurve(DEFAULT_PARAMS);
  c.buy(SOL(3));
  const tokens = c.circulating / 4n;
  const floorOwed = (tokens * c.floorScaled) / SCALE;
  const vaultBefore = c.floorVault;
  const r = c.sell(tokens);
  assert.ok(!r.paidFromFloor, "an early sell trades on the curve, not the backstop");
  assert.ok(r.solOut! >= floorOwed, `paid ${r.solOut} below floor ${floorOwed}`);
  assert.ok(c.floorVault > vaultBefore, "a normal sell adds its tax to the vault");
});

test("the floor ratchets up as volume accrues", () => {
  const c = new RatchetCurve(DEFAULT_PARAMS);
  c.buy(SOL(1));
  const early = c.floorPrice();
  for (let i = 0; i < 20; i++) c.buy(SOL(1));
  const late = c.floorPrice();
  assert.ok(early > 0, "floor should exist after the first buy");
  assert.ok(late > early, `floor should climb with volume: ${late} > ${early}`);
});

// Post-graduation, price trades on an open pool and can crash below the floor.
// The migrated vault is the real floor bid. Simulate by forcing the curve bid
// below the floor and confirming the vault backstops the exit.
test("post-graduation style crash below the floor is backstopped", () => {
  const c = new RatchetCurve(DEFAULT_PARAMS);
  for (let i = 0; i < 60 && !c.complete; i++) c.buy(SOL(2)); // fill vault + graduate
  // crash the open market: drain the curve's SOL bid far below the floor
  c.vSol = c.p.initialVirtualSolReserves / 100n;
  const holder = c.circulating / 1000n;
  const curveBid = (holder * c.vSol) / (c.vTok + holder);
  const r = c.sell(holder);
  assert.ok(r.paidFromFloor, "a sub-floor crash must hit the vault backstop");
  assert.ok(r.solOut! > curveBid, `floor ${r.solOut} beats crashed bid ${curveBid}`);
});

test("sells tax into the vault; a floor payout shrinks it and burns supply", () => {
  const c = new RatchetCurve(DEFAULT_PARAMS);
  c.buy(SOL(4));
  const afterBuy = c.floorVault;
  const r1 = c.sell(c.circulating / 2n); // normal curve sell -> taxed into the vault
  assert.ok(!r1.paidFromFloor, "an early sell is a normal curve sell");
  assert.ok(c.floorVault > afterBuy, "a normal sell adds its tax to the vault");
  // crash the curve below the floor: the next sell must hit the backstop
  c.vSol = c.p.initialVirtualSolReserves / 100n;
  const peak = c.floorVault;
  const circBefore = c.circulating;
  const r2 = c.sell(c.circulating / 2n);
  assert.ok(r2.paidFromFloor, "a sub-floor sell hits the vault backstop");
  assert.ok(c.floorVault < peak, "a floor payout shrinks the vault");
  assert.ok(c.circulating < circBefore, "a floor payout burns supply");
  assert.ok(c.floorVault >= 0n, "vault never goes negative");
});

test("graduation completes when sellable supply is exhausted", () => {
  const c = new RatchetCurve(DEFAULT_PARAMS);
  for (let i = 0; i < 400 && !c.complete; i++) c.buy(SOL(1));
  assert.ok(c.complete, "curve should complete after enough buying");
  assert.equal(c.realTok, 0n);
});

test("dev buy seeds the floor: 25% to the vault, the rest buys on the curve", () => {
  const c = new RatchetCurve(DEFAULT_PARAMS);
  const r = c.devBuy(SOL(4));
  // 25% of the 4 SOL dev buy goes straight to the vault
  assert.equal(c.floorVault, SOL(1), "vault should hold 25% of the dev buy");
  assert.equal(r.toFloor, SOL(1));
  // the dev received tokens for the other 75%
  assert.ok(r.tokens > 0n && c.circulating === r.tokens, "dev holds the bought tokens");
  // the coin opens with a real, non-zero floor that clicked up from 0
  assert.ok(c.floorScaled > 0n && r.clicked, "floor should open non-zero");
  assert.ok(c.floorPrice() > 0, "floor price is positive at launch");
});

test("floor seeded by the dev buy protects an immediate seller", () => {
  const c = new RatchetCurve(DEFAULT_PARAMS);
  c.devBuy(SOL(4));
  const floorBefore = c.floorScaled;
  // sell a sliver right after launch — never paid below the seeded floor
  const some = c.circulating / 20n;
  const res = c.sell(some);
  const floorOut = (some * floorBefore) / SCALE;
  assert.ok((res.solOut ?? 0n) >= floorOut, "seller paid at least the seeded floor");
  assert.ok(c.floorScaled >= floorBefore, "floor never drops");
});

test("dev buy is optional — zero keeps a floorless open (old behavior)", () => {
  const c = new RatchetCurve(DEFAULT_PARAMS);
  assert.equal(c.floorScaled, 0n);
  assert.equal(c.circulating, 0n);
  // a normal first buy still works and funds the floor via the 1.25% tax
  c.buy(SOL(1));
  assert.ok(c.floorVault > 0n && c.floorScaled > 0n);
});
