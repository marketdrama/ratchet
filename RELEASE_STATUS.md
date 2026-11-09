# v4 release candidate — 2026-11-09

Release code and local technical checks are prepared; external gates remain below. **Public mainnet
launch remains gated by independent audit, signing/funding, deployment and verification of the separately
hosted frontend.** No mainnet transaction has been sent.

## Delivered

- Pinned Raydium CPI and canonical config/pool/LP/vault/fee accounts. Removed all legacy custodial,
  internal-graduation and swap entrypoints. Enforced migration/trading phases and nonzero LP burn.
- Preserved the user-selected post-migration floor: fully back **all outstanding mint supply**, retain
  that SOL separately, freeze the floor at graduation and expose untaxed burn-and-redeem. Pool tokens
  cannot dilute the backing. Remaining reserves pay migration costs and seed locked Raydium liquidity.
- Immutable Metaplex metadata created before mint authority revocation; bounded URI and payer attribution.
  Permanent image/JSON pinning helper supplied; requires the owner's configured hosting account.
- Shared integer buy/sell quotes, the real solvency cap, safe amount bounds and nonzero min-out. Creator-
  seeded graduation economics are explicit; no claim of a universal 86-SOL graduation budget remains.
- Explicit, resumable CLI actions, full genesis checks, exact production-config validation, isolated test
  params, reviewed-bytecode checks on mainnet, spending limits and simulated create-cost verification.
- Injected Phantom/Solflare signing, public-network key-storage prohibition, mainnet guard closed by
  default, canonical Raydium reserve reads, market-swap handoff, explicit migration and floor redemption.
- Generated matching v4 Vite/Lovable kit; environment templates and current deploy runbook.
- Unified pnpm workspace/lockfile for browser and on-chain CLI; patched production dependency overrides.
  The unpatched native `bigint-buffer` addon is replaced by a small, tested pure-JS codec under
  `packages/bigint-buffer`. No advisory suppression is used. Next patched within version 15.
- Release builder pins SBF platform tools v1.44, uses locked dependencies, rejects custom feature/cfg
  inputs and checks the compiled binary for mainnet constants and absence of test constants.

## Validation

- 31 unit/property tests pass, including codec boundary vectors, SPL layouts, public wallet signing,
  capped seeded quotes, migration full-supply backing and remaining-vault solvency after redemptions.
- TypeScript and optimized Next.js 15.5.29 build pass.
- `pnpm audit --prod --audit-level moderate`: **no known vulnerabilities** across the workspace.
- Isolated mobile browser test passes wallet connect/disconnect, mainnet guard, no key storage, no
  transaction/airdrop submissions, no page errors and no horizontal overflow at 390×844.
  See `release/browser-proof.json`. RPC/wallet are mocked for that test; no real wallet was used.
- Full production-parameter on-chain lifecycle passes against locally cloned **mainnet Raydium and
  Metaplex** programs: buys/sell with engine parity, immutable metadata, unauthorized/invalid init tests
  on the test-admin build, rejected substitute accounts/legacy instructions, 0.01-SOL migration caller,
  canonical pool, zero LP supply, exact redemption payout/burn and retained floor solvency.
- The **exact default mainnet bytecode**, not only a test-admin build, is exercised on a fresh local
  validator. Production global configuration is injected at genesis because the mainnet ADMIN private
  key is not available; this does not claim to test a mainnet ADMIN signature.
  See `release/exact-bytecode-proof.json` for the artifact hash and local pool/transaction evidence.
- Release SHA-256 and source/input hashes are in `release/manifest.json`; run `pnpm release:verify`.
  Two fresh pinned Linux/amd64 builds match; this is not independent third-party build attestation.

The canonical artifact also passes Agave4.4.0 with cloned mainnet feature activation and an actual
local loader-v3 upgrade; migration244501CU/600000. See release/exact-bytecode-proof.json. Private RPC
gateway live read/write-rejection proof is in release/rpc-proof.json.

The local harness uses a public deterministic test-only key; it does not require any personal wallet.

## Binary optimization

The release profile uses opt-level`z`, thin LTO, one codegen unit and overflow checks. Mac experiments
reduced408704 to362208 bytes (11.38%); the canonical portable Linux output is365848 bytes. Two fresh
isolated builds match raw SHA25617b594f61c8d192f57336b5871efa900a01b73c19951e116e555635a135d4a57.
Rust source, IDL, instructions, features and financial checks are unchanged. Linux/Mac platform tools
produce different output, so the earlier Mac hash is historical. Current ProgramData quote1.87357004SOL
for368640-byte allocation. See release/isolated-build.json, size-optimization.json and OPERATIONS.md.

## Current external state and remaining gates

Read-only mainnet RPC check: target program `35UELz…` does not exist; ADMIN `3vkTXSV3…` and recorded
deployer `2XPJm6qc…` have 0 SOL and 0.000995 SOL respectively in the latest RPC snapshot. A private signing wallet for ADMIN and funded deployer are needed. Private QuickNode RPC is configured
with five-account batching/burst limits. Actual balances, fees and rent must be rechecked at deployment.

No independent audit exists. Docker/solana-verify are installed and two isolated builds match locally;
independent public source/build attestation has not been obtained. The real Lovable app is outside this workspace; importing the kit does not prove
its hosted wallet/trade flows. A working metadata pinning account and real pinned assets remain owner
configuration. Real mainnet migration/redemption has not been performed. The owner has chosen a temporary showcase with retained upgrade authority and future ProgramData rent
recovery. Do not finalize the program. Verify custody of the upgrade-authority signer and settle
showcase positions before a future closure; it disables redemption and does not refund coin vaults.

These are genuine external/public-launch gates, not completed items. Do not enable public trading until
MAINNET_CHECKLIST.md is satisfied. Persistent indexing is a scaling follow-up; this client polls a reliable
RPC. USD estimates use a validated public Coinbase quote with60s refresh/120s expiry and no fixed fallback;
actual mint supply is read after burns. These display values never affect financial math. Fixed supply and direct
external token burns can leave permanently locked surplus backing; there is no admin withdrawal.
