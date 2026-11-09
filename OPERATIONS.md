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

Default hosting is now **Turbo/Arweave**, with no website login or API credential. The tool generates
.metadata-upload-keypair.json (ignored by Git,0600) solely to sign Arweave data items. Do not fund it or
use a production ADMIN/deployment key. It makes no Solana transaction and cannot pay SOL. It requires
zero Turbo credit balance, reads live free limits/quota, and stops on quota exhaustion or payment demand.
No credit top-up, sponsorship or x402 payment is attempted.

Keep images at most100KiB; the service currently allows107520-byte signed items. JSON is bounded by the
same live limit. The current free lifetime quota is10MiB per signer/IP range, adequate for ten small-asset
launches if quota remains. This is provider policy and can change; the tool checks it each upload.

```sh
METADATA_RECEIPT=/absolute/receipt.json node scripts/pin-metadata.mjs /absolute/image.png Name SYMBOL
```

Optional DESCRIPTION controls the JSON description. Repeat the identical command/receipt to resume or
recheck existing uploads without reposting completed files. Receipts bind provider, content hashes,
name/symbol and description; mismatches stop. Pending deterministic signed-item IDs are saved before POST.
Both image and JSON are retrieved publicly and checked byte for byte. MIME types are set explicitly.

Live proof: release/metadata-hosting-proof.json records a public proof image and JSON, zero charges,
matching SHA256 readback and correct image/png/application/json content types. The JSON has CORS*. These
are hosting-check assets; no token was created. Latest readback reports gatewayVerified=false and
chainStable=false: public retrieval is proven, final Arweave settlement is **pending**, not claimed.
Receipt signatures/deadlines are retained. Re-run the proof command below later to refresh those flags.

```sh
METADATA_RECEIPT=release/metadata-hosting-proof.json \
DESCRIPTION='Public metadata hosting verification. No token was launched.' \
node scripts/pin-metadata.mjs test/fixtures/metadata-check.png 'Ratchet Hosting Check' RHOST
```

Permanent storage does not guarantee a particular HTTP gateway's uptime. The receipt retains ar:// IDs,
so content can be retrieved through other Arweave gateways after indexing. On-chain metadata URLs are
immutable once a coin is created; choose and verify actual coin assets before launch.

Pinata remains optional: set METADATA_PROVIDER=pinata and configure PINATA_JWT privately. That path
supports PNG/JPEG/WebP up to5MiB and verifies IPFS gateway retrieval. No Pinata login is required for the
default Turbo path. Browser access to Pinata was declined; no attempt was made to bypass that denial.

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
