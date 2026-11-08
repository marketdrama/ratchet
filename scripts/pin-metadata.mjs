// Pin image + immutable coin JSON before create. Uses your configured Pinata account.
// PINATA_JWT=... node scripts/pin-metadata.mjs /absolute/image.png Name SYMBOL
import {readFileSync,statSync} from 'node:fs';
import {basename,extname} from 'node:path';
const [image,name,symbol]=process.argv.slice(2),token=process.env.PINATA_JWT;
if(!token||!image||!name||!symbol)throw new Error('PINATA_JWT and image path, name, symbol are required');
if(Buffer.byteLength(name)>32||Buffer.byteLength(symbol)>10)throw new Error('Name/ticker exceeds on-chain byte limit');
if(statSync(image).size>5*1024*1024)throw new Error('Image must be at most 5 MB');
const type={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extname(image).toLowerCase()];
if(!type)throw new Error('Use PNG, JPEG or WebP');
async function pin(blob,filename){const body=new FormData();body.append('file',blob,filename);
  const result=await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS',{method:'POST',headers:{Authorization:'Bearer '+token},body,signal:AbortSignal.timeout(60_000)});
  if(!result.ok)throw new Error('Pinning failed (HTTP '+result.status+')');
  const data=await result.json();if(!data.IpfsHash)throw new Error('Pinning returned no content hash');return 'ipfs://'+data.IpfsHash;
}
const imageUri=await pin(new Blob([readFileSync(image)],{type}),basename(image));
const metadata={name,symbol,image:imageUri,description:process.env.DESCRIPTION??'',properties:{files:[{uri:imageUri,type}],category:'image'}};
const uri=await pin(new Blob([JSON.stringify(metadata)],{type:'application/json'}),'metadata.json');
console.log(JSON.stringify({uri,image:imageUri,name,symbol},null,2));
