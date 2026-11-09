// Only public contract inputs enter Docker. No workspace mount, credentials or keypairs.
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const image='solanafoundation/solana-verifiable-build@sha256:a20e03cbd0b96bf3d4084e956cf6d7b47389c7a35508628a82296c3376518be9';
const tool=process.env.SOLANA_VERIFY_BIN??(existsSync(join(homedir(),'.local/bin/solana-verify'))?join(homedir(),'.local/bin/solana-verify'):'solana-verify');
const version=spawnSync(tool,['--version'],{encoding:'utf8'});if(version.status!==0||version.stdout.trim()!=='solana-verify 0.5.2')throw new Error('Install verified official solana-verify 0.5.2');
const root=resolve('onchain'),cache=join(homedir(),'.cache');mkdirSync(cache,{recursive:true});const staging=mkdtempSync(join(cache,'ratchet-build-'));
const inputs=['Cargo.toml','Cargo.lock','programs/ratchet-curve/Cargo.toml','programs/ratchet-curve/src/lib.rs'];
const hashes=Object.fromEntries(inputs.map(f=>[f,sha(readFileSync(join(root,f)))]));
const proofFile='release/isolated-build.json',previous=existsSync(proofFile)?JSON.parse(readFileSync(proofFile)):null;
try{
 for(const f of inputs){mkdirSync(join(staging,f,'..'),{recursive:true});copyFileSync(join(root,f),join(staging,f));}
 const r=spawnSync(tool,['build',staging,'--library-name','ratchet_curve','--base-image',image,'--cargo-build-sbf-args=--tools-version v1.44'],{stdio:'inherit'});
 if(r.status!==0)throw new Error('Isolated build failed');
 const binary=readFileSync(join(staging,'target/deploy/ratchet_curve.so')),artifactSha256=sha(binary);
 const comparable=previous?.image===image&&JSON.stringify(previous.sourceSha256)===JSON.stringify(hashes);
 if(comparable&&previous.artifactSha256!==artifactSha256)throw new Error('Repeated isolated builds differ');
 const record={checkedAt:new Date().toISOString(),builder:'solana-verify 0.5.2',image,platformTools:'v1.44',features:[],sourceSha256:hashes,artifactBytes:binary.length,artifactSha256,matchingFreshBuilds:comparable?(previous.matchingFreshBuilds??1)+1:1,thirdPartyAttestation:false};
 mkdirSync('onchain/target/deploy',{recursive:true});copyFileSync(join(staging,'target/deploy/ratchet_curve.so'),'onchain/target/deploy/ratchet_curve.so');copyFileSync(join(staging,'target/deploy/ratchet_curve.so'),'release/ratchet_curve.so');
 writeFileSync(proofFile,JSON.stringify(record,null,2)+'\n');console.log('Canonical isolated artifact:',artifactSha256);
}finally{rmSync(staging,{recursive:true,force:true});}
