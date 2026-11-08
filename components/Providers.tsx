"use client";
import { useEffect, type ReactNode } from "react";
import { Buffer } from "buffer";

// web3.js / anchor expect a global Buffer in the browser.
if (typeof globalThis !== "undefined" && !(globalThis as { Buffer?: unknown }).Buffer) {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    (globalThis as { Buffer?: unknown }).Buffer ||= Buffer;
  }, []);
  return <>{children}</>;
}
