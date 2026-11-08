> Historical v2/v3 reference. The v4 release candidate supersedes these instructions. See the root README.md, DEPLOY_MAINNET.md and RELEASE_STATUS.md for current behavior and commands.

# ratchet-curve — security review (self-review, not an audit)

Manual review of `programs/ratchet-curve/src/lib.rs` against the common Solana / Anchor
vulnerability classes. **This is a developer self-review, not a third-party audit.** The
program is unaudited and for localnet / devnet only. Date: 2026-11-06.

Program id `2KYq5Za1PctA7p6XzaSnXAjCe2ARMCE5iWtMViHDaqmn`. Deployer / intended admin
`2XPJm6qcPurJJ31jHrJZTKYoBQS9HkAtt1NyMnizXDWq`.

## Findings

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | HIGH (mainnet) | `initialize` had no access control — first caller set fee/floor params + became admin (front-runnable on a public deploy) | **FIXED** — gated to a hardcoded `ADMIN` |
| 2 | HIGH (econ) | Floor insolvency: a crashed curve let buyers mint tokens the vault couldn't back | **FIXED earlier** (buy caps out at the floor) |
| 3 | MEDIUM (ops) | Upgrade authority = single deployer key → program can be swapped wholesale | Runbook'd — hardened at mainnet deploy via `set-upgrade-authority --final` (immutable) or a Squads multisig; see [DEPLOY.md](DEPLOY.md). Can't be done on this localnet (loader gating + loader-v4 tooling immaturity). |
| 4 | LOW | Token donation to `curve_vault` before graduation inflates `pool_tokens` (cheaper post-grad buys) | Open — economically irrational (attacker burns own tokens); accepted |
| 5 | LOW | No pause / emergency stop; `admin` field is otherwise unused | Accepted by design (favours immutability) |
| 6 | INFO | `curve_out` capped at `real_sol` at end of curve → tiny `k` artifact | Benign, favours protocol |
| 7 | INFO | Direct lamport/SOL donation to the curve PDA is locked forever | Benign (no withdraw path reads raw lamports) |

## Checks that PASS (no issue found)

- **Signer checks** — `user` / `admin` / `payer` are `Signer`; trades require the user's signature.
- **Ownership / account substitution** — `bonding_curve` is a PDA `["curve", mint]` with `has_one = mint`;
  `curve_vault` and `user_ata` are constrained ATAs (`associated_token::mint/authority`), so none can be
  swapped for an attacker's account.
- **PDA canonical bump** — bumps are stored at init and reused via `bump = …` (no bump grinding).
- **Arithmetic** — all math is `u128`; `overflow-checks = true` in `Cargo.toml`, so any overflow **aborts
  the tx** (no silent wrap). Fuzz shows realistic values sit ~9 orders of magnitude under `u64`.
- **Rounding** — buy `out`, `curve_out`, `floor_out` all truncate **down** (toward the protocol); no
  rounding-theft path for the user.
- **Reentrancy / CPI** — CPIs go only to the SPL Token and System programs, which cannot call back into
  this program. State is computed before the CPIs; no stale-read after a CPI.
- **Lamport / rent safety** — payouts are capped at `real_sol` (curve) or `floor_vault` (floor); neither
  counts the account's rent deposit, so the curve PDA always stays rent-exempt. An under-pay would hit a
  `u64` underflow and abort, never drain.
- **Fixed supply** — the whole supply is minted to the curve vault at `create`, then mint authority is
  **revoked** (`set_authority … None`); no further minting is possible.
- **Slippage / MEV** — `buy`/`sell`/`swap` all take `min_*_out` and revert on an unfavourable fill.
- **Name/symbol bounds** — length-checked at `create` to match `#[max_len]`, so account size can't overflow.
- **Solvency invariant** — `vault ≥ circulating × floor` holds across 5000-op fuzz + a 12-actor
  interleaving model (see `test/fuzz.test.ts`).

## Recommendations before any real-value deploy

1. A proper third-party audit. The solvency guard (finding #2) is fuzz-proven, not formally verified.
2. Move the program upgrade authority to a multisig, or make the program immutable (finding #3).
3. Rotate `ADMIN` (finding #1) to the real deployer for that cluster, and initialize `global` atomically
   with the deploy so there is no init window.
4. Consider snapshotting the migration remainder at completion instead of reading `curve_vault.amount` at
   `graduate` (finding #4).
