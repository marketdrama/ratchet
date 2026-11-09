import {test} from 'node:test';
import assert from 'node:assert/strict';
import {forwardRpc,MAX_RPC_BYTES} from '../server/rpc.mjs';
const url='https://rpc.invalid/private-token';
const request=(method:string)=>JSON.stringify({jsonrpc:'2.0',id:1,method,params:[]});
test('private RPC gateway rejects writes, malformed and oversized batches before fetching',async()=>{
  let calls=0;const fetcher=async()=>{calls++;throw Error('unreachable');};
  for(const body of [request('sendTransaction'),request('requestAirdrop'),'{}','[]','x'.repeat(MAX_RPC_BYTES+1),JSON.stringify(Array(11).fill(JSON.parse(request('getSlot'))))])assert.equal((await forwardRpc(body,{url,fetcher})).status,400);
  assert.equal(calls,0);
});
test('RPC credentials and provider errors never escape gateway responses',async()=>{
  const fetcher=async()=>Response.json({jsonrpc:'2.0',id:1,error:{code:-32000,message:url,data:url}});
  const r=await forwardRpc(request('getSlot'),{url,fetcher});assert.equal(r.status,200);assert.ok(!(await r.text()).includes('private-token'));
  const failure=await forwardRpc(request('getSlot'),{url,fetcher:async()=>{throw Error(url);}});assert.equal(failure.status,502);assert.ok(!(await failure.text()).includes('private-token'));
  const ok=await forwardRpc(request('getSlot'),{url,fetcher:async()=>Response.json({id:1,result:123})});assert.equal((await ok.json()).result,123);
});

test('gateway preserves Solana u64 JSON integers without floating-point roundoff',async()=>{
  const raw='{"jsonrpc":"2.0","id":1,"result":{"rentEpoch":18446744073709551615}}';
  const r=await forwardRpc(request('getAccountInfo'),{url,fetcher:async()=>new Response(raw)});assert.equal(await r.text(),raw);
});
