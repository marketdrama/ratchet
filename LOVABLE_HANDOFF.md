# Lovable handoff — Ratchet v4

This is the current handoff. docs/archive/LOVABLE_HANDOFF_v2-v3.md is historical and must not guide the
new integration. You can build the UI now, in parallel with audit/deployment. Mainnet trading remains
disabled. This is a release candidate; audit or final testing may require reviewed fixes and a kit refresh.

## Ready-to-paste prompt

Build and finish Ratchet's frontend in Lovable using Vite + React. Use the attached v4 wiring kit and
this handoff as the integration contract. The reference Next app is a working behavioral reference;
you can create the UI/UX in Lovable without porting Next itself. Do not redesign the on-chain protocol.

Import all files from lovable-wiring into your client integration directory, including IDL, wallet,
protocol, Raydium, price helpers and hooks. Import polyfill.ts before client modules. Include the
packages/bigint-buffer compatibility package and root pnpm dependency overrides; use the same pinned
Solana/Anchor versions and add buffer as a direct browser dependency. Merge these into Lovable's Vite
package configuration; do not replace it with the reference Next package/scripts. Read lovable-wiring/README.md for exact functions, and OPERATIONS.md for backend
services. Use a server-side RPC proxy: authenticated QuickNode URLs must never be in VITE_* variables.

Build the feed, coin page, create flow, wallet connection, status/error/empty states, and clear product
explanations. Show wallet transaction confirmation/progress and errors honestly. Reads can be wired now;
mainnet is currently undeployed, so an empty feed is expected. Design previews may use explicitly labeled
fixtures, never fabricate live activity, prices, floor backing or successful transactions.

Keep VITE_SOLANA_CLUSTER=mainnet-beta and VITE_ENABLE_MAINNET_TRADING=false. No public-network burner
wallet, airdrops, initialization, token launches, authority changes or mainnet test transactions during
this UI work. Use connected Phantom/Solflare signing only when trading is eventually enabled.

Preserve integer quotes/slippage checks and all account derivations from the kit. USD estimates use the
live display-only feed; missing/stale USD is unavailable, not a hardcoded dollar assumption. Market cap
uses actual remaining mint supply. Spot/floor/chart values and their units must stay consistent.

Before migration: buy tax1.25%; creator-selected sell tax1.25–5%; both fund the floor. Floor payouts burn
tokens and are untaxed. Optional creator buy seeds25% to floor. The amount needed to graduate depends
on trading history and solvency caps; do not promise a fixed86SOL graduation target.

After migration: remaining reserves create Raydium liquidity, received LP is burned, and a separate SOL
vault backs every outstanding token at the fixed migration floor. Raydium swaps use external AMM fees;
they do not pay Ratchet tax or ratchet its floor. Label floor redemption **Redeem floor**; market swaps
are a separate Raydium handoff. Never imply the floor vault becomes pool liquidity or is owner-recoverable.

Metadata is immutable. The no-login Turbo/Arweave uploader is a server/operations tool, not a browser
module. Never embed its signing key or a Pinata JWT in the frontend. Choose/compress actual coin images
and host/verify image+JSON before eventual create; hosting-check proof assets are not real coin assets.
An upload endpoint exposed to users needs server-side validation, authorization/abuse limits and quotas;
do not publish an unprotected signing/upload endpoint.

The Next /api/solana gateway currently supports read/simulation only. The real Lovable backend must
provide equivalent safe reads; transaction relay is part of final launch integration and must be tested
before enabling trading. Do not flip the guard merely to make a button appear to work.

Show that this is an unaudited release candidate and, while planned, an upgradeable temporary showcase.
Do not describe the program as immutable, audited or deployed. Retain upgrade authority as the owner
requested; future shutdown requires settling floor claims, including pool-held tokens.

Deliver the completed UI with wallet/quote/network guards preserved. Report which flows are mock-tested,
which are read-only live, and which await mainnet deployment/lifecycle verification. Publish/enable
mainnet trading only after the launch checklist is satisfied.

## Deliverables to send

- This file and lovable-wiring/README.md.
- Entire lovable-wiring directory, including its .env.example (no actual credentials).
- package.json, pnpm-lock.yaml, pnpm-workspace.yaml and packages/bigint-buffer.
- OPERATIONS.md and MAINNET_CHECKLIST.md for backend boundaries and launch gates.
- app/, components/ and lib/ only as behavior/reference code, if useful.

The prepared release/ratchet-lovable-v4.zip contains the focused handoff and dependency inputs; it does
not contain wallets, environment secrets, local logs, a compiled Solana program or the old sample dataset.
