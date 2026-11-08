"use client";
import { useEffect, useState } from "react";
import type { CoinView } from "@/lib/coinview";
import { buy, sell, migrateCoin, myTokenBalance, balanceSol, getCoin } from "@/lib/chain";
import { quoteBuy, quoteSell, solAmount } from "@/lib/protocol";
import { swapUrl } from "@/lib/raydium";
import { priceStr } from "./num";

const TAX = 0.0125;

export function TradePanel({ coin, onTrade }: { coin: CoinView; onTrade: () => void }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amt, setAmt] = useState("1");
  const [hold, setHold] = useState(0);
  const [sol, setSol] = useState(0);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err" | "info"; v: string } | null>(null);

  const loadBals = () => {
    myTokenBalance(coin.mint).then(setHold).catch(() => {});
    balanceSol().then(setSol).catch(() => {});
  };
  useEffect(() => { loadBals(); const timer=setInterval(loadBals,4000);return()=>clearInterval(timer); }, [coin.mint]);

  const [estimate,setEstimate]=useState(0);
  const n = Number(amt) || 0;
  useEffect(()=>{let live=true; getCoin(coin.mint).then(c=>{
    if(!c||!Number.isFinite(n)||n<=0)return;
    try{const q=side==="buy"?Number(quoteBuy(c,solAmount(n)))/1e6:Number(quoteSell(c,BigInt(Math.round(n*1e6))))/1e9;
      if(live)setEstimate(q);}catch{if(live)setEstimate(0);}
  }).catch(()=>{});return()=>{live=false;};},[coin.mint,side,n,coin.spot,coin.floor]);
  // Rough pre-trade estimate (display only; curve slippage + exact fees settle on-chain).
  const estTokens = estimate;
  const payPrice = coin.graduated?coin.floor:Math.max(coin.spot,coin.floor);
  const estSol = estimate;

  const go = async () => {
    if (!n || n <= 0) { setMsg({ t: "err", v: "Enter an amount" }); return; }
    if (side === "buy" && n > sol) { setMsg({ t: "err", v: "More SOL than your wallet holds" }); return; }
    if (side === "sell" && n > hold + 1e-6) { setMsg({ t: "err", v: "More than you hold" }); return; }
    setPending(true); setMsg({ t: "info", v: "Confirming on-chain…" });
    try {
      if (side === "buy") { await buy(coin.mint, n); setMsg({ t: "ok", v: `Bought ${coin.symbol} — ${(n * TAX).toFixed(4)} SOL went to the floor 🪜` }); }
      else { await sell(coin.mint, n); setMsg({ t: "ok", v: `Sold ${n.toLocaleString()} ${coin.symbol} ✓` }); }
      loadBals(); onTrade();
    } catch (e) {
      setMsg({ t: "err", v: `Failed: ${(e as Error).message?.slice(0, 70) ?? "error"}` });
    } finally { setPending(false); }
  };

  const setBuy = () => { setSide("buy"); setAmt("1"); setMsg(null); };
  const setSell = () => { setSide("sell"); setAmt(String(Math.floor(hold))); setMsg(null); };
  const quick = side === "buy" ? [0.5, 1, 5] : [];
  const pcts = side === "sell" ? [25, 50, 100] : [];

  return (
    <div className="panel trade">
      {coin.graduated && <p><a className="btn" href={swapUrl(coin.mint)} target="_blank" rel="noopener noreferrer">Trade on Raydium</a><br/><span className="small">Below: burn your tokens to redeem the fixed floor. Raydium trades use Raydium fees.</span></p>}
      {coin.complete && !coin.graduated && <button className="btn" disabled={pending} onClick={async()=>{setPending(true);setMsg({t:"info",v:"Confirm migration in your wallet…"});try{await migrateCoin(coin.mint);onTrade();setMsg({t:"ok",v:"Migrated: LP burned and floor backing retained"});}catch(e){setMsg({t:"err",v:(e as Error).message});}finally{setPending(false);}}}>Migrate to Raydium</button>}
      <div className="seg">
        <button className={`buy ${side === "buy" ? "on" : ""}`} onClick={setBuy} disabled={coin.complete||coin.graduated}>Buy</button>
        <button className={`sell ${side === "sell" ? "on" : ""}`} onClick={setSell}>{coin.graduated?"Redeem floor":"Sell"}</button>
      </div>

      <div className="amt-wrap">
        <input aria-label={side==="buy"?"SOL to spend":"Tokens to sell or redeem"} className="amt mono" value={amt} inputMode="decimal"
          onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} />
        <span className="amt-unit">{side === "buy" ? "SOL" : coin.symbol}</span>
      </div>

      <div className="bal-row">
        <span className="csym">{side === "buy"
          ? <>wallet {sol.toFixed(2)} SOL</>
          : <>you hold {hold.toLocaleString(undefined, { maximumFractionDigits: 0 })} {coin.symbol}</>}</span>
        <button className="link-btn" onClick={() => setAmt(side === "buy" ? String(Math.max(0, sol - 0.01).toFixed(2)) : String(Math.floor(hold)))}>Max</button>
      </div>

      <div className="quick">
        {quick.map((v) => <button key={v} className={amt === String(v) ? "on" : ""} onClick={() => setAmt(String(v))}>{v} SOL</button>)}
        {pcts.map((p) => <button key={p} onClick={() => setAmt(String(Math.floor((hold * p) / 100)))}>{p}%</button>)}
      </div>

      {n > 0 && (
        <div className="quote">
          {side === "buy" ? (
            <>
              <div className="row od"><span className="muted small">you get ≈</span><span className="mono">{estTokens.toLocaleString(undefined, { maximumFractionDigits: 0 })} {coin.symbol}</span></div>
              <div className="row"><span className="muted small">to floor (1.25%)</span><span className="mono up">{(n * TAX).toFixed(4)} SOL</span></div>
            </>
          ) : (
            <>
              <div className="row od"><span className="muted small">you get ≈</span><span className="mono">{estSol.toFixed(4)} SOL</span></div>
              <div className="row"><span className="muted small">paid at</span><span className="mono">{coin.floor >= coin.spot ? "floor 🪜" : "spot"} · {priceStr(payPrice)}</span></div>
            </>
          )}
        </div>
      )}

      <button className={`trade-go ${side}`} onClick={go} disabled={pending || (side==="buy" && (coin.complete||coin.graduated))}>
        {pending ? "…" : side === "buy" ? `Buy ${coin.symbol}` : `${coin.graduated?"Redeem":"Sell"} ${coin.symbol}`}
      </button>

      {msg && <div role={msg.t==="err"?"alert":"status"} className={`toast ${msg.t}`}>{msg.v}</div>}

      <div className="hint">
        {coin.graduated
          ? <>The fixed floor is backed for every outstanding token. Redemption burns tokens and is untaxed. Compare the Raydium quote before redeeming.</>
          : <>A <b>1.25% tax on every buy</b> funds this coin&apos;s floor vault. It only clicks up, and becomes locked liquidity at graduation.</>}
      </div>
    </div>
  );
}
