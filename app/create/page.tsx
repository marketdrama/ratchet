"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCoin } from "@/lib/chain";

export default function CreatePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [uri,setUri]=useState("");
  const [devBuy,setDevBuy]=useState("0");
  const [sellTax,setSellTax]=useState("1.25");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const sym = symbol.trim().toUpperCase().slice(0, 10);
  const launch = async () => {
    if (!name.trim()) { setErr("Name required"); return; }
    if (!sym) { setErr("Ticker required"); return; }
    setPending(true); setErr(null);
    try {
      const mint = await createCoin(name.trim(), sym,Math.round(Number(sellTax)*100),Number(devBuy),uri.trim());
      router.push(`/coin/${mint}`);
    } catch (e) {
      setErr(`Launch failed: ${(e as Error).message?.slice(0, 100) ?? "error"}`);
      setPending(false);
    }
  };

  return (
    <>
      <Back />
      <div className="tag"><h1>Launch a coin 🪜</h1></div>

      <div className="create-grid">
        <div className="form">
          <div className="callout">
            Launches live on-chain with a <b>ratcheting floor</b>. A 1.25% tax on each buy funds a locked
            floor vault. At graduation, full-supply floor backing stays reserved for redemption; remaining reserves fund locked Raydium liquidity. No platform or creator cut. Signed by your connected wallet.
          </div>
          <div className="field">
            <label htmlFor="coin-name">Name</label>
            <input id="coin-name" value={name} onChange={(e) => { setName(e.target.value); setErr(null); }} placeholder="only up" maxLength={32} />
          </div>
          <div className="field">
            <label htmlFor="coin-symbol">Ticker</label>
            <input id="coin-symbol" value={symbol} onChange={(e) => { setSymbol(e.target.value); setErr(null); }} placeholder="UP" maxLength={10} />
            <div className="small muted" style={{ marginTop: 6 }}>{sym ? `$${sym}` : "uppercase, up to 10 chars"}</div>
          </div>
          <div className="field"><label htmlFor="metadata-uri">Permanent metadata JSON URI</label>
            <input id="metadata-uri" value={uri} onChange={e=>setUri(e.target.value)} placeholder="ipfs://…" maxLength={200}/>
            <p className="small muted">JSON containing name, symbol and an image URI. Metadata is immutable after launch.</p></div>
          <div className="field"><label htmlFor="dev-buy">Optional creator buy (SOL)</label>
            <input id="dev-buy" type="number" min="0" step="0.01" value={devBuy} onChange={e=>setDevBuy(e.target.value)}/>
            <p className="small muted">25% seeds the floor; the rest buys your tokens. A larger seed can substantially increase the buys required to graduate.</p></div>
          <div className="field"><label htmlFor="sell-tax">Curve sell tax (%)</label>
            <input id="sell-tax" type="number" min="1.25" max="5" step="0.01" value={sellTax} onChange={e=>setSellTax(e.target.value)}/></div>
          {err && <div role="alert" className="toast err">{err}</div>}
          <button className="btn btn-cta" style={{ padding: "13px 20px", fontSize: 16, marginTop: 4 }} onClick={launch} disabled={pending}>
            {pending ? "launching on-chain…" : "Launch coin"}
          </button>
        </div>

        <div>
          <div className="k" style={{ marginBottom: 8 }}>preview</div>
          <div className="card preview-card">
            <div className="card-top">
              <div className="emoji">🪜</div>
              <div style={{ minWidth: 0 }}>
                <div className="cname">{name.trim() || "Your coin"}</div>
                <div className="csym">${sym || "TICKER"}</div>
              </div>
            </div>
            <div className="row" style={{ margin: "13px 0 9px", alignItems: "flex-end" }}>
              <div><div className="k">market cap</div><div className="mc">$5.4K</div></div>
              <span className="ratchet-badge">🪜 0.00 SOL · $0</span>
            </div>
            <div className="prog"><span style={{ width: "0%" }} /></div>
            <div className="row" style={{ marginTop: 8 }}>
              <span className="csym">0% to graduation</span>
              <span className="csym">brand new</span>
            </div>
          </div>
          <p className="small muted" style={{ marginTop: 12, lineHeight: 1.55 }}>
            Launches at the bottom of the bonding curve. Graduation depends on trading history and the floor seed; a fixed SOL target is not guaranteed. An emoji is assigned from the mint on launch.
          </p>
        </div>
      </div>
    </>
  );
}

function Back() {
  return <a href="/" className="back">← all coins</a>;
}
