// Generate the Vite kit from the tested reference client; avoid divergent transaction math.
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
for(const f of ['protocol.ts','raydium.ts','wallet.ts','price.ts','idl.json'])copyFileSync('lib/'+f,'lovable-wiring/'+f);
let chain=readFileSync('lib/chain.ts','utf8')
 .replace('process.env.NEXT_PUBLIC_RPC_URL','import.meta.env.VITE_RPC_URL')
 .replace('process.env.NEXT_PUBLIC_SOLANA_CLUSTER','import.meta.env.VITE_SOLANA_CLUSTER')
 .replace('process.env.NEXT_PUBLIC_ENABLE_MAINNET_TRADING','import.meta.env.VITE_ENABLE_MAINNET_TRADING');
chain+='\nexport const burnerAddress=()=>walletAddress(IS_LOCAL)?.toBase58()??"";\n';
writeFileSync('lovable-wiring/ratchetClient.ts',chain);
let view=readFileSync('lib/coinview.ts','utf8').replace('"./chain"','"./ratchetClient"');
// Formatters share the same live quote; unavailable USD is represented explicitly.
view+='\nexport {usdPriceParts as priceParts,usdPriceString as priceStr} from "./price";\n';
view+='export function usdCompact(usd:number|null):string{if(usd===null||!Number.isFinite(usd))return "—";return usd>=1e6?`$${(usd/1e6).toFixed(2)}M`:usd>=1e3?`$${(usd/1e3).toFixed(1)}K`:`$${usd.toFixed(0)}`;}\n';
view+='export function floorPctLabel(pct:number):string{return pct>=1?pct.toFixed(1):pct.toFixed(2); }\n';
writeFileSync('lovable-wiring/coinview.ts',view);
