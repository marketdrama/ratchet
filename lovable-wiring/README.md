# v4 Vite wiring kit

Generated from the tested reference client by `node scripts/sync-lovable.mjs`. Replaces the old v2 demo
kit. It is incompatible with old v2/v3 programs/accounts; use the matching v4 IDL and deployment.

Copy **all** `.ts`, `.d.ts` and `idl.json` files to a directory in the actual Lovable app. Import
`polyfill.ts` once before client modules. Install the matching root Solana/Anchor dependency versions.
Also copy the root `packages/bigint-buffer` package and `pnpm.overrides` from package.json: this removes
an unpatched native bigint dependency; the patched TOML/JSON-RPC/PostCSS overrides are part of the tested
release, not optional version suggestions. Re-run dependency checks in that application.

Set the `VITE_*` variables from `.env.example`; enable mainnet trading only after the public launch gates.
The guard verifies full genesis hashes, never URL labels. The default RPC and cluster are loopback/localnet;
set both explicitly for a public deployment. `VITE_ENABLE_MAINNET_TRADING=false` is the safe default.

- Reads: `listCoins`, `getCoin`, `balanceSol`, `myTokenBalance`; metadata URI and canonical pool address
  are included. Raydium spot reads come from the actual token vault balances.
- Wallet: import `connectWallet`, `disconnectWallet`, `walletAddress` from `wallet.ts`. Use injected
  Phantom/Solflare signing. No browser-local key is created for public endpoints.
- Create: `createCoin(name, symbol, sellFeeBps, devBuySol, metadataUri)`. Metadata is immutable. Use the
  pinning helper in the backend workspace or your own permanent image/JSON hosting integration.
- Trade: `buy` / `sell` compute real integer quotes and nonzero slippage protection. A complete coin must
  migrate explicitly with `migrateCoin`. No internal graduation or swap exists.
- Migrated coin: `swapUrl` from `raydium.ts` opens Raydium market trading; `sell` now calls floor redemption,
  which burns tokens at the fixed floor. Label that action **Redeem floor**, never imply a market swap.
- Hooks: `useCoins`, `useCoin`, `useWallet`, `useMounted`. The compatibility-named `burnerAddress` returns
  only the connected public wallet address on public clusters; it does not generate a burner there.

Preserve the retained-floor product copy in the root app's docs. A v4 program alone does not update the
separately hosted Lovable app or its existing guard; that integration must be verified in its repository.
USD estimates use the public Coinbase SOL/USD spot feed, refreshed at most once per minute. Quotes
older than two minutes are unavailable; show a dash, not a fixed fallback. Market cap uses actual remaining
mint supply after burns. USD conversion never affects transaction math. The authenticated RPC must stay
behind a server proxy; never put a private endpoint in VITE_RPC_URL. See OPERATIONS.md.
