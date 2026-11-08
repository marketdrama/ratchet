// Property/fuzz tests for the ratchet engine. The on-chain program (onchain/src/lib.rs)
// mirrors this math exactly (same u128 truncating ops), so the invariants proven here
// are the program's invariants. Deterministic seeded PRNG -> reproducible in CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RatchetCurve, DEFAULT_PARAMS, type CurveParams } from "../lib/ratchet.ts";

const SCALE = 1_000_000_000_000_000_000n;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const INIT_REAL = DEFAULT_PARAMS.initialRealTokenReserves;

// tiny deterministic PRNG (mulberry32)
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Full invariant check on raw bigint state. `burned` is tracked externally.
function invariants(c: RatchetCurve, prevFloor: bigint, burned: bigint, initK: bigint) {
  // 1. no field ever negative
  for (const [k, v] of Object.entries({ vSol: c.vSol, vTok: c.vTok, realTok: c.realTok,
      circulating: c.circulating, floorVault: c.floorVault, floorScaled: c.floorScaled })) {
    assert.ok((v as bigint) >= 0n, `${k} went negative: ${v}`);
  }
  // 2. floor never clicks down
  assert.ok(c.floorScaled >= prevFloor, `floor stepped down: ${c.floorScaled} < ${prevFloor}`);
  // 3. solvency: vault covers the floor owed to every holder
  const owed = (c.circulating * c.floorScaled) / SCALE;
  assert.ok(c.floorVault >= owed, `insolvent: vault ${c.floorVault} < owed ${owed}`);
  // 4. token conservation: sold-out + still-on-curve + burned == initial sellable
  assert.equal(c.realTok + c.circulating + burned, INIT_REAL, "token conservation broken");
  // 5. constant-product never leaks value to the buyer (truncation only grows k)
  assert.ok(c.vSol * c.vTok >= initK, `k shrank below initial: ${c.vSol * c.vTok} < ${initK}`);
  // 6. storage types never overflow their on-chain width
  assert.ok(c.floorVault <= U64_MAX, `floor_vault (u64) overflow: ${c.floorVault}`);
  assert.ok(c.floorScaled <= U128_MAX && c.vSol <= U128_MAX && c.circulating <= U128_MAX,
    "u128 field overflow");
}

test("fuzz: 5000 random buy/sell ops hold every invariant", () => {
  for (let seed = 1; seed <= 5; seed++) {
    const rand = rng(seed * 7919);
    const c = new RatchetCurve(DEFAULT_PARAMS);
    const initK = c.vSol * c.vTok;
    let prevFloor = 0n, burned = 0n;
    for (let i = 0; i < 1000; i++) {
      const buy = rand() < 0.6 || c.circulating === 0n;
      if (buy && !c.complete) {
        const sol = BigInt(Math.floor(rand() * 20e9) + 1); // 1 lamport .. 20 SOL
        const before = c.circulating;
        c.buy(sol);
        assert.ok(c.circulating >= before, "buy must not reduce circulating");
      } else if (!buy && c.circulating > 0n) {
        const t = BigInt(Math.floor(Number(c.circulating) * rand())) + 1n;
        const tok = t > c.circulating ? c.circulating : t;
        const circBefore = c.circulating;
        const floorOwed = (tok * c.floorScaled) / SCALE;
        const r = c.sell(tok);
        // guarantee: a seller is never paid below the floor price (sell tax is taken
        // from the curve proceeds, never pushing a seller below the floor)
        assert.ok(r.solOut! >= floorOwed, `paid ${r.solOut} < floor ${floorOwed}`);
        if (r.paidFromFloor) burned += circBefore - c.circulating;
      }
      invariants(c, prevFloor, burned, initK);
      prevFloor = c.floorScaled;
    }
  }
});

test("edge: dust buys (1 lamport) never break state or oversell", () => {
  const c = new RatchetCurve(DEFAULT_PARAMS);
  const initK = c.vSol * c.vTok;
  for (let i = 0; i < 500; i++) {
    const r = c.buy(1n); // 1 lamport: fee/cut round to 0, curveIn = 1
    assert.ok(r.tokens >= 0n, "dust buy produced negative tokens");
    assert.equal(r.toFloor, 0n, "1-lamport buy diverts 0 to floor (sub-bps dust)");
    invariants(c, 0n, 0n, initK);
  }
});

test("edge: rejects zero / negative / oversell", () => {
  const c = new RatchetCurve(DEFAULT_PARAMS);
  assert.throws(() => c.buy(0n), /positive/);
  assert.throws(() => c.buy(-5n), /positive/);
  c.buy(1_000_000_000n);
  assert.throws(() => c.sell(0n), /positive/);
  assert.throws(() => c.sell(-1n), /positive/);
  assert.throws(() => c.sell(c.circulating + 1n), /more than circulating/);
  assert.throws(() => { while (!c.complete) c.buy(1_000_000_000n); c.buy(1n); }, /complete/);
});

test("overflow bound: whale-sized buys keep floor_vault well under u64", () => {
  // Graduation raises ~96 SOL; vault ends ~10.5 SOL = ~1.05e10 lamports.
  // u64 max is ~1.8e19 — 9 orders of magnitude of headroom. Prove the worst
  // realistic path (giant single buys) stays bounded.
  const c = new RatchetCurve(DEFAULT_PARAMS);
  c.buy(10_000_000_000_000n); // 10,000 SOL in one shot -> instant graduate
  assert.ok(c.complete, "mega buy should graduate");
  assert.ok(c.floorVault < U64_MAX / 1_000_000n, `vault ${c.floorVault} should have huge u64 headroom`);
});

test("concurrency model: many actors interleaved = same invariants (chain serializes txs)", () => {
  // Solana serializes writes to one account, so N users hitting a curve is just an
  // interleaving of single ops. Fuzz random interleavings of 12 actors' buys/sells.
  const rand = rng(424242);
  const c = new RatchetCurve(DEFAULT_PARAMS);
  const initK = c.vSol * c.vTok;
  const held: bigint[] = new Array(12).fill(0n); // per-actor token balance
  let prevFloor = 0n, burned = 0n;
  for (let i = 0; i < 2000; i++) {
    const who = Math.floor(rand() * held.length);
    if ((rand() < 0.6 || held[who] === 0n) && !c.complete) {
      const sol = BigInt(Math.floor(rand() * 5e9) + 1);
      const r = c.buy(sol);
      held[who] += r.tokens; // actor can only sell what they hold
    } else if (held[who] > 0n) {
      const t = BigInt(Math.floor(Number(held[who]) * rand())) + 1n;
      const tok = t > held[who] ? held[who] : t;
      const circBefore = c.circulating;
      const r = c.sell(tok);
      held[who] -= tok;
      if (r.paidFromFloor) burned += circBefore - c.circulating;
    }
    invariants(c, prevFloor, burned, initK);
    prevFloor = c.floorScaled;
  }
  // the sum of actor balances must equal circulating supply (no tokens conjured/lost)
  const sumHeld = held.reduce((a, b) => a + b, 0n);
  assert.equal(sumHeld, c.circulating, `balances ${sumHeld} != circulating ${c.circulating}`);
});
