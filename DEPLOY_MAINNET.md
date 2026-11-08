# v4 mainnet release runbook

This supersedes the old v3.1 launch commands. v4 has a new account layout, metadata argument and retained
post-migration redemption vault. Do not upgrade old devnet state in place. Mainnet target is
`35UELzdncBr15qztq55Kct3sZvmXnn5D5e5rpGiHgMuC`, ADMIN
`3vkTXSV3LG7ZrZt1SWMnEYBjNBiYAg168fbEV3Q6skTi`.

## Release acceptance

Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm test:onchain`, then `pnpm release:build` and
`pnpm release:verify`. Preserve the manifest and exact source. The mainnet build uses **no features**;
`test-admin` and `devnet` are test-only. Default CPI constants are mainnet Raydium and mainnet Metaplex.

An independent Solana audit remains an external launch gate. Local verification does not replace it.
Builds use pinned Cargo.lock and SBF tools v1.44. A same-machine bytecode repeat check is useful but is
not independent reproducible-build attestation. For public verification, publish the reviewed source
repository and reproduce in an isolated matching toolchain (e.g. solana-verify/Docker); Docker is not
installed in this workspace environment. Do this before making authority irreversible.

## Wallet, RPC and fees

Use a reliable mainnet RPC. ADMIN signs global initialization; a deployer can be a different key and
becomes upgrade authority. Supply explicit wallet flags; do not change global CLI configuration.

```sh
solana address --keypair /secure/admin.json
solana balance --url "$RPC_URL" --keypair /secure/deployer.json
solana program show 35UELzdncBr15qztq55Kct3sZvmXnn5D5e5rpGiHgMuC --url "$RPC_URL"
```

Run `node --experimental-strip-types scripts/mainnet-preflight.mjs` to record live read-only program, balance, rent and Raydium-config checks. Measure rent on the actual built artifact, including ProgramData header and chosen allocation.
Default loader-v3 allocation may exceed bytecode size: `--max-len` makes the allocation explicit. Pool
creation fees/rent must be read from live Raydium config/RPC; old fixed ~0.4-SOL rent estimates are stale.
The contract retains 0.3 SOL for migration costs and rewards unused margin to the caller.

## Corrected early-launch costs (2026-11-09)

The previous ~4.16 SOL peak estimate double-counted the deployment buffer. In loader-v3, the buffer's
SOL is returned to the payer before ProgramData is created. For this 409600-byte allocation, current
mainnet RPC rent is **2.08247996 SOL total for Program + ProgramData**, not 4.16 SOL. Global initialization
adds **0.00116332 SOL**. Keep a margin for transaction/priority fees and retries.

Per new coin, current account rent is **0.01153160 SOL** (82-byte mint, 483-byte curve, two 165-byte ATAs,
0-byte SOL vault and 607-byte metadata). Metaplex creation charges a separate **0.01 SOL** protocol fee:
**0.02153160 SOL per coin**, plus transaction fees and any optional creator buy. The creator/payer signs
and pays these costs; the platform does not automatically subsidize creators.

With no developer buys or graduations, totals including one-time program/global rent and metadata fees:
0 coins = 2.08364328 SOL; 1 = 2.10517488; 5 = 2.19130128; 10 = 2.29895928. **2.5 SOL** is a practical
initial on-chain budget for this scope with modest fee/retry margin. Audit, RPC, hosting and multisig
setup costs are separate. Rent-exempt balances are not daily subscriptions; no tokens means no per-token
accounts to fund. Raydium costs arise only at graduation, paid from curve reserves via the 0.3 SOL reserve.

Sources: [loader implementation](https://github.com/anza-xyz/agave/blob/v2.2.1/programs/bpf_loader/src/lib.rs#L662-L688),
[current RPC rent method](https://solana.com/docs/rpc/http/getminimumbalanceforrentexemption),
[Metaplex fee schedule](https://github.com/metaplex-foundation/disclosures/blob/main/protocol-fees.md).
Refresh `release/mainnet-preflight.json` before funding or deployment; rent schedules and protocol fees can change.

## Deploy the reviewed binary

```sh
pnpm release:verify
solana program deploy onchain/target/deploy/ratchet_curve.so \
  --program-id onchain/program-keypair-mainnet.json \
  --max-len 409600 \
  --keypair /secure/deployer.json --url "$RPC_URL"
```

Keep program/deployer/admin keypairs offline and out of Git. Program keypair identifies deployment;
it does not substitute for the ADMIN signer. An unfunded or unavailable ADMIN cannot initialize.

## Preflight and initialize production once

All commands below run from the workspace root. The launcher checks genesis, executable, deployed
bytecode against the local manifest, and exact global economics. It does not auto-initialize during create.

```sh
RPC_URL="$RPC_URL" WALLET=/secure/admin.json ACTION=preflight node --experimental-strip-types onchain/app/launch-mainnet.mjs
RPC_URL="$RPC_URL" WALLET=/secure/admin.json ACTION=initialize node --experimental-strip-types onchain/app/launch-mainnet.mjs
```

`MODE=prod` is the default and is mandatory on mainnet. There is **no cheap/test global on mainnet**.
Use `CLUSTER=localnet MODE=test` on a separate validator/deployment for the small fixture. A production
coin can still be created with no dev buy; it requires only account rents/fees. It will have no initial floor.

## Create or resume a coin

Pin permanent metadata first. The helper uploads an image and JSON to your configured Pinata account:

```sh
PINATA_JWT=<your-token> node scripts/pin-metadata.mjs /absolute/image.png "Coin Name" COIN
```

The returned `ipfs://…` JSON URI is immutable on-chain. HTTPS URIs fix only the address, not the hosted content; use content-addressed storage for immutable assets. Retain/pin its image and JSON for long-term access.
Never commit the JWT. Uploads need a working account/token and were not performed in this environment.

```sh
RPC_URL="$RPC_URL" WALLET=/secure/creator.json ACTION=create \
  NAME="Coin Name" SYMBOL=COIN METADATA_URI=ipfs://<metadata-cid> \
  MINT_KEYPAIR=/secure/coin-mint.json DEV_BUY_SOL=0 MAX_SPEND_SOL=0.1 \
  node --experimental-strip-types onchain/app/launch-mainnet.mjs
```

The mint keypair is saved before sending. Reusing `MINT_KEYPAIR` detects an existing coin. All subsequent
commands take `MINT=<public-mint>`; they never silently create another coin. A creator buy places 25% into
the floor and can substantially increase the volume needed to graduate.

Auto-buy-to-complete is deliberately **test-only**, estimates all capped issuance before spending and
requires `MAX_SPEND_SOL`. Production graduation is funded by actual buyers, not by a hidden launcher loop.

## Migrate and redeem

```sh
RPC_URL="$RPC_URL" WALLET=/secure/crank.json ACTION=migrate MINT=<mint> node --experimental-strip-types onchain/app/launch-mainnet.mjs
RPC_URL="$RPC_URL" WALLET=/secure/holder.json ACTION=redeem MINT=<mint> TOKENS_BASE_UNITS=<integer> node --experimental-strip-types onchain/app/launch-mainnet.mjs
```

Migration verifies full-supply floor backing, the canonical Raydium pool and zero LP supply. A repeated
migration exits without spending. `redeem` uses exact floor output as min-out. Verify the real mainnet flow
on a dedicated reviewed test deployment/config before public release; never contaminate production global
settings to make a cheap smoke test.

## Secure upgrade authority, then enable clients

After auditing, verifying the deployed bytecode and testing the intended flow, choose an explicitly
approved upgrade policy: reviewed public multisig or immutability. Setting `--final` is irreversible and
must be a deliberate owner action; local preparation never runs it automatically.

```sh
solana program set-upgrade-authority <program> --new-upgrade-authority <MULTISIG_VAULT> \
  --skip-new-upgrade-authority-signer-check --keypair /secure/deployer.json --url "$RPC_URL"
# OR, only after the deliberate final decision:
solana program set-upgrade-authority <program> --final --keypair /secure/deployer.json --url "$RPC_URL"
```

Configure `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta`; finally set
`NEXT_PUBLIC_ENABLE_MAINNET_TRADING=true` and rebuild. Vite uses the corresponding `VITE_*` vars in the
kit's `.env.example`. Verify the separately hosted Lovable app; its guard cannot be changed from here.
Do not describe the post-migration floor as rising or Raydium swaps as paying Ratchet tax.

Closing an upgradeable program is not a safe rollback once coin vaults contain funds: it disables
redemption. Before public funds, use a new reviewed release/deployment if abandonment is necessary.
