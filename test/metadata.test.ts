import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {metadataInput,pinFile,verifyPinned} from '../scripts/pin-metadata.mjs';
test('metadata rejects invalid assets and UTF-8 byte limits before uploading',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ratchet-metadata-'));try{const file=join(dir,'image.png');writeFileSync(file,'not PNG');assert.throws(()=>metadataInput(file,'Name','T'));writeFileSync(file,Buffer.from('89504e470d0a1a0a','hex'));assert.throws(()=>metadataInput(file,'Name','T'));writeFileSync(file,readFileSync('test/fixtures/metadata-check.png'));assert.equal(metadataInput(file,'Name','T').type,'image/png');const damaged=readFileSync(file);damaged[damaged.length-5]^=1;writeFileSync(file,damaged);assert.throws(()=>metadataInput(file,'Name','T'));writeFileSync(file,readFileSync('test/fixtures/metadata-check.png'));assert.throws(()=>metadataInput(file,'🪜'.repeat(9),'T'));assert.throws(()=>metadataInput(file,'Name','x'.repeat(11)));}finally{rmSync(dir,{recursive:true});}
});
test('public Pinata uploads validate CIDs and byte-for-byte gateway retrieval',async()=>{
 const bytes=Buffer.from('sample'),cid='Qm'+'a'.repeat(44);
 const uri=await pinFile(bytes,'application/json','metadata.json',{token:'test',fetcher:async(url,init)=>{assert.equal(url,'https://uploads.pinata.cloud/v3/files');assert.equal((init?.body as FormData).get('network'),'public');return Response.json({data:{cid}});}});
 assert.equal(uri,'ipfs://'+cid);await verifyPinned(uri,bytes,{fetcher:async()=>new Response(bytes)});
 await assert.rejects(()=>verifyPinned(uri,bytes,{fetcher:async()=>new Response('wrong')}),/does not match/);
 await assert.rejects(()=>pinFile(bytes,'application/json','metadata.json',{token:'test',fetcher:async()=>Response.json({data:{cid:'../bad'}})}),/invalid CID/);
});
