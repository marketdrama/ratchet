import { test } from "node:test";
import assert from "node:assert/strict";
import { RatchetCurve, DEFAULT_PARAMS } from "../lib/ratchet.ts";
import { quoteBuy, quoteSell, migrationBudget, minOutput, solAmount, SCALE, TEST_PARAMS } from "../lib/protocol.ts";
const state = (c: RatchetCurve) => ({virtualSol:c.vSol, virtualToken:c.vTok, realSol:c.realSol,
  realToken:c.realTok, floorVault:c.floorVault, floorScaled:c.floorScaled, sellFeeBps:125, graduated:false});
test("protected quotes equal floor-capped seeded program math", () => {
  const c = new RatchetCurve(); c.devBuy(1_000_000_000n);
  for (let i=0;i<50;i++) {
    const before = state(c); const expected = quoteBuy(before, 5_000_000_000n);
    assert.equal(c.buy(5_000_000_000n).tokens, expected);
    assert.ok(minOutput(expected) > 0n);
    const tokens = c.circulating / 100n;
    const sellQuote = quoteSell(state(c),tokens);
    assert.equal(c.sell(tokens).solOut, sellQuote);
  }
});
test("migration backs pool tokens as well as existing holders; partial redemptions remain solvent", () => {
  const c=new RatchetCurve(); c.devBuy(1_000_000_000n);
  for(let i=0;i<1000&&!c.complete;i++) c.buy(5_000_000_000n);
  assert.ok(c.complete);
  const b=migrationBudget(c.realSol,c.floorVault,c.floorScaled,DEFAULT_PARAMS.tokenTotalSupply);
  assert.ok(b.retainedFloor*SCALE >= DEFAULT_PARAMS.tokenTotalSupply*c.floorScaled);
  assert.equal(b.topUp+b.liquidity+300_000_000n,c.realSol);
  let vault=b.retainedFloor, supply=DEFAULT_PARAMS.tokenTotalSupply;
  for(let i=0;i<1000;i++) {const n=supply/3n; if(n===0n)break; vault-=n*c.floorScaled/SCALE;supply-=n;
    assert.ok(vault*SCALE >= supply*c.floorScaled);}
});
test("invalid amounts, unsafe slippage and underfunded migrations fail closed",()=>{
  for(const n of [NaN,Infinity,-1,0,Number.MAX_VALUE]) assert.throws(()=>solAmount(n));
  for(const bps of [-1,501,NaN,1.5]) assert.throws(()=>minOutput(1000n,bps));
  assert.throws(()=>migrationBudget(300_000_000n,0n,0n,1n));
});

test("isolated no-seed test fixture graduates with enough reserves for retained floor and Raydium",()=>{
  const c=new RatchetCurve({...DEFAULT_PARAMS,initialVirtualSolReserves:TEST_PARAMS.virtualSol});
  let spent=0n;while(!c.complete&&spent<5_000_000_000n){c.buy(500_000_000n);spent+=500_000_000n;}
  assert.ok(c.complete);assert.ok(spent<=2_000_000_000n);
  assert.ok(migrationBudget(c.realSol,c.floorVault,c.floorScaled,TEST_PARAMS.totalSupply).liquidity>0n);
});
