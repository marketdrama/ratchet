"use client";
import { useState } from "react";
import { useCoins, useMounted } from "@/lib/useChain";
import { CoinCard } from "@/components/CoinCard";

type Sort = "mc" | "graduating" | "new";
type Filter = "all" | "curve" | "graduated";

export default function Home() {
  const mounted = useMounted();
  const { coins, loading } = useCoins();
  const [sort, setSort] = useState<Sort>("mc");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  let list = [...coins];
  if (filter === "curve") list = list.filter((c) => !c.graduated);
  if (filter === "graduated") list = list.filter((c) => c.graduated);
  if (q.trim()) {
    const s = q.toLowerCase();
    list = list.filter((c) => c.name.toLowerCase().includes(s) || c.symbol.toLowerCase().includes(s) || c.mint.includes(q));
  }
  list.sort((a, b) => {
    if (sort === "new") return b.mint.localeCompare(a.mint);
    if (sort === "graduating") return (b.graduated ? 101 : b.progress) - (a.graduated ? 101 : a.progress);
    return b.mcUsd - a.mcUsd;
  });

  const sorts: [Sort, string][] = [["mc", "Market cap"], ["graduating", "Graduating"], ["new", "New"]];
  const filters: [Filter, string][] = [["all", "All"], ["curve", "On curve"], ["graduated", "Graduated"]];
  const gradCount = coins.filter((c) => c.graduated).length;
  const vaultTotal = coins.reduce((s, c) => s + c.vaultSol, 0);

  return (
    <>
      <div className="tag">
        <h1>it <span className="only">only clicks up</span> 🪜</h1>
        <p>Every coin has a floor that ratchets up and never drops. Live on-chain.</p>
      </div>

      {mounted && !loading && coins.length > 0 && (
        <div className="stats-strip">
          <span><b>{coins.length}</b> coins</span>
          <span className="dot">·</span>
          <span><b>{gradCount}</b> graduated</span>
          <span className="dot">·</span>
          <span><b className="up">{vaultTotal.toFixed(1)} SOL</b> locked in floors</span>
        </div>
      )}

      <div className="toolbar">
        <input placeholder="Search by name, ticker or mint" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chipset">
          {filters.map(([f, label]) => (
            <button key={f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>{label}</button>
          ))}
        </div>
        <div className="chipset">
          {sorts.map(([s, label]) => (
            <button key={s} className={`chip ${sort === s ? "on" : ""}`} onClick={() => setSort(s)}>{label}</button>
          ))}
        </div>
      </div>

      {!mounted || loading ? (
        <div className="grid">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="card skeleton" style={{ height: 150 }} />)}
        </div>
      ) : coins.length === 0 ? (
        <div className="empty">
          <div className="empty-emoji">🪜</div>
          <h3>No coins yet</h3>
          <p className="muted">Be the first to launch one with a ratcheting floor.</p>
          <a href="/create" className="btn btn-cta" style={{ marginTop: 14, display: "inline-block" }}>Launch a coin</a>
        </div>
      ) : list.length === 0 ? (
        <div className="empty">
          <div className="empty-emoji">🔍</div>
          <h3>Nothing matches</h3>
          <p className="muted">Try a different search or filter.</p>
        </div>
      ) : (
        <div className="grid">{list.map((c) => <CoinCard key={c.mint} coin={c} />)}</div>
      )}
    </>
  );
}
