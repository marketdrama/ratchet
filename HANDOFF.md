# ratchet — current handoff

Last updated: **2026-11-09, v4 mainnet release preparation**. This replaces stale v2/v3 readiness notes;
full history is preserved in BUILD_LOG.md. Start with RELEASE_STATUS.md and DEPLOY_MAINNET.md.

## Where we are

v4 release candidate implemented. **No mainnet deployment/public trading.** Read-only RPC confirms the
mainnet target is absent and the two recorded wallets are at zero SOL. No independent audit yet.

- Program ID: `35UELzdncBr15qztq55Kct3sZvmXnn5D5e5rpGiHgMuC`.
- Mainnet ADMIN: `3vkTXSV3LG7ZrZt1SWMnEYBjNBiYAg168fbEV3Q6skTi`; signs production global initialization.
- Program keypair: `onchain/program-keypair-mainnet.json` — private, never commit/publish it.
- Binary: `onchain/target/deploy/ratchet_curve.so`; matching IDL in `lib/idl.json` and generated Vite kit.
- Release source/input/artifact hashes: `release/manifest.json`; validation: `release/*-proof.json`.
- No features for mainnet; `test-admin` and `devnet` are strictly test-only. Anchor resolution disabled;
  all client account lists explicit. Use SBF tools v1.44 and the pinned lockfile.

## Product decision from user

**Preserve floor redemption after migration.** v4 retains enough SOL to back the full outstanding mint
supply at the fixed graduation floor, including tokens initially in Raydium. Only remaining curve
reserves fund the pool/cost reserve. After migration, `redeem_floor` burns tokens and pays that fixed
floor, untaxed. Raydium swaps use Raydium fees, do not fund Ratchet taxes, and do not ratchet the floor.

Buy tax stays 1.25%, sell tax creator-selected 1.25–5% before migration; creator buy seeds floor with 25%.
Floor-capped issuance can bind during ordinary seeded trading. Costs depend on trade sizes/history:
1 SOL seed plus 5 SOL buys needs 780 SOL follow-up in the no-sells model. Do not restore the false
universal ~86 SOL promise or weaken the cap to reproduce it.

## Technical fixes delivered

Pinned external CPI + canonical Raydium accounts; removed ADMIN release, competing internal graduation
and internal swaps; retained-floor redemption; immutable metadata; shared accurate quote protection;
explicit initialization and resumable CLI; protected public wallet signing; real external pool reads;
v4 Lovable kit generation; metadata pinning helper; patched/unified dependencies; release hashes,
isolated integration and mobile browser tests. See RELEASE_STATUS.md for exact evidence/limits.

## Verification commands (workspace root)

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm test:onchain       # test-admin build, local only; initializes with public test-only fixture key
pnpm release:build      # restore default mainnet build, sync IDLs/kit, regenerate manifest
pnpm test:release       # exact default binary; local genesis config fixture
pnpm release:verify
```

Browser proof: build with mainnet env/guard=false, start on port 3310, run `pnpm test:browser`.
Install its isolated browser once with `pnpm exec puppeteer browsers install chrome` when absent.
No production wallet is involved in that test. The true Lovable app still needs separate integration.

## Next / what remains

1. Independent Solana audit of v4, including floor liabilities and migration.
2. Configure real permanent metadata hosting, accessible ADMIN signer, funded deployer and reliable RPC.
3. Publish reviewed source and obtain independent isolated build verification (Docker unavailable here).
4. Deploy exact reviewed artifact, production initialize, verify deployed bytecode and run reviewed
   mainnet smoke proof on an isolated test deployment/config; do not initialize production with test params.
5. Owner chooses/executes public multisig or immutability after testing. Never automatically run `--final`.
6. Import matching v4 kit into actual Lovable app; verify it there, then enable public mainnet guard last.

Current script: `onchain/app/launch-mainnet.mjs` (`ACTION=preflight` by default); full commands are in
DEPLOY_MAINNET.md. Old seed/lifecycle/v1 migration scripts are historical and incompatible with v4.
Durable indexer/DB is a later scaling task. `RTK.md` referenced by the user's instructions could not be found.

Every session: append work/evidence to BUILD_LOG.md and update this current handoff before ending.
