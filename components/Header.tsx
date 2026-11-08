"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { balanceSol, ensureFunds, IS_LOCAL } from "@/lib/chain";
import { connectWallet, disconnectWallet, walletAddress } from "@/lib/wallet";
import { shortAddr } from "@/lib/format";

function WalletChip() {
  const [addr, setAddr] = useState<string | null>(null);
  const [bal, setBal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error,setError]=useState("");

  const refresh = () => { setAddr(walletAddress(IS_LOCAL)?.toBase58() ?? null); return balanceSol().then(setBal).catch(() => {}); };
  useEffect(() => {
    try { setAddr(walletAddress(IS_LOCAL)?.toBase58() ?? ""); } catch { /* ignore */ }
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  const topUp = async () => { setBusy(true); try { await ensureFunds(100); await refresh(); } finally { setBusy(false); } };
  const connect=async()=>{setBusy(true);setError("");try{setAddr((await connectWallet()).toBase58());await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const disconnect=async()=>{await disconnectWallet();setAddr(null);setBal(0);};
  return (
    <div className="wallet-chip">
      {addr && <span className="csym mono" title={addr}>{shortAddr(addr)} · {bal.toFixed(2)} SOL</span>}
      <button className="btn" onClick={IS_LOCAL?topUp:addr?disconnect:connect} disabled={busy} style={{minHeight:44,padding:"6px 11px",fontSize:13}}>
        {busy?"Connecting…":IS_LOCAL?"Test SOL":addr?"Disconnect":"Connect wallet"}
      </button>
      {error && <span role="alert" className="small">{error}</span>}
    </div>
  );
}

export function Header() {
  const path = usePathname();
  const on = (p: string) => (path === p ? "on" : "");
  return (
    <header className="hdr">
      <div className="hdr-in">
        <Link href="/" className="brand">
          <span className="cog">⚙️</span>
          <span><b>ratchet</b><span className="up">.fun</span></span>
        </Link>
        <nav className="nav">
          <Link href="/" className={on("/")}>Explore</Link>
          <Link href="/docs" className={on("/docs")}>How it works</Link>
        </nav>
        <div className="spacer" />
        <WalletChip />
        <Link href="/create" className="btn btn-cta">Launch a coin</Link>
      </div>
    </header>
  );
}
