> Historical v2/v3 reference. The v4 release candidate supersedes these instructions. See the root README.md, DEPLOY_MAINNET.md and RELEASE_STATUS.md for current behavior and commands.

# Raydium CPMM migration — real locked liquidity at graduation

Chosen path (easiest that's genuinely real): migrate a graduated coin into a **Raydium CPMM pool** and
**burn the LP** so liquidity is permanently locked and the coin trades on Raydium + Jupiter.

## Two-step flow (v1 — shippable now)

**Step 1 — on-chain release (built + localnet-verified).** `release_for_migration` (ADMIN-gated,
once per completed curve) sends the coin's remaining tokens + the curve reserves + the floor vault to
the platform migration authority, and marks the coin graduated (the internal `swap` pool is then empty
and disabled). Proven on localnet: a completed curve released all tokens + reserves + vault to the
authority, zeroed the curve, and rejected a second call.

**Step 2 — off-chain pool creation (`onchain/app/migrate-raydium.mjs`).** The authority creates a real
Raydium CPMM pool (coin / wSOL) from the released funds with `@raydium-io/raydium-sdk-v2`, then **burns
the LP** → permanent locked liquidity. The SDK handles wSOL wrapping, the 20-account `initialize`, and
the create-pool fee.

```
# after a coin's curve completes:
anchor/CLI: call release_for_migration(mint)   # step 1 (admin signs)
npm i @raydium-io/raydium-sdk-v2 @solana/web3.js @solana/spl-token bn.js
RPC_URL=https://api.devnet.solana.com MINT=<mint> node onchain/app/migrate-raydium.mjs   # step 2
```

Devnet Raydium constants — VERIFIED on-chain (an earlier doc had the wrong amm_config):
```
CPMM program     DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb
AmmConfig idx 0  5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy   (PDA ["amm_config", u16_be(0)]; exists, owner=CPMM, len 236)
createPool fee   3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy   (wSOL token account on devnet)
mainnet CPMM     CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C
```
⚠️ `D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2` (from a web search) is WRONG — it's system-owned/empty.
Use `5MxLgy9o…`. Derive yourself: `onchain/app/raydium-pda-derive.mjs`.

Raydium CPMM PDA seeds (program = CPMM):
```
authority    ["vault_and_lp_mint_auth_seed"]
pool_state   ["pool", amm_config, token_0_mint, token_1_mint]   (token_0 < token_1 by pubkey)
lp_mint      ["pool_lp_mint", pool_state]
token_vault  ["pool_vault", pool_state, mint]   (per side)
observation  ["observation", pool_state]
```
`initialize` discriminator = `[175,175,109,31,13,152,155,237]`; args `(init_amount_0, init_amount_1, open_time)` u64 LE.

## v2 test harness + CURRENT DEBUG STATE (2026-11-08)

Test WITHOUT devnet SOL by cloning Raydium CPMM into a local validator:
```sh
solana-test-validator --reset --quiet --url https://api.devnet.solana.com \
  --clone-upgradeable-program DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb \
  --clone 5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy \
  --clone 3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy &
cd onchain && anchor build
solana program-v4 deploy ./target/deploy/ratchet_curve.so --program-keypair program-keypair.json
cd app && node migrate-test-localnet.mjs   # inits small-param global, completes a coin, runs migrate_to_raydium
```

**RESOLVED (2026-11-08, session 3) — WORKING on localnet.** `migrate_to_raydium` now creates a real Raydium
CPMM pool, burns the LP (supply → 0), and graduates the coin. Test prints `MIGRATE_TO_RAYDIUM: POOL CREATED ✓`.

- **Suspect (a) was WRONG.** `msg!` showed `curve_lamports = real_sol + floor_vault + rent` exactly; the moves
  conserved lamports perfectly. The debit was never off.
- **Real cause:** the runtime only accepts a direct `try_borrow_mut_lamports` write at a CPI boundary when the
  OFFSETTING write is on another account IN THAT SAME CPI's account set. `sync_native` carries only
  `creator_wsol`, so raw-crediting it while debiting the `bonding_curve` PDA (not in that CPI) trips the
  verifier — even though the whole instruction balances. So the pooled SOL cannot leave the program-owned PDA
  via a raw write that precedes a CPI. (`release_for_migration` raw-writes safely only because NO CPI follows;
  `buy` funds via a `system_program::transfer` CPI, not a raw write.)
- **Fix:** the crank (`creator`) FRONTS the pooled wSOL from its own balance via
  `system_program::transfer(creator → creator_wsol, wsol_liquidity)`, then sync_native → Raydium `initialize`
  → LP burn, and ONLY AFTER all CPIs drains the curve reserves+vault to the crank with raw writes
  (`curve -= moved; creator += moved`, no CPI after — the proven-safe shape). Crank is reimbursed + keeps the
  0.3 SOL reserve as reward; atomic. Clients must also attach a ~600k-CU `ComputeBudget` ix (Raydium
  `initialize` ~124k CU; the full ix exceeds the 200k default). Full detail: BUILD_LOG.md session 3.
- **Deploy gotcha:** `program-v4` redeploy is flaky here (silent no-op with `--buffer`; fails without one when
  the `.so` grows). Reliable localnet path: `--reset` the validator + deploy once with `--program-keypair`.
  Verify by TEST BEHAVIOR, not a `program-v4 dump` (that also failed silently).

## Trust model — read this
In v1 the migration authority (ADMIN) **briefly custodies the funds** between step 1 and step 2. That is
a trust assumption: a compromised/malicious authority could keep them. It is the standard early-launchpad
pattern (pump.fun migrated this way for a long time), and the **burned LP** makes the *resulting* pool
liquidity trustless and permanent. But it is not fully trustless end-to-end.

## v2 — trustless (for mainnet)
Replace both steps with a single on-chain instruction that **CPIs into Raydium CPMM `initialize`** via
`invoke_signed` (the curve PDA as pool creator/signer), wrapping reserves+vault to wSOL, creating the pool
atomically, and burning/locking the LP in the same transaction — no authority ever touches the funds. The
full `initialize` account layout (20 accounts) and the seeds (`POOL_SEED`, `POOL_VAULT_SEED`,
`POOL_LP_MINT_SEED`, `OBSERVATION_SEED`, `AUTH_SEED`) are known; it's hand-built CPI (no `raydium-cp-swap`
crate, to keep the SBF build's pinned deps intact). This is the audit-critical piece and the right form
for real money.

## Status / what's left
- Step 1 instruction: **built, localnet-verified.** In the program binary.
- Step 2 script: **written, not yet end-to-end tested** — needs a completed coin + ~0.3+ SOL (create-pool
  fee ~0.15 + rent + pooled SOL). Not testable with the current ~0.96 devnet SOL (completing a curve to
  graduate is ~86 SOL; use a small-param test coin, or fund for a real run).
- Devnet program upgrade for this instruction is **blocked on ~2 more devnet SOL**: the new `.so` is
  369,864 B (> the 360K slot), so it needs another `program extend` + a ~1.9 SOL transient upgrade buffer.
- Mainnet still requires v2 (trustless CPI) + a third-party audit (see `SELF_AUDIT.md`).

---

# v3 — system-owned SOL vault (capital-free trustless migration)

**Spec'd 2026-11-08 (session 4). NOT built.** Resolves the one real downside of v2: the fronting model.

## The problem v3 solves

In v2 the curve's SOL lives **directly on the `bonding_curve` PDA** — a program-owned account that also
carries the `BondingCurve` struct data (`lib.rs`: `system_program::transfer(user → bonding_curve)` on buy;
raw `try_borrow_mut_lamports` writes on sell/release/migrate). A program-owned, data-carrying account:

- **CAN** be raw-credited/debited by its owning program (`try_borrow_mut_lamports`) — but only safely when
  **no CPI follows** (the runtime's balance verifier rejects a raw write whose offset isn't in the next
  CPI's account set — the whole v2 debug saga).
- **CANNOT** be the `from` of a `system_program::transfer` CPI — the System program requires the source to
  be system-owned with **zero data**. The `bonding_curve` PDA is neither.

So at migrate, the pooled SOL can't leave the PDA *into Raydium* before the Raydium CPI. v2's fix: the crank
**fronts** the pooled wSOL from its own wallet (a sanctioned system-transfer CPI), runs Raydium init + LP
burn, then raw-drains the curve to the crank *after* all CPIs. Atomic and safe — but the crank must hold
**~85 SOL of working capital** per migrate at mainnet economics (`virtualSol 30`). Fine for an MEV/arb bot;
a wall for a casual permissionless crank → graduation centralizes onto whoever runs a float.

## The v3 design

Store the curve's SOL in a **separate, system-owned vault PDA**, one per coin:

```
seeds = [b"sol", mint]          // owner = System Program, data_len = 0, holds lamports only
```

`BondingCurve` struct data stays on the existing `[b"curve", mint]` PDA (program-owned). SOL moves to the
new `sol_vault`. Because `sol_vault` is **system-owned with no data**, the program can move its lamports with
`invoke_signed(system_program::transfer, from = sol_vault, to = dest, &[sol seeds])` — a proper CPI, so
lamports balance **at the CPI boundary** and the "raw-write-before-CPI" verifier problem **cannot arise**.
Migration then needs no fronting:

```
migrate_to_raydium (v3):
  1. coin tokens  : curve_vault → creator_coin           (PDA signs, unchanged)
  2. pooled wSOL  : invoke_signed(system transfer,
                      sol_vault → creator_wsol, wsol_liquidity, &[b"sol", mint, bump])   ← no fronting
  3. sync_native(creator_wsol)
  4. Raydium initialize (invoke, creator signs)          (unchanged)
  5. burn creator LP                                      (unchanged)
  6. settle: reimburse the crank Raydium's actual cost from the reserve:
             invoke_signed(system transfer, sol_vault → creator, MIGRATE_SOL_RESERVE, &[sol seeds])
             (or drain sol_vault to exactly 0 and close it)
  7. finalize flags
```

Crank working capital drops from **~85 SOL → ~0.3 SOL** (just gas + Raydium's create-pool fee + rents, which
`MIGRATE_SOL_RESERVE` reimburses). Still fully atomic → the crank can never extract funds.

## Correctness notes (what an auditor checks)

- **System-owned PDA as CPI signer** is the canonical Solana "vault" pattern — `invoke_signed` a system
  transfer with the derivation seeds; the System program verifies the PDA signed and is system-owned/0-data.
  Standard, well-trodden; auditors prefer it to v2's clever fronting dance.
- **The source of a system transfer must have 0 data** → keep ALL `BondingCurve` fields on `[b"curve"]`;
  `[b"sol"]` only ever holds lamports. Never `init` it as a data account.
- **Creation:** the first `system_program::transfer` INTO the `[b"sol", mint]` address auto-creates it as a
  0-data system account (no explicit init). Seed it rent-exempt (~0.00089 SOL) on `create` so it always exists.
- **Rent floor on drains:** a system transfer leaving the source **nonzero but below rent-exempt min** is
  rejected. Keep `sol_vault` ≥ rent-exempt min at all times, OR drain it to **exactly 0** (and let it be
  GC'd / re-created next buy). Spec: retain the rent-min dust on every sell/migrate; only a full coin
  wind-down drains to 0.
- **Blast radius:** every SOL-moving path changes, not just migrate — `buy`, `create` (dev_buy),
  `sell` (payout), `swap` (both sides), `release_for_migration`. Each `system_program::transfer(... → c)`
  becomes `... → sol_vault`; each raw `**c.lamports -= x; **user.lamports += x` payout becomes
  `invoke_signed(system transfer, sol_vault → user, x, seeds)`. The sell/swap payouts gain a CPI (slightly
  more CU) but lose the raw-write subtlety entirely → simpler to reason about.
- **Account layout is BREAKING** (a new PDA per coin, and SOL no longer on `bonding_curve`). Existing devnet
  coins don't carry over. This is a **fresh-program-id** change — which mainnet requires anyway (fresh
  keypair + `declare_id!` + verifiable build), so v3 is the natural mainnet binary, not a devnet in-place
  upgrade.

## Test plan (localnet, cloned Raydium — same harness as v2)

1. Fresh validator with Raydium CPMM cloned (as in §v2 test harness), `--reset`, deploy with
   `--program-keypair`.
2. Re-verify the **whole lifecycle** on the new layout: create (+dev_buy seeds the `sol_vault`), buy
   (SOL → sol_vault, tokens out), sell (both curve-net and floor-backstop payout via invoke_signed), ratchet
   clicks, complete, then `migrate_to_raydium` with a crank funded with only ~0.3 SOL → assert pool created,
   LP supply 0, `sol_vault` drained to the reserve/zero, crank net ≈ +reserve − Raydium cost.
3. The key new assertion vs v2: the crank's **starting balance can be < 1 SOL** and the migrate still lands
   (proves capital-free).

## Build-now vs gate-in-audit — recommendation

**Recommend: SPEC now (done, above) + BUILD on localnet before the audit, but DON'T touch the live devnet
artifact.** Reasoning:

- *For building now:* v3 is the correct mainnet form; proving the capital-free path on localnet de-risks the
  design before paying for an audit (cheaper to find a layout bug now than in audit round 2). Mainnet is a
  fresh deploy regardless, so the breaking layout change costs nothing extra there. Auditors prefer the
  standard vault pattern.
- *Against doing it live:* the rewrite touches `buy`/`sell`/`swap` — all currently green + devnet-verified.
  Reintroducing a bug into working code for a mainnet-only benefit is the risk. So keep the **v2 fronting
  migrate as the verified devnet artifact** and build v3 on a separate localnet branch / behind the fresh
  mainnet program id. v3 becomes live only as the audited mainnet binary.
- *Cheapest alternative (if deferring):* ship v2 as-is + run a **platform keeper** that holds the ~85 SOL
  float and cranks graduations. Removes the capital barrier operationally without a program rewrite — at the
  cost of graduation depending on the platform's keeper (still trustless *funds*, just not permissionless
  *cranking*). Good enough to launch; v3 can land in a later audited upgrade (if authority stays multisig,
  not immutable).

**Net:** v3 is worth building to localnet-proven before audit; it should NOT replace the devnet v2 yet, and
it must stay gated behind the audit + fresh mainnet deploy per MAINNET_CHECKLIST (no mainnet, no guard flip).

---

# v3.1 — pool-paid graduation (sender needs ZERO SOL)

**Built + localnet-verified 2026-11-08.** Refinement of v3: the graduation transaction costs the sender
nothing. In v3 the sender (crank/creator) fronted ~0.3 SOL for Raydium's fee + account rents, then got it
back +0.1 in the same tx (reimburse-after). In v3.1 the pool **pre-funds the sender first**, so no capital is
needed on hand at all.

## The change (in `migrate_to_raydium`)

- **Step 0 (new):** `invoke_signed(sol_vault → creator, MIGRATE_SOL_RESERVE)` at the very top — the pool
  hands the tx sender the 0.3 SOL budget BEFORE any account is created or any Raydium fee is charged.
- The sender's two ATAs (`creator_coin`, `creator_wsol`) are now created **in-handler** with
  `associated_token::create_idempotent` (funder = sender, paid from the pre-fund), instead of Anchor
  `init_if_needed, payer = creator` (which charged the sender ~0.004 SOL *before* the handler ran). In the
  account struct they became `UncheckedAccount` (create_idempotent enforces the canonical ATA).
- **Step 6 removed:** no post-hoc reimbursement — the sender was already pre-funded.
- Net result: the sender spends the pool's SOL on the ATAs + Raydium's create-pool fee + pool-account rents,
  all within the tx, and needs **ZERO of its own** beyond the ~5000-lamport base Solana tx fee. The leftover
  margin (~0.1 SOL) stays with the sender as the permissionless-graduation reward. Lamports still conserved:
  the vault pays out exactly `real_sol + floor_vault` across step 0 (reserve) + step 2 (wsol_liquidity),
  leaving only the rent-min seed.

## Verified (localnet, cloned devnet Raydium)

`app/migrate-test-localnet-v3.mjs`, crank wallet funded with only **0.03 SOL** against a **0.5 SOL** pool
deposit: migrate landed — real Raydium pool created (owner `DRaycpLY…`), 0.2 wSOL + 999M coin, **LP burned
(supply 0)**, `bonding_curve` held 0.00261 SOL (no user funds), `sol_vault` drained 0.50089 → 0.00089. Crank
**0.03 → 0.134 SOL (net +0.104)** — it could not have fronted the 0.5-SOL pool; the pool paid. migrate tx
`25vJdzQZwhwAQue7fomEKi7xvjdejf3rBJVvzcK9ducPYXrPje6kx4nZ1wHn5xNhPMwf8jNUD3qrNHQQpfqVJfFV`. Buy/sell/floor
paths unchanged (sell-smoke still green).

Devnet re-run of v3.1 was blocked only by the devnet faucet (upgrade needs ~2.8 SOL transient; deployer had
2.75, airdrop rate-limited). The Raydium CPI is byte-identical to v3, which WAS verified on real devnet
Raydium (tx 5tmNPqR6…), so the real-Raydium interaction is already covered; v3.1's delta is the SOL funding
order, covered on localnet. Still UNAUDITED — audit before mainnet.
