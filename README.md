# ratchet — a floor backed by reserved SOL

Solana launchpad release candidate **v4**. Curve trading funds a ratcheting floor. On graduation,
remaining reserves create a canonical Raydium CPMM pool and all received LP is burned; a separate SOL
reserve continues to back every outstanding token at the fixed graduation floor.

**Not deployed to mainnet. Unaudited.** See [MAINNET_CHECKLIST.md](MAINNET_CHECKLIST.md) and
[DEPLOY_MAINNET.md](DEPLOY_MAINNET.md). Historical v2/v3 deployments are incompatible with this release.

**Deployment plan:** temporary upgradeable showcase, followed by wind-down and ProgramData rent recovery.
Upgrade authority stays with the owner; do not finalize. See the shutdown conditions in the runbook.

## Mechanics

- Buy tax: 1.25%; creator-selected curve sell tax: 1.25–5%. Both go entirely to the floor vault.
- Optional creator buy: 25% seeds the floor; the rest buys tokens. No platform or creator tax income.
- Curve sells receive the higher of net curve proceeds and floor value. Floor payouts burn tokens and
  are untaxed. Buy issuance is capped so every newly issued token is backed at the existing floor.
- Graduation has one permissionless route: pinned Raydium CPI, canonical accounts, LP burn, full-supply
  floor backing retained. No ADMIN release, internal pool or swap route exists in v4.
- After migration: use Raydium for market swaps, or `redeem_floor` to burn tokens for the fixed floor.
  Raydium swaps have Raydium fees, do not charge Ratchet's tax and do not ratchet the floor.
- A 0.3 SOL reserve from curve reserves pays migration account/creation costs; its unused balance rewards
  the caller. The caller needs transaction fees. Floor backing is never used for that reward.

Graduation cost is **not a fixed 86 SOL**. Floor-backed issuance depends on buy sizes and creator seed.
For example, a 1 SOL creator buy followed by 5 SOL buys needs 780 SOL of follow-up buys without sells in
this engine. Quotes enforce the solvency cap and a default 1% minimum-output tolerance. Do not weaken the
cap to reproduce the old budget estimates.

## Develop and verify

Node 24, pnpm, Solana CLI/cargo-build-sbf 2.2.1 (platform tools v1.44), Anchor CLI 0.31.1.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm test:onchain      # isolated local validator, clones mainnet Raydium + Metaplex; no public writes
pnpm release:build     # MAINNET artifact; no test features; regenerate IDLs/kit + manifest
pnpm test:release      # exact default bytecode on local validator with production config fixture
pnpm release:verify
```

The integration test uses a public deterministic **test-only** wallet funded only by the local validator.
No personal signing key is required. It verifies production-parameter engine/chain parity, immutable
metadata, rejected account substitutions, LP burning and retained-floor redemption.

`pnpm test:onchain` builds with `test-admin` for local initialization. Always run `release:build` afterward
before staging a release. **Never deploy test-admin/devnet features to mainnet.** Account auto-resolution
is disabled in Anchor because of its IDL compiler issue with ATA expressions; clients supply all accounts.

## Layout

- `onchain/programs/ratchet-curve/src/lib.rs`: protocol; production constants by default.
- `lib/protocol.ts`: shared integer quotes, params and migration budget.
- `lib/chain.ts`, `lib/wallet.ts`, `lib/raydium.ts`: wallet signing, network guard, migration and pool reads.
- `app/`, `components/`: reference Next.js client. Local test wallets exist only for loopback RPC.
- `lovable-wiring/`: generated v4 Vite kit; synced from the tested reference client.
- `onchain/app/launch-mainnet.mjs`: explicit, resumable CLI; defaults to read-only preflight.
- `scripts/`: local integration, release hashing, metadata image/JSON pinning.
- `release/manifest.json`: reviewed source/artifact hashes. No private keys belong in source control.

The actual Lovable app is outside this workspace; import the v4 kit and verify that app separately.
USD displays are estimates using the configured assumption, not an oracle. RPC polling is suitable for
an initial deployment; a durable indexer is a separate scaling task.

MIT licensed; see LICENSE. No independent audit has been completed.
