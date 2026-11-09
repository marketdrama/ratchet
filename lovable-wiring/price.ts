// Display-only SOL/USD quote. Never used by transaction or solvency math.
export const SOL_PRICE_URL = "https://api.coinbase.com/v2/prices/SOL-USD/spot";
export const PRICE_REFRESH_MS = 60_000;
export const PRICE_MAX_AGE_MS = 120_000;
export interface SolPrice { usd: number; observedAt: number; source: "Coinbase"; }
let current: SolPrice | null = null;
let inFlight: Promise<SolPrice | null> | null = null;
const listeners = new Set<() => void>();
export function parseSolPrice(body: unknown, now = Date.now()): SolPrice {
  const data = (body as { data?: { base?: string; currency?: string; amount?: string } })?.data;
  const usd = Number(data?.amount);
  if(data?.base!=="SOL"||data?.currency!=="USD"||!Number.isFinite(usd)||usd<=0||typeof data.amount!=="string")throw new Error("Invalid SOL/USD quote");
  return {usd,observedAt:now,source:"Coinbase"};
}
export function freshSolPrice(quote: SolPrice | null, now=Date.now()): SolPrice | null {
  return quote && now>=quote.observedAt && now-quote.observedAt<=PRICE_MAX_AGE_MS ? quote : null;
}
export function getSolPrice():SolPrice|null {return freshSolPrice(current);}
export function subscribeSolPrice(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export async function refreshSolPrice(fetcher:typeof fetch=fetch):Promise<SolPrice|null>{
  if(current&&Date.now()-current.observedAt<PRICE_REFRESH_MS)return getSolPrice();
  if(inFlight)return inFlight;
  inFlight=(async()=>{try{
    const response=await fetcher(SOL_PRICE_URL,{cache:"no-store",signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error("Price feed unavailable");
    current=parseSolPrice(await response.json());
  }catch{current=freshSolPrice(current);}finally{inFlight=null;for(const listener of listeners)listener();}
  return getSolPrice();})();
  return inFlight;
}
export function solToUsd(sol:number,quote:SolPrice|null=getSolPrice()):number|null{
  return Number.isFinite(sol)&&freshSolPrice(quote)?sol*quote!.usd:null;
}
export function usdPriceParts(sol:number,quote:SolPrice|null=getSolPrice()):{lead:string;zeros:number|null;digits:string}{
  const usd=solToUsd(sol,quote);
  if(usd===null)return {lead:"—",zeros:null,digits:""};
  if(usd<=0)return {lead:"$0",zeros:null,digits:""};
  if(usd>=1)return {lead:`$${usd.toLocaleString(undefined,{maximumFractionDigits:2})}`,zeros:null,digits:""};
  if(usd>=0.001)return {lead:`$${usd.toFixed(4)}`,zeros:null,digits:""};
  const exp=Math.floor(Math.log10(usd));
  return {lead:"$0.0",zeros:-exp-1,digits:String(Math.round(usd/Math.pow(10,exp-2))).padStart(3,"0").slice(0,3)};
}
export function usdPriceString(sol:number):string{
  const p=usdPriceParts(sol);return p.zeros===null?p.lead:`$0.0(${p.zeros})${p.digits}`;
}
