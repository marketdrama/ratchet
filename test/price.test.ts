import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSolPrice,freshSolPrice,solToUsd,usdPriceParts,PRICE_MAX_AGE_MS,refreshSolPrice,getSolPrice} from '../lib/price.ts';
test('SOL/USD validates provider units and rejects malformed or stale quotes',()=>{
  const now=Date.now(),quote=parseSolPrice({data:{base:'SOL',currency:'USD',amount:'86.53'}},now);
  assert.equal(solToUsd(2,quote),173.06);
  for(const amount of ['NaN','Infinity','-1','0',''])assert.throws(()=>parseSolPrice({data:{base:'SOL',currency:'USD',amount}}));
  assert.throws(()=>parseSolPrice({data:{base:'BTC',currency:'USD',amount:'86.53'}}));
  assert.throws(()=>parseSolPrice({data:{base:'SOL',currency:'EUR',amount:'86.53'}}));
  assert.equal(freshSolPrice({...quote,observedAt:now-PRICE_MAX_AGE_MS-1},now),null);
  assert.equal(freshSolPrice({...quote,observedAt:now+1},now),null);
  assert.equal(solToUsd(2,null),null);
  assert.equal(usdPriceParts(1,null).lead,'—');
});
test('display refresh shares a single live request and has no invented dollar fallback',async()=>{
  assert.equal(getSolPrice(),null);
  let calls=0;
  const mock=async()=>{calls++;return new Response(JSON.stringify({data:{base:'SOL',currency:'USD',amount:'86.53'}}));};
  const [a,b]=await Promise.all([refreshSolPrice(mock),refreshSolPrice(mock)]);
  assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(a?.usd,86.53);
  assert.equal(usdPriceParts(1).lead,'$86.53');
});
