> Historical v2/v3 reference. The v4 release candidate supersedes these instructions. See the root README.md, DEPLOY_MAINNET.md and RELEASE_STATUS.md for current behavior and commands.

# ratchet-curve — on-chain (Phase 2)

A self-contained Anchor program implementing the ratchet bonding curve on Solana.
Built, deployed to a local validator, and exercised end-to-end.

Rather than fork the template's full pump.fun reconstruction (five programs, ~65k LOC,
the template's own README says it never ran end to end), this is a focused program
that mirrors `../lib/ratchet.ts` exactly: constant-product curve + a floor vault,
hybrid funding (10% of each buy + the trade fee), a floor that only clicks up, and
sells paid `max(curve, floor)`.

Program id: `2KYq5Za1PctA7p6XzaSnXAjCe2ARMCE5iWtMViHDaqmn`

## Instructions

| ix | what |
| --- | --- |
| `initialize` | set launchpad params (reserves, `fee_bps`, `floor_cut_bps`) |
| `create(name, symbol)` | mint full supply into the curve vault, open the curve, revoke mint authority |
| `buy(sol_in, min_tokens_out)` | split `10% + fee` into the floor vault, deliver tokens, ratchet the floor |
| `sell(tokens_in, min_sol_out)` | pay `max(curve, floor)`; floor path burns the tokens and debits the vault |
| `graduate` | mark a completed curve (migration to a pool is noted, not implemented) |

State: `Global` (params) + `BondingCurve` per mint (reserves, `floor_vault`,
`floor_scaled` high-water, `circulating`, `complete`). The floor vault's SOL lives in
the `BondingCurve` PDA; `floor_scaled` is the floor price × 1e18, monotonic.

## Build, deploy, test

```sh
# 1. build (first build pulls crates; see the pin note below)
anchor build

# 2. local validator (separate terminal)
solana-test-validator --reset
solana config set --url http://127.0.0.1:8899

# 3. deploy
anchor deploy --provider.cluster localnet

# 4. end-to-end lifecycle
cd app && pnpm install && node lifecycle.mjs
```

## Verified lifecycle (local validator)

```
initialized global
created coin: hDXMnxNnfzWwQVvaEgC28HcXfZXjSeSiesWcMHYkWqL

=== buys (floor + vault climb) ===
buy 1 SOL #1   spot=3.892e-9  floor=3.329e-10  vault=0.1100 SOL  realTok=462.7M  youHold=330.4M
buy 1 SOL #2   spot=6.658e-9  floor=4.354e-10  vault=0.2200 SOL  realTok=287.8M
buy 1 SOL #3   spot=1.016e-8  floor=5.379e-10  vault=0.3300 SOL  realTok=179.6M
buy 1 SOL #4   spot=1.441e-8  floor=6.404e-10  vault=0.4400 SOL  realTok=106.1M

=== sell 20% (curve path) ===
sold 137.4M tokens -> +1.4597 SOL
after sell     spot=7.834e-9  floor=6.404e-10 (held flat)  vault=0.4400 SOL

=== buy out -> graduate ===
graduated      spot=3.055e-8  floor=1.248e-9  vault=0.9900 SOL  realTok=0  complete=true
ON-CHAIN LIFECYCLE OK ✓
```

Confirmed on-chain: the vault takes exactly 11% of every buy (10% principal + 1% fee),
the floor ratchets up monotonically and holds flat through a sell, and the curve
graduates with the floor vault fully backed and locked.

### Floor backstop firing post-graduation

Graduation opens a built-in constant-product pool (`swap`), and sells there are still
paid `max(pool, floor)`. With a bigger floor cut, a dump that pushes the pool price
below the floor is caught by the vault — live, on-chain:

```
graduated -> pool opened
swap buy 18 SOL (top-buyer)   poolPrice=7.967e-7
dump #1  got 27.14 SOL  poolPrice=3.985e-9  floor=4.622e-9  vault=4.160
dump #2  got  1.11 SOL  poolPrice=3.985e-9  floor=4.622e-9  vault=3.047  <<< FLOOR BACKSTOP PAID
dump #3  got  0.56 SOL  poolPrice=3.985e-9  floor=4.622e-9  vault=2.490  <<< FLOOR BACKSTOP PAID
 ...                     poolPrice FROZEN below floor, vault draining as it buys sellers out
```

Once the pool price (3.985e-9) is below the floor (4.622e-9) it freezes there — the
floor path doesn't touch the pool — and the vault pays every subsequent seller at the
floor, draining 4.16 → 1.93 SOL. The ratchet floor's teeth, on-chain.

## Build note — the edition2024 trap

The SBF toolchain (platform-tools v1.43, rustc 1.79) can't build crates that bumped to
`edition2024` or MSRV 1.85. Fresh `cargo` resolution pulls those by default, so the
build is pinned to the template-era graph. If `anchor build` fails with "feature
`edition2024` is required" or "requires rustc 1.85", downgrade the offender:

```sh
cargo update <crate>@<new> --precise <old>
```

Already pinned in `Cargo.lock`: solana-program 2.2.1, borsh 1.5.7, proc-macro-crate
3.2.0, indexmap 2.9.0, hashbrown 0.15.5, zeroize 1.8.1 / zeroize_derive 1.4.2,
blake3 1.5.5 / constant_time_eq 0.3.1, unicode-segmentation 1.12.0.

## Not implemented (scope)

- Real migration in `graduate` (create a Raydium/AMM pool and move curve SOL + vault in
  as locked LP). The program marks completion and emits `GraduateEvent`; wiring a pool
  CPI is the next step.
- Metaplex metadata on `create` (kept off to stay self-contained).
- Unaudited. Localnet / devnet only.
