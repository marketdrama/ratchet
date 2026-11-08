"use client";
import { useEffect, useRef, useState } from "react";
import { listCoins, getCoin, balanceSol, ensureFunds, initGlobal, globalExists, type CoinAccount } from "./chain";
import { view, spotPrice, floorPrice, type CoinView } from "./coinview";

export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

// One-time: fund the burner and make sure global exists.
let setupDone = false;
async function setup() {
  if (setupDone) return;
  setupDone = true;
  await ensureFunds();
  if (!(await globalExists())) { try { await initGlobal(); } catch { /* raced */ } }
}

export function useCoins() {
  const [coins, setCoins] = useState<CoinView[]>([]);
  const [bal, setBal] = useState(0);
  const [loading, setLoading] = useState(true);
  const refresh = useRef(async () => {});

  useEffect(() => {
    let live = true;
    refresh.current = async () => {
      try {
        const [list, b] = await Promise.all([listCoins(), balanceSol()]);
        if (!live) return;
        setCoins(list.map(view));
        setBal(b);
      } catch { /* rpc hiccup */ }
      finally { if (live) setLoading(false); }
    };
    (async () => { await setup(); await refresh.current(); })();
    const t = setInterval(() => refresh.current(), 3000);
    return () => { live = false; clearInterval(t); };
  }, []);

  return { coins, bal, loading, refresh: () => refresh.current() };
}

export interface Point { t: number; spot: number; floor: number }

export function useCoin(mint: string) {
  const [account, setAccount] = useState<CoinAccount | null>(null);
  const [coin, setCoin] = useState<CoinView | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [notFound, setNotFound] = useState(false);
  const refresh = useRef(async () => {});

  useEffect(() => {
    let live = true;
    refresh.current = async () => {
      try {
        const a = await getCoin(mint);
        if (!live) return;
        if (!a) { setNotFound(true); return; }
        setAccount(a);
        setCoin(view(a));
        setHistory((h) => {
          const next = [...h, { t: Date.now(), spot: spotPrice(a), floor: floorPrice(a) }];
          return next.length > 160 ? next.slice(-160) : next;
        });
      } catch { /* ignore */ }
    };
    (async () => { await setup(); await refresh.current(); })();
    const t = setInterval(() => refresh.current(), 2500);
    return () => { live = false; clearInterval(t); };
  }, [mint]);

  return { account, coin, history, notFound, refresh: () => refresh.current() };
}
