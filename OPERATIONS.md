# Operations preparation

Mainnet launch and actual Lovable UI/UX are deliberately deferred. No commands in this preparation pass
send transactions to mainnet. Keep NEXT_PUBLIC_ENABLE_MAINNET_TRADING and VITE_ENABLE_MAINNET_TRADING=false.

## Private RPC

Local credentials live in .env.operations, RPC_URL, mode0600; this file is ignored by Git. In production,
set RPC_URL as a server secret. Never put the authenticated URL in a NEXT_PUBLIC_* or VITE_* variable.
The Next reference app accepts NEXT_PUBLIC_RPC_URL=/api/solana and NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta.
Its gateway is a read-only preview backend; transaction relay is part of the deferred launch/Lovable
integration. It allows supported read/simulation methods, bounds request sizes/batches, checks browser origin,
redacts provider errors and preserves u64 JSON values exactly. Transaction submission and airdrops are
rejected. Public hosting must apply request quotas at its ingress; this endpoint is not an authenticated
private service. The actual Lovable app will require a corresponding backend/proxy integration last.

The QuickNode Discover plan currently caps getMultipleAccounts at **5 keys** and can rate-limit bursts.
Preparation tools use small batches. The local CLI bridge also chunks larger requests and retries HTTP429:

```sh
node --env-file=.env.operations scripts/rpc-proxy.mjs
```

It binds only 127.0.0.1:18998, keeps the credential out of validator argv/logs, and makes no public writes.
The feature-account chunk reads are sequential snapshots; they are not an atomic multi-account read.

## Build and runtime proof

Release builds use solana-verify0.5.2, pinned official Linux/amd64 image digest recorded in
release/isolated-build.json, SBF tools v1.44, locked Cargo inputs and no test features. Only four public
contract source/manifest files enter the container. Personal keypairs and .env files are never mounted.
Mac/Linux platform-tool distributions embed different standard-library paths and produce different
binaries. The canonical release is now the repeated isolated **Linux** build, not the earlier Mac binary.
The Rust source, overflow checks and instruction/account interfaces are unchanged.

Install official solana-verify0.5.2 and Docker. On this Mac the checksum-verified tool is in ~/.local/bin;
Colima profile ratchet-build hosts Docker. It was stopped after verification to release memory; start
it with `colima start ratchet-build` before rebuilding. Build with:

```sh
DOCKER_CONFIG=$HOME/.cache/ratchet-docker DOCKER_HOST=unix://$HOME/.colima/ratchet-build/docker.sock pnpm release:build
```

Two fresh matching builds are required by release verification. Tool/image hashes are evidence of our
isolated builds; they are not third-party audit or independent public attestation. Matching-runtime proof:

```sh
VALIDATOR_BIN=/path/to/agave-4.4.0/solana-test-validator \
SOLANA_BIN=/path/to/agave-4.4.0/solana \
CLONE_RPC_URL=http://127.0.0.1:18998 CLONE_FEATURE_SET=true VERIFY_LOADER=true pnpm test:release
```

This clones mainnet features/dependencies, performs a real loader-v3 upgrade **locally**, then exercises
create/trades/migration/LP burn/redemption against production parameters. It requires no real wallet.
Public deterministic test fixture seed7 is only used on the isolated validator. Genesis globals are
injected for the exact release because the production ADMIN signing key is unavailable.

## Metadata

Uploader supports the current Pinata public-files API, validates UTF-8 limits/image signatures and
verifies both pinned image and JSON bytes by public gateway readback. It writes receipts after each
successful upload so uploaded CIDs survive a later failure. Mock tests do not claim live pinning.
No Pinata account/JWT is configured; the owner did not know of an existing credential. Configure one
when available, then pin the actual chosen assets before creating a mainnet coin:

```sh
METADATA_RECEIPT=/absolute/new-receipt.json node --env-file=.env.operations scripts/pin-metadata.mjs /absolute/image.png Name SYMBOL
```

PINATA_JWT must be a private environment variable. IPFS_GATEWAY may select another HTTPS /ipfs/ gateway.
If readback fails, keep the saved CID receipt and retry retrieval before any create; don't blindly repeat
uploads. A provider pin must remain retained/funded: an IPFS address alone does not guarantee permanence.

## Funding and future closure

Refresh current rent/balances using:

```sh
node --env-file=.env.operations --experimental-strip-types scripts/mainnet-preflight.mjs
node --env-file=.env.operations scripts/showcase-status.mjs
```

The second command only inspects the program/authority/coin supply/vaults and writes a shutdown report.
It never closes or signs. Retain upgrade authority; never use --final. A later program closure disables
floor redemption. Burned Raydium LP leaves pool-held token supply with potential floor claims; paying
only today's wallet holders does not settle those claims. All liabilities need an explicit settlement
plan before closure. ProgramData closure does not refund coin vaults, LP liquidity, or v4's global/curve
accounts. No automatic coin cleanup or authority withdrawal exists in v4. The report stays conservative
and requires owner review for any closure, even with no live coin positions.
