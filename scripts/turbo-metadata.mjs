// No login, no funded wallet: dedicated local key signs only Arweave data items.
import {TurboUpload} from '@ardrive/turbo-upload';
import {Keypair} from '@solana/web3.js';
import {readFileSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
export function turboClient(file='.metadata-upload-keypair.json'){
 if(!existsSync(file))writeFileSync(file,JSON.stringify(Array.from(Keypair.generate().secretKey)),{mode:0o600,flag:'wx'});
 if((statSync(file).mode&0o777)!==0o600)throw new Error('Metadata signer file must have mode0600');
 return TurboUpload.production({jwk:JSON.parse(readFileSync(file)),token:'solana',timeoutMs:30_000,retry:{retries:0}});
}
export async function assertFreeUpload(client,size){
 const [info,quota,balance]=await Promise.all([client.getInfo(),client.getFreeQuota(),client.getBalance()]);
 const limit=info.freeTier?.maxItemBytes??info.freeUploadLimitBytes;
 if(!Number.isSafeInteger(limit)||limit<=0||size>limit)throw new Error('Signed item exceeds the live free upload limit; use a smaller image');
 if(quota.bytesRemaining!==null&&(!Number.isSafeInteger(quota.bytesRemaining)||quota.bytesRemaining<size))throw new Error('Free upload quota exhausted; no payment attempted');
 // An unfunded, zero-credit signer cannot silently fall back to a charged upload.
 if(BigInt(balance.winc)!==0n||BigInt(balance.effectiveBalance??balance.winc)!==0n)throw new Error('Free-only metadata signer must have zero Turbo credits');
 return {maxItemBytes:limit,bytesRemaining:quota.bytesRemaining,signedItemBytes:size};
}
export async function uploadFreeTurbo(client,bytes,type,onPrepared=()=>{}){
 const item=client.sign({data:bytes,tags:[{name:'Content-Type',value:type},{name:'App-Name',value:'Ratchet-Metadata'}]});
 const limits=await assertFreeUpload(client,item.binary.length);
 onPrepared({id:item.idB64Url,sha256:createHash('sha256').update(bytes).digest('hex'),...limits});
 const receipt=await client.uploadSigned(item,{chunking:'disabled'});
 if(receipt.id!==item.idB64Url||String(receipt.winc)!=='0')throw new Error('Unexpected upload identity or nonzero charge');
 return {uri:'https://turbo-gateway.com/'+receipt.id,storageUri:'ar://'+receipt.id,receipt};
}
export async function verifyTurbo(uri,expected,{fetcher=fetch,attempts=6,pause=()=>new Promise(r=>setTimeout(r,3000))}={}){
 if(!/^https:\/\/turbo-gateway\.com\/[\w-]{43}$/.test(uri))throw new Error('Invalid Turbo data URL');
 let response;for(let i=0;i<attempts;i++){
  response=await fetcher(uri.replace('.com/','.com/raw/'),{signal:AbortSignal.timeout(20_000)});
  if(response.ok)break;
  if(response.status!==404||i===attempts-1)throw new Error('Gateway readback failed (HTTP '+response.status+')');await pause();
 }
 const got=Buffer.from(await response.arrayBuffer()),hash=b=>createHash('sha256').update(b).digest('hex');
 if(hash(got)!==hash(expected))throw new Error('Gateway content does not match uploaded bytes');
 const digest=response.headers.get('x-ar-io-digest');
 if(digest&&digest!==createHash('sha256').update(expected).digest('base64url'))throw new Error('Gateway digest mismatch');
 return {sha256:hash(got),contentType:response.headers.get('content-type'),gatewayVerified:response.headers.get('x-ar-io-verified')==='true',chainStable:response.headers.get('x-ar-io-stable')==='true'};
}
