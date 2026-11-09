// Seal reviewed client/tooling inputs without rebuilding the unchanged contract.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha,verifyRelease} from './verify-release.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const isolated=JSON.parse(readFileSync(resolve(root,'release/isolated-build.json')));
for(const [f,h] of Object.entries(isolated.sourceSha256))if(sha(readFileSync(resolve(root,'onchain',f)))!==h)throw new Error('Contract source differs from isolated build: '+f);
if(sha(readFileSync(resolve(root,'onchain/target/deploy/ratchet_curve.so')))!==isolated.artifactSha256)throw new Error('Binary differs from isolated build');
const hash={};
const walk=dir=>{for(const x of readdirSync(resolve(root,dir),{withFileTypes:true})){const f=dir+'/'+x.name;if(['node_modules','target','.next'].includes(x.name)||x.isSymbolicLink())continue;if(x.isDirectory())walk(f);else if(/\.(ts|tsx|mts|css|mjs|cjs|rs|toml|json|yaml)$/.test(f))hash[f]=sha(readFileSync(resolve(root,f)));}};
for(const dir of ['app','components','lib','server','packages','test','scripts','lovable-wiring','onchain/programs','onchain/app'])walk(dir);
for(const f of ['package.json','pnpm-workspace.yaml','pnpm-lock.yaml','tsconfig.json','next.config.mjs','onchain/Cargo.lock','onchain/Cargo.toml','onchain/Anchor.toml','onchain/target/deploy/ratchet_curve.so','onchain/target/idl/ratchet_curve.json'])hash[f]=sha(readFileSync(resolve(root,f)));
const manifest={version:4,cluster:'mainnet-beta',program:'35UELzdncBr15qztq55Kct3sZvmXnn5D5e5rpGiHgMuC',admin:'3vkTXSV3LG7ZrZt1SWMnEYBjNBiYAg168fbEV3Q6skTi',features:[],platformTools:'v1.44',buildEnvironment:JSON.parse(readFileSync(resolve(root,'release/isolated-build.json'))).image,anchor:'0.31.1',artifactSha256:hash['onchain/target/deploy/ratchet_curve.so'],sha256:hash};
writeFileSync(resolve(root,'release/manifest.json'),JSON.stringify(manifest,null,2)+'\n');await verifyRelease();
