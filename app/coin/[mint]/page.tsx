"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCoin, useMounted } from "@/lib/useChain";
import { fmtUsd, fmtSol, shortAddr } from "@/lib/format";
import { Price, vaultUsd } from "@/components/num";
import { RungBadge } from "@/components/RungBadge";
import { PriceChart } from "@/components/PriceChart";
import { RatchetMeter } from "@/components/RatchetMeter";
import { TradePanel } from "@/components/TradePanel";

export default function CoinPage() {
  const mounted = useMounted();
  const { mint } = useParams<{ mint: string }>();
  const { coin, notFound, refresh } = useCoin(mint);

  if (!mounted || (!coin && !notFound)) {
    return (
      <div className="coin-wrap">
        <div className="panel skeleton" style={{ height: 460 }} />
        <div className="panel skeleton" style={{ height: 300 }} />
      </div>
    );
  }
  if (notFound || !coin) {
    return (
      <div className="empty">
        <div className="empty-emoji">🪜</div>
        <h3>Coin not found</h3>
        <p className="muted">This mint isn&apos;t on chain here.</p>
        <Link href="/" className="btn" style={{ marginTop: 14, display: "inline-block" }}>← Back to all coins</Link>
      </div>
    );
  }

  const pct = coin.spot > 0 ? (coin.floor / coin.spot) * 100 : 0;
  const statusLabel = coin.graduated ? "Graduated · trading on pool" : coin.complete ? "Curve complete" : "On the bonding curve";

  return (
    <>
      <Link href="/" className="back">← all coins</Link>
      <div className="coin-wrap">
        <div>
          <div className="panel">
            <div className="coin-head">
              <div className="emoji">{coin.emoji}</div>
              <div style={{ flex: 1 }}>
                <h2>{coin.name} <span className="muted" style={{ fontSize: 16 }}>${coin.symbol}</span></h2>
                <div className={`status-pill ${coin.graduated ? "grad" : ""}`}>{statusLabel}</div>
              </div>
              <RungBadge coin={coin} size={22} />
            </div>

            <div className="stat-row">
              <div className="stat"><div className="k">market cap</div><div className="v">{fmtUsd(coin.mcUsd)}</div></div>
              <div className="stat"><div className="k">price</div><div className="v mono"><Price sol={coin.spot} /></div></div>
              <div className="stat"><div className="k">floor</div><div className="v up mono"><Price sol={coin.floor} /></div></div>
              <div className="stat"><div className="k">floor vault</div><div className="v mono">{coin.vaultSol.toFixed(2)} SOL</div></div>
            </div>

            <PriceChart coin={coin} />
            <RatchetMeter coin={coin} />

            <div className={`prog ${coin.graduated ? "grad" : ""}`} style={{ marginTop: 16 }}>
              <span style={{ width: `${coin.progress}%` }} />
            </div>
            <div className="row" style={{ marginTop: 7 }}>
              <span className="csym">{coin.graduated ? "graduated — pool + floor vault locked" : `${coin.progress.toFixed(1)}% to graduation`}</span>
              <span className="csym mono">{coin.mint.slice(0, 6)}…{coin.mint.slice(-4)}</span>
            </div>
          </div>
        </div>

        <div className="coin-side">
          <TradePanel coin={coin} onTrade={refresh} />
          <div className="panel" style={{ marginTop: 16 }}>
            <div className="k" style={{ marginBottom: 10 }}>on-chain</div>
            <div className="row od"><span className="muted small">status</span><span>{coin.graduated ? "pool (graduated)" : coin.complete ? "complete" : "on curve"}</span></div>
            <div className="row od"><span className="muted small">floor / spot</span><span className="mono">{pct >= 1 ? pct.toFixed(1) : pct.toFixed(2)}%</span></div>
            <div className="row od"><span className="muted small">floor vault</span><span className="mono">{fmtSol(coin.vaultSol)} · {vaultUsd(coin.vaultSol)}</span></div>
            <div className="row"><span className="muted small">creator</span><span className="mono">{shortAddr(coin.creator)}</span></div>
          </div>
        </div>
      </div>
    </>
  );
}
