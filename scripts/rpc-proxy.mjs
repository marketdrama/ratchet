// Private loopback bridge for CLI tools; keeps authenticated URL out of argv/logs.
import {createServer} from 'node:http';
import {forwardRpc,MAX_RPC_BYTES} from '../server/rpc.mjs';
const relay=body=>forwardRpc(body,{fetcher:async(url,init)=>{for(let i=0;i<5;i++){const response=await fetch(url,init);if(response.status!==429||i===4)return response;await response.body?.cancel();await new Promise(r=>setTimeout(r,500*2**i));}throw Error('RPC rate limited');}});
const port=Number(process.env.RPC_PROXY_PORT??18998);
if(!process.env.RPC_URL)throw new Error('RPC_URL required (load .env.operations privately)');
createServer(async(req,res)=>{
  if(req.method!=='POST'){res.writeHead(405);return res.end();}
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>MAX_RPC_BYTES){res.writeHead(413);res.end();return;}}
  // Agave requests the full feature set in one getMultipleAccounts call. Some
  // providers cap each call at 5 keys; chunk only this local CLI bridge.
  let response;
  try{const c=JSON.parse(body);if(c.method==='getMultipleAccounts'&&Array.isArray(c.params?.[0])&&c.params[0].length>5){
    const chunks=[];let context;for(let i=0;i<c.params[0].length;i+=5){
      const part=await relay(JSON.stringify({...c,params:[c.params[0].slice(i,i+5),...c.params.slice(1)]}));
      const data=JSON.parse(await part.text(),(key,value,source)=>typeof value==='number'&&!Number.isSafeInteger(value)?JSON.rawJSON(source.source):value);
      if(!part.ok||data.error)throw Error('Feature account read failed');context??=data.result.context;chunks.push(...data.result.value);await new Promise(r=>setTimeout(r,120));
    }response=Response.json({jsonrpc:'2.0',id:c.id,result:{context,value:chunks}});
  }else response=await relay(body);}catch{response=Response.json({error:'RPC temporarily unavailable'},{status:502});}
  res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());
}).listen(port,'127.0.0.1',()=>console.log('Private read-only RPC bridge listening on loopback port '+port));
