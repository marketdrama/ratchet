> Historical v2/v3 reference. The v4 release candidate supersedes these instructions. See the root README.md, DEPLOY_MAINNET.md and RELEASE_STATUS.md for current behavior and commands.

# Mainnet path — the exact sequence from devnet to live

Companion to [MAINNET_CHECKLIST.md](MAINNET_CHECKLIST.md) (the *what*). This is the *how + in what order*:
the full runbook from the current verified-on-devnet state to a live, verifiable, immutable mainnet deploy.

**Last updated:** 2026-11-08 (session 4). Current state: trustless v2 Raydium CPMM migration
(`migrate_to_raydium`) is DONE + verified on localnet (cloned Raydium) and real devnet Raydium. Everything
else (sell tax, dev-buy seed, slippage, v1 migration, legacy filter, open-source) done + verified.

> **HARD GATE — do not cross without the user + an audit.** Do NOT `solana program deploy` to mainnet-beta,
> do NOT fund a mainnet deployer, and do NOT flip the `network.ts` mainnet guard until steps 1–5 below are
> ALL complete. Real money only ever reaches a contract that has cleared a third-party audit and a verifiable,
> immutable deploy. This file documents the path; it is not permission to walk it.

---

## Where the gate lives (the one-line flip, done LAST)

The frontend guard is in the **Lovable app** (not this repo): `src/lib/ratchet/network.ts`,
`assertTradingNetwork()` — it throws on `mainnet` today (fail-closed). Lifting it is the final step, after
1–5. This repo's `lib/chain.ts` PARAMS + `.env.local` carry the cluster/program id for the in-repo reference
UI; the shipping client is Lovable's.

---

## Step 0 — decide the migration trust model FIRST (blocks the deploy artifact)

Two migration instructions exist in the program:

| | `release_for_migration` (v1) | `migrate_to_raydium` (v2, fronting) | **v3 (system-vault, proposed)** |
|---|---|---|---|
| Trust | authority briefly custodies funds | **fully trustless** (atomic) | **fully trustless** (atomic) |
| Permissionless crank | no (ADMIN only) | yes | yes |
| Crank working capital | n/a | **~85 SOL** fronted, reimbursed same-tx | **~0.3 SOL** (gas + Raydium fee only) |
| Status | localnet-verified | **devnet-verified on real Raydium** | **spec'd, not built** (see RAYDIUM_MIGRATION.md §v3) |
| Account layout | current | current | **breaking** — adds a system-owned SOL vault PDA |

The mainnet program is a **fresh deploy with a fresh program id** regardless (step 2), so this is the moment
to pick the migrate form the mainnet binary ships with. **Decision required before building the mainnet
artifact** — see [RAYDIUM_MIGRATION.md](RAYDIUM_MIGRATION.md) §"v3 — system-owned SOL vault" for the full
spec, correctness argument, and the build-now-vs-gate recommendation. Until decided, the mainnet binary is
the devnet-verified v2 (fronting) with a platform-run keeper that holds the float.

---

## Step 1 — third-party audit (the hard gate; user-arranged)

The program custodies user SOL (floor vault, backstop payouts, migration). It is **unaudited**.
[SELF_AUDIT.md](SELF_AUDIT.md) is an internal review, not independent.

1. Freeze the mainnet binary's source (incl. the chosen migrate form from step 0) and tag the commit.
2. Commission a professional Solana audit (e.g. OtterSec, Neodyme, Zellic, Sec3). **Migration is the
   single most audit-critical instruction** — it's the only path that CPIs an external program and moves the
   whole pooled balance. Scope it explicitly, with v2's fronting/settle ordering OR v3's vault-signer model.
3. Fix findings, re-verify on devnet, re-freeze, re-tag. This is yours to arrange; everything else here I can build.

## Step 2 — build the mainnet artifact (fresh id, verifiable)

```sh
cd onchain
# fresh program keypair for mainnet (NEVER reuse the devnet one)
solana-keygen new -o program-keypair-mainnet.json      # back this up offline
# set declare_id! to the new pubkey, then a VERIFIABLE build so the hash is reproducible:
anchor build --verifiable            # or: solana-verify build
cp target/idl/ratchet_curve.json ../lib/idl.json
```

Rotate the hardcoded `ADMIN` const (`lib.rs:36`) to the mainnet deployer/multisig key **before** this build —
it's baked into the binary and gates `initialize` + `release_for_migration`. Confirm `declare_id!` matches the
new keypair (Anchor 0.31 enforces `declare_id == executing program id`).

## Step 3 — swap devnet ids → mainnet (client + CPI constants)

| Constant | Devnet (now) | Mainnet |
|---|---|---|
| Raydium CPMM program | `DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb` | `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` |
| AmmConfig (idx 0) | `5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy` | derive on mainnet: PDA `["amm_config", u16_be(0)]` under the mainnet CPMM — **verify owner=CPMM, len 236 before use** |
| create-pool fee receiver | `3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy` | `DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8` (per Raydium; re-confirm against live mainnet before first migrate) |
| RPC | `api.devnet.solana.com` | a PAID endpoint (Helius/QuickNode) — the public one is rate-limited |
| cluster | `devnet` | `mainnet` |

`WSOL_MINT` (`So111…112`) is the same on both — no change. The migrate accounts (`amm_config`,
`create_pool_fee`, `cp_swap_program`) are passed in by the client, so these swaps are **client-side**
(`lib/chain.ts` + the Lovable app + the migrate harness), not a program rebuild — except the mainnet CPMM
program id if you choose to hardcode/validate it on-chain (currently `cp_swap_program` is an
`UncheckedAccount` forwarded from the client; consider pinning it as an audit hardening).

## Step 4 — deploy + verify (so anyone can confirm the on-chain code IS this source)

```sh
solana config set --url <paid-mainnet-rpc>
# fund the mainnet deployer: ~2.6 SOL program rent (~370 KB) + a margin for program extend + buffer
solana program deploy ./target/deploy/ratchet_curve.so --program-id program-keypair-mainnet.json
cp target/idl/ratchet_curve.json ../lib/idl.json
# publish the verifiable build so anyone can check the deployed bytecode hash == this repo:
solana-verify verify-from-repo <PROGRAM_ID> --url <rpc>   # (anchor --verifiable path equivalent)
# one-time global init, signed by the mainnet ADMIN, atomically with/after deploy:
node app/seed-init-mainnet.mjs    # (mainnet variant of seed.mjs init; sets 30-SOL economics)
```

Loader note (from the devnet runs): a **fresh** loader-v3 deploy uses
`solana program deploy --program-id <keypair>` (NOT `--program-keypair`, that's v4). Keep the deployer funded;
if the `.so` is larger than a prior slot you need `solana program extend` first. Publish the program id + the
verified build hash in the README.

## Step 5 — secure the upgrade authority (immutable or multisig)

After deploy + verify, pick one and do it **before** any real money:

```sh
# Option A — immutable (no upgrades ever):
solana program set-upgrade-authority <PROGRAM_ID> --final
# Option B — public multisig (Squads), if you want an upgrade path:
solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <SQUADS_VAULT>
```

Immutable is the strongest open-source claim (nobody can change the rules or reach the funds). A multisig
keeps a guarded upgrade path at the cost of a residual trust assumption — document whichever you pick in the
README. Also confirm the on-chain `ADMIN` const is the secured key (set in step 2), not the single devnet dev key.

## Step 6 — THE FLIP (one line, last)

Only once 1–5 are all true: in the Lovable app `src/lib/ratchet/network.ts`, stop `assertTradingNetwork()`
throwing on `mainnet`, and set the mainnet env (RPC, cluster, program id, Raydium ids). Deploy the client.
This is intentionally the last, smallest change — real money reaches the contract only after everything above.

---

## Dry-run before the flip (recommended)

Before flipping, do one **mainnet** migrate on a throwaway tiny-param coin (same trick as the devnet verify:
a small-param test global so a curve graduates for a few SOL instead of ~85), confirm the real mainnet
Raydium pool is created + LP burned (supply 0), then run `release`/`migrate` once more on a real-economics
coin with the keeper. Only then lift the guard for the public.

## Cost summary (mainnet, one-time + per-migrate)

- Program rent (immutable-ish storage): ~2.6 SOL one-time.
- Per migrate: Raydium create-pool fee (~0.15 SOL) + account rents (pool state, 2 vaults, LP mint,
  observation, ATAs) + gas. Covered by `MIGRATE_SOL_RESERVE` (0.3 SOL) held back from the pooled SOL.
- v2 (fronting): crank also needs ~85 SOL float per migrate (reimbursed same-tx). v3: crank needs only the
  ~0.3 SOL above. This is the whole reason to weigh v3 — see RAYDIUM_MIGRATION.md §v3.
