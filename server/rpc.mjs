// Server-only gateway. Never import into a client module.
const METHODS=new Set(['getAccountInfo','getMultipleAccounts','getProgramAccounts','getBalance','getTokenAccountBalance','getTokenSupply','getTokenAccountsByOwner','getLatestBlockhash','getBlockHeight','getSlot','getGenesisHash','getVersion','getMinimumBalanceForRentExemption','getFeeForMessage','getSignatureStatuses','getTransaction','getSignaturesForAddress','getRecentPrioritizationFees','getHealth','isBlockhashValid','simulateTransaction']);
export const MAX_RPC_BYTES=64*1024;
export async function forwardRpc(body,{url=process.env.RPC_URL,fetcher=fetch}={}){
  if(!url)return Response.json({error:'RPC is not configured'},{status:503});
  let calls;try{if(Buffer.byteLength(body)>MAX_RPC_BYTES)throw 0;const parsed=JSON.parse(body);calls=Array.isArray(parsed)?parsed:[parsed];
    if(!calls.length||calls.length>10||calls.some(c=>!c||c.jsonrpc!=='2.0'||!METHODS.has(c.method)||!(typeof c.id==='string'||typeof c.id==='number')||(c.params!==undefined&&!Array.isArray(c.params))))throw 0;
  }catch{return Response.json({error:'Unsupported RPC request'},{status:400});}
  try{
    if(process.env.RPC_TRACE==='true')console.log('RPC methods:',calls.map(c=>c.method).join(','));
    const response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body,signal:AbortSignal.timeout(60_000),redirect:'error'});
    if(process.env.RPC_TRACE==='true')console.log('RPC HTTP status:',response.status);
    if(!response.ok)return Response.json({error:'RPC temporarily unavailable'},{status:502});
    // Reconstruct allowed fields; provider errors may contain credential-bearing URLs.
    const raw=await response.text(),result=JSON.parse(raw);
    const values=Array.isArray(result)?result:[result];
    if(values.some(c=>c?.error))return Response.json(Array.isArray(result)?calls.map(c=>({jsonrpc:'2.0',id:c.id,error:{code:-32000,message:'RPC request failed'}})):{jsonrpc:'2.0',id:calls[0].id,error:{code:-32000,message:'RPC request failed'}});
    // Forward successful JSON verbatim: re-encoding u64 RPC numbers loses precision.
    return new Response(raw,{headers:{'content-type':'application/json','cache-control':'no-store'}});
  }catch{return Response.json({error:'RPC temporarily unavailable'},{status:502});}
}
