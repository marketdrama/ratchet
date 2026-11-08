"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { market } from "./market";

// Re-render whenever the market ticks. Returns the live market singleton.
export function useMarket() {
  const m = market();
  useSyncExternalStore(m.subscribe, m.getSnapshot, m.getSnapshot);
  return m;
}

// The market is seeded with Math.random(), so server and client HTML never match.
// Gate dynamic content on mount to render it client-only and avoid hydration errors.
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
