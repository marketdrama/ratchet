# Meteora migration — design + why metRUSH isn't drop-in

> **Decision:** went with **Raydium CPMM**, not Meteora — see `RAYDIUM_MIGRATION.md` (the chosen, built
> path). This file is kept for the Meteora comparison + the reasoning behind the choice.

Goal: at graduation, move a ratchet coin's reserves into a **real Meteora cp-amm (DAMM v2) pool** and
**lock the floor vault as liquidity**, instead of the current internal pool.

## Why the metRUSH code doesn't port
metRUSH/metpad is a **thin client over Meteora's Dynamic Bonding Curve (DBC)** program — Meteora runs the
curve, dev buy, migration to DAMM v2, and LP lock. `src/lib/meteora.ts` just builds txs against Meteora's
own programs with `@meteora-ag/dynamic-bonding-curve-sdk` + `@meteora-ag/cp-amm-sdk`.

Ratchet is the opposite: a **custom Anchor program** whose whole point is the ratcheting floor vault.
Meteora DBC has no floor vault, so adopting DBC means deleting the product. The reusable pieces are the
**SDK deps**, the **config / migration-fee-option patterns**, and the **pool-verify** logic — not the
migration itself.

## Two real paths

### A. cp-amm CPI migration (keeps the floor) — the right one, the hard one
Add a `migrate_to_meteora` instruction to ratchet. On a complete curve it:
1. CPIs into **cp-amm (DAMM v2)** `initialize_pool`, with the ratchet curve PDA as the creator/signer,
   depositing `real_sol` + the remaining vault tokens as the initial pool.
2. Deposits the **floor vault SOL** as additional single-sided/base liquidity (or pairs it), then
   **locks or burns the LP position** so liquidity is permanent.
3. Marks the coin graduated and points reads at the real pool.

Cost: this is net-new Rust CPI against cp-amm's exact account layout (pool, config, token vaults, position
NFT, authority PDAs). cp-amm's SDK is TypeScript, so the on-chain account wiring must be hand-built and
matched to the deployed cp-amm program. **This instruction custodies pooled real money and is the single
most audit-critical piece in the program.** It must be built carefully and audited — not rushed for a
launch.

Reference inputs from metRUSH: `scripts/create-config.ts` (the shared DAMM v2 config + migration-fee
option), `src/lib/meteora.ts` `verifyPoolIsMetrush` (pool-provenance check), `@meteora-ag/cp-amm-sdk`
version `^1.5.1`.

### B. Rebuild on Meteora DBC (free migration, no floor)
Drop ratchet's program and launch coins through Meteora DBC like metpad does — you inherit Meteora's
audited curve + DAMM v2 migration + LP lock for free. **But you lose the ratcheting floor**, which is the
entire differentiator. Only worth it if the floor is negotiable.

## Recommendation
If the floor stays, it's **Option A**, scoped as its own milestone: implement `migrate_to_meteora`, test
on devnet against cp-amm, then **audit the whole program including this instruction** before mainnet.
This is multi-day on-chain work, not a link — and it does not change the mainnet gate: no real funds until
it's built, tested, and independently audited.
