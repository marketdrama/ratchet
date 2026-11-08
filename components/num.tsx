"use client";
import type { ReactNode } from "react";

// Display-only money formatting for the frontend. lib/ is read-only, and lib/format.ts
// renders tiny prices as scientific notation ("$7.73e-5"); memecoin UIs use the
// dexscreener-style subscript-zero form instead ($0.0₅773). This never feeds a trade.
const SOL_USD = 180; // matches lib/coinview.ts SOL_USD

// Price (SOL per whole token) -> pretty USD string, as JSX so we can use <sub>.
export function Price({ sol }: { sol: number }): ReactNode {
  const usd = sol * SOL_USD;
  if (usd <= 0) return <>$0</>;
  if (usd >= 1) return <>${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</>;
  if (usd >= 0.001) return <>${usd.toFixed(4)}</>;
  // count leading zeros after the decimal point
  const exp = Math.floor(Math.log10(usd)); // negative
  const zeros = -exp - 1;
  const digits = Math.round(usd / Math.pow(10, exp - 2)); // 3 significant digits
  return (
    <>
      $0.0<sub style={{ fontSize: "0.7em", verticalAlign: "-0.15em" }}>{zeros}</sub>
      {String(digits).padStart(3, "0").slice(0, 3)}
    </>
  );
}

// Plain-string variant for places that can't take JSX (title attrs, aria).
export function priceStr(sol: number): string {
  const usd = sol * SOL_USD;
  if (usd <= 0) return "$0";
  if (usd >= 1) return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (usd >= 0.001) return `$${usd.toFixed(4)}`;
  const exp = Math.floor(Math.log10(usd));
  const zeros = -exp - 1;
  const digits = Math.round(usd / Math.pow(10, exp - 2));
  return `$0.0(${zeros})${String(digits).padStart(3, "0").slice(0, 3)}`;
}

// "1.13 SOL" / "$204" backing from a vault balance.
export function vaultUsd(sol: number): string {
  const usd = sol * SOL_USD;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`;
  return `$${usd.toFixed(0)}`;
}
