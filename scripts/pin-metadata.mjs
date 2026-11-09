// Host image + immutable JSON before create. Default: no-login, free-only Turbo/Arweave.
import {readFileSync,statSync,writeFileSync,existsSync} from 'node:fs';
import {basename,extname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {turboClient,uploadFreeTurbo,verifyTurbo} from './turbo-metadata.mjs';
function validPng(bytes){
 if(!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return false;
 let offset=8,header=false,pixels=false;
 while(offset+12<=bytes.length){
  const size=bytes.readUInt32BE(offset),end=offset+12+size;if(end>bytes.length)return false;
  const kind=bytes.subarray(offset+4,offset+8).toString('ascii');
  if(crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))return false;
  if(!header){if(kind!=='IHDR'||size!==13)return false;header=true;}
  if(kind==='IDAT')pixels=true;
  if(kind==='IEND')return header&&pixels&&size===0&&end===bytes.length;
  offset=end;
 }return false;
}
const hash=b=>createHash('sha256').update(b).digest('hex');
export function metadataInput(image,name,symbol,description=''){
  if(!name?.trim()||!symbol?.trim()||Buffer.byteLength(name)>32||Buffer.byteLength(symbol)>10)throw new Error('Invalid name/ticker or on-chain byte limit exceeded');
  if(Buffer.byteLength(description)>4000)throw new Error('Description exceeds 4000 bytes');
  if(statSync(image).size>5*1024*1024)throw new Error('Image must be at most 5 MB');
  const type={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extname(image).toLowerCase()];
  const bytes=readFileSync(image);
  const valid=type==='image/png'?validPng(bytes):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='image/webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':false;
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
  const provider=process.env.METADATA_PROVIDER??'turbo';
  if(!['turbo','pinata'].includes(provider))throw new Error('METADATA_PROVIDER must be turbo or pinata');
  if(!receipt)throw new Error('Set METADATA_RECEIPT to a persistent receipt path');
  const input=metadataInput(image,name,symbol,process.env.DESCRIPTION??'');
  if(provider==='turbo'&&input.bytes.length>100*1024)throw new Error('Free-only Turbo images must be at most100KiB; resize/compress the asset first');
  const identity={name,symbol,provider,imageSha256:hash(input.bytes),description:input.description};
  const record=existsSync(receipt)?JSON.parse(readFileSync(receipt)):{...identity,verified:false};
  for(const [k,v] of Object.entries(identity))if(record[k]!==v)throw new Error('Receipt belongs to different metadata: '+k);
  if(!existsSync(receipt))writeFileSync(receipt,JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});
  const save=()=>writeFileSync(receipt,JSON.stringify(record,null,2)+'\n',{mode:0o600});
  const client=provider==='turbo'?turboClient(process.env.METADATA_UPLOAD_KEYPAIR):null;
  async function upload(field,bytes,type,filename){
    if(record[field])return record[field];
    if(provider==='pinata')record[field]=await pinFile(bytes,type,filename);
    else {
      const uploaded=await uploadFreeTurbo(client,bytes,type,prepared=>{
        if(record[field+'Prepared']?.id&&record[field+'Prepared'].id!==prepared.id)throw new Error('Pending upload identity changed');
        record[field+'Prepared']=prepared;save();
      });
      record[field]=uploaded.uri;record[field+'Upload']=uploaded;
    }save();return record[field];
  }
  async function verify(field,bytes){
    if(provider==='turbo')record[field+'Readback']=await verifyTurbo(record[field],bytes);
    else await verifyPinned(record[field],bytes);
    save();
  }
  await upload('image',input.bytes,input.type,basename(image));await verify('image',input.bytes);
  const metadata={name,symbol,image:record.image,description:input.description,properties:{files:[{uri:record.image,type:input.type}],category:'image'}};
  const bytes=Buffer.from(JSON.stringify(metadata));record.metadataSha256=hash(bytes);save();
  await upload('uri',bytes,'application/json','metadata.json');await verify('uri',bytes);
  record.verified=true;record.verifiedAt=new Date().toISOString();save();
  console.log(JSON.stringify({provider,uri:record.uri,image:record.image,verified:true,chargedWinc:provider==='turbo'?'0':undefined,receipt},null,2));
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
