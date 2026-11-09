// Uses the pinned SBF platform tools and lockfiles. Test features are never accepted.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,copyFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha,verifyRelease} from './verify-release.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const run=(exe,args,cwd=root)=>{const p=spawnSync(exe,args,{cwd,stdio:'inherit',env:process.env});if(p.status!==0)throw new Error(exe+' failed');};
if(process.env.CARGO_ENCODED_RUSTFLAGS||process.env.RUSTFLAGS||process.argv.length>2||process.env.CARGO_FEATURE_DEVNET||process.env.CARGO_FEATURE_TEST_ADMIN||process.env.RUSTFLAGS?.includes('--cfg'))throw new Error('Release builder accepts no custom features/cfg');
run(process.execPath,['scripts/build-verifiable.mjs']);
const anchor=process.env.ANCHOR_BIN??(existsSync(process.env.HOME+'/.avm/bin/anchor-0.31.1')?process.env.HOME+'/.avm/bin/anchor-0.31.1':'anchor');
run(anchor,['idl','build','-o','target/idl/ratchet_curve.json','-t','target/types/ratchet_curve.ts'],resolve(root,'onchain'));
copyFileSync(resolve(root,'onchain/target/idl/ratchet_curve.json'),resolve(root,'lib/idl.json'));
run(process.execPath,['scripts/sync-lovable.mjs']);
run(process.execPath,['scripts/seal-release.mjs']);
