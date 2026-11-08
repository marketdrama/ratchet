"use client";
import Link from "next/link";
import type { CoinView } from "@/lib/coinview";
import { fmtUsd, shortAddr } from "@/lib/format";
import { vaultUsd } from "./num";
import { RungBadge } from "./RungBadge";

export function CoinCard({ coin }: { coin: CoinView }) {
  return (
    <Link href={`/coin/${coin.mint}`} className="card">
      <div className="card-badge"><RungBadge coin={coin} /></div>
      <div className="card-top">
        <div className="emoji">{coin.emoji}</div>
        <div style={{ minWidth: 0 }}>
          <div className="cname">{coin.name}</div>
          <div className="csym">${coin.symbol}</div>
        </div>
      </div>
      <div className="row" style={{ margin: "13px 0 9px", alignItems: "flex-end" }}>
        <div>
          <div className="k">market cap</div>
          <div className="mc">{fmtUsd(coin.mcUsd)}</div>
        </div>
        <span className="ratchet-badge">🪜 {coin.vaultSol.toFixed(2)} SOL · {vaultUsd(coin.vaultSol)}</span>
      </div>
      <div className={`prog ${coin.graduated ? "grad" : ""}`}>
        <span style={{ width: `${coin.progress}%` }} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <span className={`csym ${coin.graduated ? "grad-tag" : ""}`}>
          {coin.graduated ? "✓ graduated · on pool" : `${coin.progress.toFixed(0)}% to graduation`}
        </span>
        <span className="csym">by {shortAddr(coin.creator)}</span>
      </div>
    </Link>
  );
}
