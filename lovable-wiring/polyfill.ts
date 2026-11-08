// polyfill.ts — @solana/web3.js and anchor expect Node's Buffer in the browser.
// Import this ONCE at the very top of your app entry (src/main.tsx), before any other
// import that touches the chain:
//
//   import "./lib/polyfill";
//   import React from "react";
//   ...
//
// Also add the dep:  npm i buffer
// If you prefer a build-time fix instead of this file, use `vite-plugin-node-polyfills`
// in vite.config.ts and delete this file.
import { Buffer } from "buffer";

declare global {
  // eslint-disable-next-line no-var
  var Buffer: typeof import("buffer").Buffer;
}
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}
