> Historical review of v3.1. The v4 remediation and validation are recorded in RELEASE_STATUS.md and HANDOFF.md. Findings below explain why the changes were required.

# Workspace review — 2026-11-09

Current assessment: **v3.1 is staged, but mainnet deployment should wait for the code issues below.** No mainnet transaction was sent during this review. Source was not modified. This is a developer review, not an independent audit.

## Where we are

- Custom Solana/Anchor bonding curve with a floor vault, 1.25% buy tax, creator-selected 1.25–5% sell tax, and optional 25% dev-buy floor seed.
- v3 stores SOL in a separate system-owned PDA. v3.1 pre-funds the migration caller from that vault to cover pool creation.
- Latest recorded devnet result: v3.1 program `CcELoEGgvJDFjWNXKVXRcRQ3C9cZFstzqqG3Zs7vr4Wk`, Raydium pool `7LaoL9muMWqJAfyV1Z7x6nmsLLtGQ2R1rkkdAGtrneNN`, LP burned. This is historical log evidence, not a fresh RPC verification.
- Staged mainnet program: `35UELzdncBr15qztq55Kct3sZvmXnn5D5e5rpGiHgMuC`; ADMIN: `3vkTXSV3LG7ZrZt1SWMnEYBjNBiYAg168fbEV3Q6skTi`.
- Program keypair public address, Rust declaration, generated IDL and `lib/idl.json` agree. Binary exists, approximately 401 KiB; SHA-256 `897d60d56264dc7055aebb21cc3558b8b36b7fc7c852799ffaa61710f20a753a`. Existence/hash does not establish source equivalence.
- Reference Next.js app uses the staged mainnet IDL but defaults to localhost RPC. `lovable-wiring/` remains on v2 devnet `2KYq5Za1…`. Actual Lovable application and its `network.ts` guard are outside this workspace.
- No Git repository is present here. No external audit deliverable was found. The referenced `RTK.md` was not found in the workspace, checked parent locations, or searched agent/Codex instruction directories.

## Deployment blockers found in current source

### 1. Critical: caller controls the supposed Raydium CPI target

`onchain/programs/ratchet-curve/src/lib.rs:929` declares `cp_swap_program` as an unconstrained `UncheckedAccount`; line 565 uses its key as the CPI program ID. Migration first transfers the curve's tokens and wrapped SOL into the caller's ATAs. There is no requirement that the external program be the approved Raydium deployment, and no final check that a genuine Raydium pool received the liquidity. The LP burn is skipped when the supplied LP account's amount is zero.

Static attack path: a caller supplies an executable that returns success without creating a pool, plus an existing zero-balance token account for the LP read. The handler can then finish with the coin assets in the caller's ATAs. Atomicity alone does not prevent this. This path has not been executed as an exploit in this review.

Required: constrain the CPI program to the approved cluster-specific Raydium ID, validate the config/program/account relationships and pool provenance, and prove rejection of substitute programs/accounts with on-chain negative tests.

### 2. High: ADMIN can still take a completed coin's assets

`release_for_migration` at line 373 transfers the tokens, reserves and floor vault directly to ADMIN. It remains exposed in the staged binary. Making the program immutable would preserve this withdrawal capability. The README's claim that no admin can touch the money is therefore inaccurate.

Required: remove/disable the legacy custodial release route for the intended trustless mainnet deployment, or explicitly adopt and disclose that trust model.

### 3. High: permissionless legacy graduation can block Raydium migration

`graduate` at line 348 marks the coin graduated into the internal pool. `migrate_to_raydium` rejects a graduated coin. Anyone can choose the internal route first; both checked-in browser clients automatically call it when a coin completes. Changing only the UI cannot prevent direct callers from doing this.

Required: establish one enforced graduation state machine for mainnet; remove/gate the internal route if Raydium migration is mandatory. Also review `sell`, which lacks a phase guard and still updates pre-graduation accounting after graduation.

### 4. High/product: the floor does not survive external migration

Migration pools `real_sol + floor_vault - 0.3 SOL`, pays the 0.3 SOL reserve to the caller, then sets `real_sol`, `floor_vault`, and `pool_tokens` to zero (lines 620–622). `floor_scaled` remains positive but its backing is gone. The internal backstop cannot honor that floor, and ordinary Raydium trades do not execute Ratchet's sell-tax/floor logic.

Required product decision: either clearly scope the floor to the bonding-curve phase, or design and test a separately funded post-migration redemption mechanism. Burned LP guarantees locked liquidity, not a minimum sale price.

### 5. High: launch budgets do not match actual floor-capped issuance

Local reproduction with `RatchetCurve`, the script's exact params/dev buy/chunk sizes, and no sells:

| Mode | Follow-up buy cap in script | Follow-up buys needed to complete in engine |
|---|---:|---:|
| test | 6 SOL | 81.5 SOL |
| prod | 90 SOL | 780 SOL |

The floor-solvency cap at Rust lines 217–219 binds during these ordinary seeded launches, contrary to the comment saying it binds only after a crash below the floor. The model and Rust contain this same cap. These are deterministic model reproductions, not new validator tests; amounts depend on trade sizes/history.

The devnet migration fixture used **1 million sellable tokens**, versus **900 million** in `MODE=test`, with a 0.5 SOL dev buy that immediately completes that fixture. Its success does not validate the staged test/prod launch economics.

Required: resolve the intended economics without weakening solvency; test the actual launch parameters on-chain and set explicit spending limits that match them. Current `MODE=test` is not a roughly 1-SOL full-lifecycle test.

### 6. High/ops: test initialization permanently selects production-wide economics

`initialize` creates a single global account once; no update/reset instruction is exposed. The launch script initializes it with whichever mode runs first and later modes silently reuse it. A cheap/test first launch therefore fixes those params for subsequent prod coins on the same deployment. Rerunning the script also generates a new mint; it does not resume the previous coin despite its printed advice.

Required: isolate test deployment/config from production, compare existing global settings before spending, separate initialization from launch/resume, and verify cluster using genesis hash rather than URL substrings.

### 7. Client integration is still a launch workstream

- Both checked-in clients use browser-localStorage burner keys; the production wallet integration is not represented here.
- Both select legacy internal graduation; neither provides the intended external migration/trading handoff.
- `lib/chain.ts` buy quotes omit the on-chain floor-solvency output cap, so its 1% min-out can reject ordinary seeded buys. `lovable-wiring/ratchetClient.ts` still passes zero min-out, despite historical reports of slippage fixes in the separate Lovable application.
- Migrated coins display zero internal spot price and retain an obsolete floor value. Raydium pool identity is emitted but not stored in curve state for client routing.
- Metaplex metadata creation, image/JSON hosting, and durable indexing are absent. Metadata is a launch presentation requirement; indexing can follow initial scale requirements.

## Verification performed

- All 16 engine unit/fuzz tests passed: `node --test --experimental-strip-types test/*.test.ts`.
- `tsc --noEmit --incremental false` failed with TS5097 in both test files: `.ts` imports require `allowImportingTsExtensions`. The package's `test` script also omits the fuzz file.
- Launch script syntax check passed. The mode-budget reproductions above used the existing engine.
- No Rust rebuild: invoking `anchor --version` attempted activation of Solana 2.1.0 and failed; installed Solana CLI reports 2.2.1. The staged binary was left untouched.
- No validator lifecycle, exploit transaction, fresh chain-state/balance check, or deployment was run. Wallet balances and deployment absence in old logs must be rechecked before any future deployment.

## Ordered next work

1. Fix and adversarially verify CPI target binding, remove the custodial escape route, and enforce the intended graduation state machine.
2. Settle post-Raydium floor behavior; reconcile program, clients and public claims.
3. Resolve floor-capped issuance economics; test realistic seeded launches and matching client quotes.
4. Repair initialization/launch/resume tooling and isolate test vs production configuration.
5. Complete v3.1 production frontend wiring, wallet signing, Raydium routing, metadata and hosting.
6. Restore reproducible builds/type checks; put source under version control without committing keypairs. Obtain an independent audit of the resulting source.
7. Recheck actual mainnet program state, RPC, signer availability, balances and live rent/config fees; deploy the reviewed artifact, initialize verified production parameters, verify bytecode, test the intended mainnet flow, secure upgrade authority, then enable public trading.

Do not use the existing checklist as evidence these code conditions are already satisfied. Its old v2/devnet blockers are stale, while the issues above remain in the staged v3.1 source.

Raydium's current official fee reference lists roughly 0.04 SOL CPMM account rent plus a 0.15 SOL creation fee, and recommends querying live rent. The runbook's ~0.4 SOL rent / ~0.7 SOL cost-floor narrative is stale and internally inconsistent with its 0.3 SOL pre-fund. Source: https://github.com/raydium-io/raydium-docs-v1/blob/main/reference/fee-comparison.mdx
