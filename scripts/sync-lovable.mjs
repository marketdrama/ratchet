// Generate the Vite kit from the tested reference client; avoid divergent transaction math.
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
for(const f of ['protocol.ts','raydium.ts','wallet.ts','idl.json'])copyFileSync('lib/'+f,'lovable-wiring/'+f);
let chain=readFileSync('lib/chain.ts','utf8')
 .replace('process.env.NEXT_PUBLIC_RPC_URL','import.meta.env.VITE_RPC_URL')
 .replace('process.env.NEXT_PUBLIC_SOLANA_CLUSTER','import.meta.env.VITE_SOLANA_CLUSTER')
 .replace('process.env.NEXT_PUBLIC_ENABLE_MAINNET_TRADING','import.meta.env.VITE_ENABLE_MAINNET_TRADING');
chain+='\nexport const burnerAddress=()=>walletAddress(IS_LOCAL)?.toBase58()??"";\n';
writeFileSync('lovable-wiring/ratchetClient.ts',chain);
let view=readFileSync('lib/coinview.ts','utf8').replace('"./chain"','"./ratchetClient"');
// Preserve consumer formatting exports from the existing kit as stable UI conveniences.
const old=readFileSync('lovable-wiring/coinview.ts','utf8');
const marker=old.indexOf('export function priceParts');
if(marker>=0)view+='\n'+old.slice(marker);
writeFileSync('lovable-wiring/coinview.ts',view);
