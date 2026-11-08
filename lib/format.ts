import type { Grade } from "./market";

export const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function fmtSol(n: number): string {
  if (n >= 1) return `${n.toFixed(2)} SOL`;
  if (n >= 0.001) return `${n.toFixed(4)} SOL`;
  return `${n.toExponential(2)} SOL`;
}

export function fmtPrice(n: number): string {
  if (n === 0) return "$0";
  const usd = n * 180;
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toExponential(2)}`;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export const gradeColor: Record<Grade, string> = {
  A: "#2bd576", B: "#7ad0ff", C: "#f2c744", D: "#f0903b", F: "#f0533b",
};
