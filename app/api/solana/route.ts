import {forwardRpc,MAX_RPC_BYTES} from '../../../server/rpc.mjs';
export const runtime='nodejs';
export async function POST(request:Request){
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Origin not allowed'},{status:403});
  const reader=request.body?.getReader();if(!reader)return Response.json({error:'Body required'},{status:400});
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_RPC_BYTES){await reader.cancel();return Response.json({error:'Request too large'},{status:413});}chunks.push(value);}
  return forwardRpc(Buffer.concat(chunks).toString('utf8'));
}
