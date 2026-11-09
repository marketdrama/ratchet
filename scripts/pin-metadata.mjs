// Pin public image + immutable JSON before create. Credentials stay in the environment.
import {readFileSync,statSync,writeFileSync,existsSync} from 'node:fs';
import {basename,extname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function metadataInput(image,name,symbol,description=''){
  if(!name?.trim()||!symbol?.trim()||Buffer.byteLength(name)>32||Buffer.byteLength(symbol)>10)throw new Error('Invalid name/ticker or on-chain byte limit exceeded');
  if(Buffer.byteLength(description)>4000)throw new Error('Description exceeds 4000 bytes');
  if(statSync(image).size>5*1024*1024)throw new Error('Image must be at most 5 MB');
  const type={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extname(image).toLowerCase()];
  const bytes=readFileSync(image);
  const valid=type==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='image/webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':false;
  if(!valid)throw new Error('Image must contain PNG, JPEG or WebP bytes matching its extension');
  return {bytes,type,name,symbol,description};
}
export async function pinFile(bytes,type,filename,{token=process.env.PINATA_JWT,fetcher=fetch}={}){
  if(!token)throw new Error('PINATA_JWT is not configured');
  const body=new FormData();body.append('file',new Blob([bytes],{type}),filename);body.append('network','public');
  const result=await fetcher('https://uploads.pinata.cloud/v3/files',{method:'POST',headers:{Authorization:'Bearer '+token},body,signal:AbortSignal.timeout(60_000)});
  if(!result.ok)throw new Error('Pinning failed (HTTP '+result.status+')');
  const cid=(await result.json()).data?.cid;
  if(typeof cid!=='string'||!(/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/).test(cid))throw new Error('Pinning returned invalid CID');
  return 'ipfs://'+cid;
}
export async function verifyPinned(uri,expected,{fetcher=fetch,gateway=process.env.IPFS_GATEWAY??'https://ipfs.io/ipfs/'}={}){
  if(!uri.startsWith('ipfs://')||!gateway.startsWith('https://'))throw new Error('Invalid public gateway/URI');
  const response=await fetcher(gateway.replace(/\/?$/,'/')+uri.slice(7),{signal:AbortSignal.timeout(60_000)});
  if(!response.ok)throw new Error('Pinned content not publicly retrievable yet');
  const bytes=Buffer.from(await response.arrayBuffer());if(hash(bytes)!==hash(expected))throw new Error('Gateway content does not match uploaded bytes');
}
async function main(){
  const [image,name,symbol]=process.argv.slice(2),receipt=process.env.METADATA_RECEIPT;
  if(!receipt||existsSync(receipt))throw new Error('Set METADATA_RECEIPT to a new receipt path before uploading');
  const input=metadataInput(image,name,symbol,process.env.DESCRIPTION??'');
  const record={name,symbol,imageSha256:hash(input.bytes),verified:false};
  // Reserve receipt before a billable upload; bad paths must fail before pinning.
  writeFileSync(receipt,JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});
  const save=()=>writeFileSync(receipt,JSON.stringify(record,null,2)+'\n',{mode:0o600});
  record.image=await pinFile(input.bytes,input.type,basename(image));save();
  await verifyPinned(record.image,input.bytes);
  const metadata={name,symbol,image:record.image,description:input.description,properties:{files:[{uri:record.image,type:input.type}],category:'image'}};
  const bytes=Buffer.from(JSON.stringify(metadata));record.metadataSha256=hash(bytes);
  record.uri=await pinFile(bytes,'application/json','metadata.json');save();
  await verifyPinned(record.uri,bytes);record.verified=true;record.verifiedAt=new Date().toISOString();save();
  console.log(JSON.stringify(record,null,2));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
