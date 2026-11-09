// useRatchet.ts — React hooks over the ratchet client. Polls the chain and returns
// display-ready CoinViews. Reads work for everyone; trades require a connected wallet.
import { useCallback, useEffect, useRef, useState } from "react";
import { listCoins, getCoin, balanceSol, burnerAddress } from "./ratchetClient";
import {refreshSolPrice} from "./price";
import { view, type CoinView } from "./coinview";

// Avoid SSR/first-paint mismatch: chain reads are browser-only. Gate dynamic render.
export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

// The whole feed. Sort client-side (by mcUsd, progress, etc.) in your component.
export function useCoins(pollMs = 8000): { coins: CoinView[]; loading: boolean; error: string | null; refresh: () => void } {
  const [coins, setCoins] = useState<CoinView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const [raw] = await Promise.all([listCoins(),refreshSolPrice()]);
      if (alive.current) { setCoins(raw.map(view)); setError(null); }
    } catch (e) { if (alive.current) setError((e as Error).message ?? "read failed"); }
    finally { if (alive.current) setLoading(false); }
  }, []);
  useEffect(() => {
    alive.current = true; load();
    const id = setInterval(load, pollMs);
    return () => { alive.current = false; clearInterval(id); };
  }, [load, pollMs]);
  return { coins, loading, error, refresh: load };
}

// One coin by mint.
export function useCoin(mint: string | undefined, pollMs = 6000): { coin: CoinView | null; notFound: boolean; loading: boolean; refresh: () => void } {
  const [coin, setCoin] = useState<CoinView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!mint) return;
    try {
      const [raw] = await Promise.all([getCoin(mint),refreshSolPrice()]);
      if (!alive.current) return;
      if (!raw) { setNotFound(true); setCoin(null); }
      else { setCoin(view(raw)); setNotFound(false); }
    } catch { /* keep last good */ }
    finally { if (alive.current) setLoading(false); }
  }, [mint]);
  useEffect(() => {
    alive.current = true; load();
    const id = setInterval(load, pollMs);
    return () => { alive.current = false; clearInterval(id); };
  }, [load, pollMs]);
  return { coin, notFound, loading, refresh: load };
}

// Burner wallet address + SOL balance (for the header chip / "fund me" prompt).
export function useWallet(pollMs = 10000): { address: string; sol: number; refresh: () => void } {
  const [sol, setSol] = useState(0);
  const address = typeof window !== "undefined" ? burnerAddress() : "";
  const load = useCallback(() => { balanceSol().then(setSol).catch(() => {}); }, []);
  useEffect(() => { load(); const id = setInterval(load, pollMs); return () => clearInterval(id); }, [load, pollMs]);
  return { address, sol, refresh: load };
}
