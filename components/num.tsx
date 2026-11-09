"use client";
import {useSyncExternalStore,type ReactNode} from "react";
import {subscribeSolPrice,getSolPrice,usdPriceParts,usdPriceString,solToUsd} from "@/lib/price";
export function Price({sol}:{sol:number}):ReactNode{
  const quote=useSyncExternalStore(subscribeSolPrice,getSolPrice,()=>null);
  const p=usdPriceParts(sol,quote);
  return p.zeros===null?<>{p.lead}</>:<>{p.lead}<sub style={{fontSize:"0.7em",verticalAlign:"-0.15em"}}>{p.zeros}</sub>{p.digits}</>;
}
export const priceStr=usdPriceString;
export function vaultUsd(sol:number):string{
  const usd=solToUsd(sol);if(usd===null)return "—";
  return usd>=1000?`$${(usd/1000).toFixed(1)}K`:`$${usd.toFixed(0)}`;
}
