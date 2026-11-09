import {test} from 'node:test';import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';import {TurboUpload} from '@ardrive/turbo-upload';
import {assertFreeUpload,uploadFreeTurbo,verifyTurbo} from '../scripts/turbo-metadata.mjs';
const checks={getInfo:async()=>({freeTier:{maxItemBytes:107520}}),getFreeQuota:async()=>({bytesRemaining:1000000}),getBalance:async()=>({winc:'0'})};
test('Turbo stops before upload for oversize, exhausted quota or funded credits',async()=>{
 await assertFreeUpload(checks,500);
 await assert.rejects(()=>assertFreeUpload(checks,107521),/limit/);
 await assert.rejects(()=>assertFreeUpload({...checks,getFreeQuota:async()=>({bytesRemaining:0})},500),/exhausted/);
 await assert.rejects(()=>assertFreeUpload({...checks,getBalance:async()=>({winc:'1'})},500),/zero Turbo credits/);
});
test('Turbo signs data items deterministically, records identity before upload and requires zero charge',async()=>{
 const real=TurboUpload.production({jwk:Array.from(Keypair.generate().secretKey),token:'solana'});const bytes=Buffer.from('public metadata');
 let prepared=false,posted=0;const client={...checks,sign:real.sign.bind(real),uploadSigned:async(item:any)=>{assert.equal(prepared,true);posted++;return {id:item.idB64Url,winc:'0'};}};
 const a=await uploadFreeTurbo(client,bytes,'application/json',()=>{prepared=true;});const b=await uploadFreeTurbo(client,bytes,'application/json');assert.equal(a.uri,b.uri);assert.equal(posted,2);
 await assert.rejects(()=>uploadFreeTurbo({...client,uploadSigned:async(item:any)=>({id:item.idB64Url,winc:'1'})},bytes,'application/json'),/nonzero/);
});
test('Turbo public readback retries pending indexing, verifies bytes, and distinguishes chain settlement',async()=>{
 const uri='https://turbo-gateway.com/'+'a'.repeat(43),bytes=Buffer.from('public metadata');let calls=0;
 const proof=await verifyTurbo(uri,bytes,{pause:async()=>{},fetcher:async()=>++calls===1?new Response('',{status:404}):new Response(bytes, {headers:{'x-ar-io-stable':'false'}})});
 assert.equal(calls,2);assert.equal(proof.chainStable,false);
 await assert.rejects(()=>verifyTurbo(uri,bytes,{fetcher:async()=>new Response('wrong')}),/does not match/);
});
