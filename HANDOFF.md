# ratchet — current handoff

Last updated: **2026-11-09, v4 mainnet release preparation**. This replaces stale v2/v3 readiness notes;
full history is preserved in BUILD_LOG.md. Start with RELEASE_STATUS.md and DEPLOY_MAINNET.md.

## Where we are

v4 release candidate implemented. **No mainnet deployment/public trading.** Read-only RPC confirms the
mainnet target is absent and ADMIN is at 0 SOL and the recorded deployer at 0.000995 SOL in the latest snapshot. No independent audit yet.

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

## Deployment decision — temporary showcase (user, 2026-11-09)

Retain upgrade authority for the showcase. **Do not run `set-upgrade-authority --final`.** The owner
intends to close the program afterward and reclaim the ProgramData balance (~1.87357 SOL at the last
rent quote). Keep the actual upgrade-authority signer accessible; ADMIN and upgrade authority are
separate roles. Label the showcase upgradeable/temporary rather than immutable.

Shutdown requires settling showcase positions first: closure disables the program and floor redemption.
Closing returns the ProgramData deposit, not coin vault funds or burned-LP liquidity. This is a future
shutdown plan, not an instruction to close anything now; mainnet has not been deployed.

## Binary size optimization

Compiler-only change: `opt-level="z"`, `lto="thin"`, codegen units 1, overflow checks still enabled.
Mac binary408704 →362208 bytes (11.38% smaller). Canonical release now uses the portable Linux build:
365848 bytes, two fresh matching builds, SHA17b594f6… . Rust source/IDL/features unchanged. Current
ProgramData quote1.87357004SOL for368640-byte allocation. See
release/size-optimization.json and the refreshed exact-bytecode proof; use the new release manifest/hash.

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

## Current funding estimate — corrected

The earlier 4.16 SOL estimate double-counted the deployment buffer. Loader-v3 reuses it for ProgramData.
Program/global rent is ~1.87557 SOL after size optimization. Each coin adds ~0.01153 SOL rent + 0.01 SOL Metaplex fee, paid by its
creator. Program + ten self-funded launches, no dev buys/graduations: ~2.09088 SOL before network fees;
2.3 SOL is a practical starting on-chain budget. These balances are not charged daily. See
DEPLOY_MAINNET.md and the refreshed release/mainnet-preflight.json. RPC/hosting/audit costs are separate.

## Active follow-up scope (2026-11-09)

User requested completion of everything except the mainnet test launch and actual Lovable UI/UX, which
come last. Do not launch test coins or modify the hosted Lovable UI in this pass. Continue logging work.

QuickNode mainnet RPC is now configured in **.env.operations**, variable **RPC_URL**, mode **0600**;
Git ignores the file. Credentials must never appear in tracked docs, browser bundles or logs. Verified
mainnet genesis and a successful RPC request. The endpoint reports Agave **4.4.0**; matching-runtime
compatibility verification is now part of release preparation. Pinata credentials are absent; the later no-login Turbo/Arweave path below supersedes that requirement.

Delivered: live price and actual mint-supply data, private RPC gateway, verified-upload helper,
read-only shutdown checks, pinned isolated build environment and audit scope. See OPERATIONS.md. A third-party audit cannot be claimed from developer
self-review. No mainnet writes are being performed.

## Next / what remains

1. Independent Solana audit of v4, including floor liabilities and migration.
2. Select actual coin assets and verify their hosted URLs, then supply accessible ADMIN signer/funded deployer.
   No-login Turbo/Arweave hosting is live and verified (proof below). Private
   QuickNode RPC is configured; Discover plan has a five-account batch limit and burst quotas.
3. Publish reviewed source and obtain independent build attestation. Docker/solana-verify are installed;
   two fresh isolated Linux builds match locally. Canonical-runtime acceptance is in release/exact-bytecode-proof.json.
4. Deploy exact reviewed artifact, production initialize, verify deployed bytecode and run reviewed
   mainnet smoke proof on an isolated test deployment/config; do not initialize production with test params.
5. Retain and secure the upgrade-authority signer for the temporary showcase; never run `--final`.
   After the showcase, settle positions and verify closure conditions before reclaiming ProgramData rent.
6. Import matching v4 kit into actual Lovable app; verify it there, then enable public mainnet guard last.

Current script: `onchain/app/launch-mainnet.mjs` (`ACTION=preflight` by default); full commands are in
DEPLOY_MAINNET.md. Old seed/lifecycle/v1 migration scripts are historical and incompatible with v4.
Durable indexer/DB is a later scaling task. `RTK.md` referenced by the user's instructions could not be found.

Every session: append work/evidence to BUILD_LOG.md and update this current handoff before ending.

## Final preparation acceptance — 2026-11-09

Canonical365848-byte artifact: SHA25617b594f61c8d192f57336b5871efa900a01b73c19951e116e555635a135d4a57.
Two fresh isolated builds match. Exact artifact passed Agave4.4.0 + cloned mainnet features + real local
loader-v3 upgrade and full lifecycle; migration244501/600000CU.31 tests/typecheck/production build,
dependency audit, mobile guard/wallet smoke and live read-only gateway checks pass. No private RPC
credential found in source/browser assets. See OPERATIONS.md, AUDIT_SCOPE.md and release/*proof.json.

Current ProgramData quote1.87357004SOL; program/global +10 launches2.09088248SOL before dev buys/network
fees. Actual mainnet program is absent. No mainnet transactions were sent. All actual Lovable UI/UX and
mainnet test-launch work remain deliberately deferred. External audit, source publication/independent
attestation and production signing/funding remain owner/external gates. No-login Turbo/Arweave hosting
now replaces the earlier Pinata account requirement; actual coin assets are still chosen before launch.

## Live metadata hosting fixed — no login (2026-11-09)

Default uploader uses Turbo/Arweave with a dedicated unfunded local signer (.metadata-upload-keypair.json,
ignored,0600), no API key or website login. Zero-credit/free-quota guards prevent paid fallback. Live
image+JSON uploads succeeded with winc0; both public byte hashes/MIME types match, JSON has CORS*. Proof:
release/metadata-hosting-proof.json.34 tests pass. Public retrieval is proven; final Arweave settlement
flags remain false/pending at latest readback. See OPERATIONS.md for commands/limits/resume. Actual coin
assets are not selected and no Solana token was launched. Pinata is optional, not a launch requirement.

## Lovable can proceed in parallel / open source — 2026-11-09

User now approves starting Lovable UI/UX in parallel with remaining deployment/audit work. Send the root
LOVABLE_HANDOFF.md and release/ratchet-lovable-v4.zip (current21-file kit), not the archived v2/v3 brief.
Keep mainnet trading disabled. Audit/testing may require fixes; sync the kit if protocol/IDL changes.
Open-source publication is authorized under the existing MIT license. Codeberg's cryptocurrency ban
rules it out; GitHub marketdrama/ratchet is the chosen alternative. Publication outcome is logged below.

Publication completed: **https://github.com/marketdrama/ratchet** is public under MIT. Local origin points
to it and main tracks origin/main. Gitleaks7-commit scan and known-private-material scan pass. Current
Lovable guide: LOVABLE_HANDOFF.md; focused ZIP: release/ratchet-lovable-v4.zip. No credentials/keypairs
were published. Codeberg was excluded because its current terms prohibit cryptocurrency projects.
