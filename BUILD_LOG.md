# ratchet — BUILD LOG

Chronological log of work on the `ratchet` launchpad (higher.fun recreation + ratcheting-floor twist).
**Append new entries at the bottom. Never rewrite history.** Each session logs what it did here and
updates [HANDOFF.md](HANDOFF.md) with current state.

Format per entry: `## <date> — <session/agent> — <phase>` then bullets of what changed + results.

---

## 2026-11-05 — session 1 — RE of higher.fun

- Analyzed higher.fun: docs (single page), X (@Higherdotfun_, login-walled after ~5 posts), codeberg
  template `launchpad-template` (cloned to `../launchpad-template/`).
- Finding: live higher.fun = Raydium LaunchLab (bundle has `LaunchLab`, Privy `wss` relay, Backpack,
  mints end `high`); the OSS template is a verbatim **pump.fun** program reconstruction — different stacks.
- Findings written to `../HIGHERFUN_FINDINGS.md`.

## 2026-11-05 — session 1 — design the twist

- Chose twist: **ratchet curve** — a bonding-curve floor that only clicks up.
- Funding model (user chose): **hybrid = 10% of each buy principal + the trade fee → locked floor vault**.
- Mechanic: two pools (constant-product curve + floor vault). floor price = vault/circulating, ratcheted
  up only. Sells paid `max(curve, floor)`. Vault → locked LP at graduation.
- Key insight: on the bonding curve the floor rarely binds (curve geometry keeps price above it); its teeth
  are on big-dump slippage and **post-graduation** (open pool can crash below floor).

## 2026-11-05 — session 1 — off-chain engine + web (sim)

- `lib/ratchet.ts` — ratchet curve engine (bigint, framework-free). `test/ratchet.test.ts` — **8 tests pass**
  (`node --test test/ratchet.test.ts`): funding, monotonic floor, solvency, backstop ≥ curve, floor climbs,
  post-grad crash backstop, graduation.
- Next.js 15 app (`app/`, `components/`, `lib/market.ts` sim) — feed, coin page (dual-line chart + ratchet
  meter), create, docs. Ran on :3100. Verified in browser (buy grew vault + clicked floor).

## 2026-11-05 — session 1 — on-chain program (Phase 2)

- Built focused Anchor program `onchain/programs/ratchet-curve` (NOT forking the 65k-LOC pump recon).
  Program id `2KYq5Za1PctA7p6XzaSnXAjCe2ARMCE5iWtMViHDaqmn` (keypair `onchain/program-keypair.json`).
- Instructions: `initialize`, `create`, `buy`, `sell`, `graduate`, `swap` (post-grad AMM). SPL token, 6 dec.
- **Build hell (edition2024):** SBF rustc 1.79 can't build crates on `edition2024`/MSRV-1.85. Pinned the whole
  graph in `onchain/Cargo.lock`: solana-program 2.2.1, borsh 1.5.7, proc-macro-crate 3.2.0, indexmap 2.9.0,
  hashbrown 0.15.5, zeroize 1.8.1 / zeroize_derive 1.4.2, blake3 1.5.5 / constant_time_eq 0.3.1,
  unicode-segmentation 1.12.0. Also: `require!` mis-parses a bare `<` → wrap comparison in parens.
- Deployed to local validator. `onchain/app/lifecycle.mjs` passes: create → buys (floor clicks, vault = 11%)
  → sell → graduate → **post-grad crash caught by floor** (vault drains 4.16→1.93 SOL buying sellers out).
- **Deploy gotcha:** test-validator (2.2.1 genesis) gates loader-v3 → use `solana program-v4 deploy`.

## 2026-11-05 — session 1 — wire web to chain (fully on-chain)

- Added `name`/`symbol` to the on-chain `BondingCurve` account (feed needs names). Rebuilt/redeployed.
- `lib/chain.ts` — browser client: burner wallet (localStorage, airdrops on localnet), anchor Program from
  `lib/idl.json`, PDAs, create/buy/sell/swap/graduate, account reads (`listCoins`, `getCoin`). Auto-graduates
  a `complete` coin on next trade.
- `lib/coinview.ts` (display math), `lib/useChain.ts` (hooks), `components/Providers.tsx` (Buffer polyfill).
- Rewrote `app/page.tsx`, `app/coin/[mint]/page.tsx`, `app/create/page.tsx`, `components/CoinCard.tsx`,
  `TradePanel.tsx`, `RatchetMeter.tsx`, `Header.tsx` (wallet chip + Get SOL) to use the chain.
- `onchain/app/seed.mjs` seeds coins (init global 10%, 10 coins, varied buys, graduates full ones).
- **Verified in browser on localnet:** feed reads 10 coins from chain; buy 1 SOL → wallet 100→99, vault
  0.605→0.715 (exactly +11%), floor clicked up; sell → auto-graduated + pool-swapped, wallet 99→99.76.

## 2026-11-05 — session 1 — devnet deploy attempt (BLOCKED)

- `solana config set --url devnet`. Deployer `2XPJm6qcPurJJ31jHrJZTKYoBQS9HkAtt1NyMnizXDWq` balance 0.
- Program rent-exempt min ≈ 1.69 SOL (.so is 332800 bytes); need ~3 SOL with buffer/fees/seed.
- **BLOCKED:** public devnet faucet rate-limited this IP on all airdrop attempts (13 tries). Needs the user
  to fund the deployer via https://faucet.solana.com (captcha) or from a wallet. Tuned `ensureFunds` to be
  devnet-aware (requests 1 SOL, not 100; graceful on rate-limit).
- Note: devnet browser burners hit the same faucet limit — reads work for all, trading needs funded burners.

## 2026-11-06 — session 1 (cont) — economics audit + fuzz hardening (found & fixed a solvency bug)

- **Economics clarified.** Deployed uses `virtualSol = 2 SOL` (demo), so coins graduate at ~$5K mcap / ~6.5
  SOL. pump.fun/higher.fun use `virtualSol = 30 SOL` → ~$74K grad / ~85 SOL net (my token/supply numbers
  already match pump exactly). Switching is a one-param change in `lib/chain.ts` + `onchain/app/seed.mjs`
  (`initialize` arg, no program rebuild). Engine `DEFAULT_PARAMS` is already 30. Calc in scratchpad `calc.mjs`.
- **New tests:** `test/fuzz.test.ts` — seeded-PRNG fuzz: 5000 random buy/sell ops ×5 seeds, dust (1-lamport)
  buys, zero/negative/oversell rejects, u64/u128 overflow bounds, and a 12-actor interleaving model (Solana
  serializes per-account writes, so concurrency = interleaving). Asserts every step: no negative fields,
  floor monotonic, **solvency (vault ≥ circulating×floor)**, token conservation (sold+curve+burned=initial),
  k never shrinks, widths never overflow.
- **BUG FOUND by fuzz:** solvency broke — `vault 8.296 < owed 8.482 SOL`. Root cause: the floor is a
  high-water mark; if heavy *curve* selling drops spot below ~8× the floor, a non-clicking buy still adds
  tokens to `circulating` priced under the floor, so `owed = circ×floorScaled` grows faster than the 11%
  vault cut. Marginal insolvency. Unreachable in normal bonding (floor stays 3–12% of spot) but reachable by
  pre-graduation whale dumping.
- **FIX (both engine + on-chain, identical):** in `buy`, cap `out` so a buy never adds more floor-liability
  than it funds: `if floor>0 { maxOut = toFloor*SCALE/floor; out = min(out, maxOut) }`, then `require out>0`.
  I.e. you can't buy below the floor the vault must honor. Binds only in the crashed regime; zero change in
  normal bonding (verified: 8/8 unit + lifecycle unchanged). `min_tokens_out` surfaces the cap to buyers as
  Slippage. Program rebuilt + upgraded in place on localnet (same id `2KYq5Za1…`, same layout; buffer-keypair
  redeploy: `program-v4 deploy --program-id <id> --buffer <tmp-keypair>`). IDL recopied.
- **Security self-review (not an audit):** `overflow-checks = true` in `onchain/Cargo.toml` → overflow aborts
  the tx (no silent wrap); fuzz shows all values ~9 orders under u64. `has_one = mint` + ATA constraints
  prevent account substitution. mint authority revoked at create (fixed supply). Slippage guards on buy/sell/
  swap. Centralization: upgrade authority = deployer key; no pause. Still **unaudited**; the new solvency
  guard is fuzz-proven, not formally verified.
- Result: tests now **13 total** (8 unit + 5 fuzz/edge), all pass. On-chain lifecycle still OK on localnet.

## 2026-11-06 — session 1 (cont) — deeper security pass

- Manual audit of `onchain/src/lib.rs` vs the common Solana/Anchor vuln classes → wrote
  `onchain/SECURITY.md` (findings + severities). Passes: signer checks, ATA/has_one account binding,
  canonical bumps, overflow-checks=true (abort not wrap), down-truncation (no rounding theft), CPI/reentrancy
  safety, rent-safe payouts (capped at real_sol/floor_vault), fixed supply (mint authority revoked),
  slippage guards, name/symbol bounds, fuzz-proven solvency.
- **HIGH found + FIXED: `initialize` front-running.** It had no access control — on a fresh public deploy
  the first caller could set the fee/floor params (e.g. 98.99% fee) and claim admin. Added a hardcoded
  `const ADMIN` (= deployer `2XPJm6qc…`) and `require!(admin == ADMIN, Unauthorized)`. Rotate per-cluster
  before a real deploy.
- Wired the gate through: `seed.mjs` now signs `initialize` with the deployer (`~/.config/solana/id.json`);
  web `lib/chain.ts initGlobal` is now best-effort (web isn't admin; global is seeded out-of-band).
- **Proved it:** negative test — an attacker key initializing with a 98.99% fee is rejected `Unauthorized`;
  legit `seed.mjs` init by the deployer succeeds. Rebuilt, reset validator, fresh deploy, reseeded;
  feed verified at $74–77K graduated economics; 13/13 tests still pass.
- Open (ops, not code): upgrade authority = single deployer key (→ multisig / immutable on mainnet); real
  third-party audit still required. See SECURITY.md.

## 2026-11-06 — session 1 (cont) — authority hardening (runbook + loader findings)

- Investigated hardening the program upgrade authority (SECURITY.md finding #3). Wrote `onchain/DEPLOY.md`
  (deploy + authority runbook).
- **Localnet can't demo it.** We deploy with **loader-v4** (`program-v4`) because the test-validator gates
  the upgradeable BPF loader. loader-v4 authority tooling is immature in solana-cli 2.2.1: `finalize` needs
  `--next-version` to be an already loader-owned program (fresh/self address → "Next version is not owned by
  loader"); `transfer-authority` fails "not enough signers" even with the new-authority keypair funded +
  passed. Verified the deployer is the current authority (`program-v4 show` → Authority = `2XPJm6qc…`).
- **Correct path is at mainnet deploy** with the mature upgradeable loader (`solana program deploy`): verified
  `solana program set-upgrade-authority <id> --final` (immutable, recommended post-audit) and
  `--new-upgrade-authority <squads> --skip-new-upgrade-authority-signer-check` (multisig) both exist in the
  CLI. Documented both in DEPLOY.md with the loader caveat. Not exercisable on this validator (loader gated).
- Net: the exploitable code hole (init front-run) is fixed + proven; upgrade-authority hardening is an
  operational step owned by the real deploy, now fully runbook'd.

## 2026-11-06 — session 1 (cont) — switch to real 30-SOL economics

- Set `virtualSol` 2 → 30 SOL in `lib/chain.ts` PARAMS + `onchain/app/seed.mjs` initialize (pump.fun value).
- Rescaled `seed.mjs` COINS buy totals (6–125 SOL) for ~96-SOL graduation; bigger buy chunks (1–6 SOL);
  airdrop loop to 800 SOL (total ~595 SOL of seed buys). Reset validator (fresh ledger), redeployed fresh
  (`--program-keypair`), re-seeded.
- **Verified in browser:** graduated coins now show **~$74–77K mcap** (Never Down $77.5K, Ladder $76.3K,
  only up $76.2K) with **~11 SOL floor vaults** locked (was 0.7); curve coins spread $9K–$59K across 36–96%.
  Matches pump.fun / higher.fun graduation range. Program unchanged (param-only), tests still 13/13.

## 2026-11-06 — session 2 — tax model → flat 1.25%, all to floor

- **User decision:** drop the old hybrid tax (10% principal + 1% fee = 11% to floor). New model: a single
  **1.25% tax on every buy, 100% into the floor vault**, no platform/creator skim.
- **Param-only change (no Rust rebuild).** `feeBps 100→125`, `floorCutBps 1000→0` in `lib/ratchet.ts`
  DEFAULT_PARAMS, web `lib/chain.ts` PARAMS, and `onchain/app/seed.mjs initialize` args. feeBps now carries
  the whole tax; floorCut/creatorFee are unused (0). Comments/UI copy updated (docs, create, TradePanel).
- **Test:** updated the one ratio assertion in `test/ratchet.test.ts` (buyer gets ~98.75% of a floorless
  curve's tokens, was ~0.89). All **13/13 pass** (8 unit + 5 fuzz); solvency invariants unchanged.
- **Redeploy:** reset validator (fresh ledger), redeployed the **existing** `.so` (`program-v4 deploy
  --program-keypair`, bytecode identical — tax is a runtime global param), recopied IDL, reseeded.
- **Verified on-chain** (`_readchain.mjs` throwaway): vault = **1.27% of net real SOL = 1.25% of gross** on
  every coin. Graduated coins ~$76–77K mcap (UP $76.0K, NVRD $76.2K, LADR $77.3K) with **~1.1 SOL vaults**
  (~$200 floor-backed, was ~11 SOL), floor/spot **0.33%** graduated → ~1.3% for the smallest curve coin.
  Curve coins span $7K–$69K. Graduation now ~86 SOL gross (more of each buy reaches the curve).
- Wrote `FRONTEND.md` — orientation doc for a dedicated frontend session (data model, read/trade API,
  display math, page/component map, run steps, design backlog).
- **Trade-off noted:** 1.25% is a much smaller cushion than the old 11% (floor ~0.3–1% of spot vs 3–12%).
  That is the chosen design; the floor's real teeth remain the post-graduation crash backstop.

## 2026-11-06 — session 2 — hand frontend to Lovable + finish backend

- **User decision:** the frontend/UI will be built in **Lovable**, not in-session. Backend is considered
  final; Lovable owns the UI from here.
- **Paused** the in-session `ratchet frontend / design pass` session (local_2e87a704). It had already
  improved the Next.js UI (added `components/num.tsx` tiny-price formatting + `RungBadge`, reworked
  `TradePanel`/`RatchetMeter`/coin page with skeletons). Those edits remain on disk as a visual reference,
  but Lovable rebuilds in its own stack (Vite/React/Tailwind), so they won't be used directly.
- **Froze + documented the data contract** (unchanged): `CoinView` (`lib/coinview.ts`) and the `lib/chain.ts`
  read/trade signatures. Confirmed both stable after the frontend session's edits.
- **Exported `lovable-sample-data.json`** — a live snapshot of all 10 seeded coins as `CoinView[]` (spans
  fresh → graduated) so Lovable can build against typed mock data (its sandbox can't reach the chain).
- **Wrote `LOVABLE_HANDOFF.md`** — self-contained frontend brief: product, the frozen data contract + sample
  data, read/trade API (for the later wiring step), economics, a design brief, the house rules (1.25% tax
  all-to-floor; never render the floor as a market cap), and the stack reality (Lovable builds fresh in
  Vite/Tailwind; live chain wiring is a later dev step gated on the devnet deploy).
- **Devnet deploy still BLOCKED:** deployer `2XPJm6qc…` is at 0 SOL on devnet and the CLI faucet is
  rate-limited on this IP; needs the user to fund ~5 SOL via https://faucet.solana.com or a wallet. This does
  NOT block Lovable — frontend builds against the mock dataset; devnet only matters for live wiring.
- **Keep-awake:** app settings `keep_awake_while_working` + `keep_awake_on_battery` already On (idle sleep
  handled while working); lid-close/clamshell sleep is separate (needs `sudo pmset -b disablesleep 1`, user
  runs it — can't be done from here).

## 2026-11-07 — session 2 (cont) — DEVNET LIVE

- User funded the deployer with 4 devnet SOL. Deployed to devnet.
- **loader note:** devnet does NOT support loader-v4 (`program-v4 deploy` → "Unsupported program id").
  Used the standard upgradeable loader: `solana program deploy --program-id program-keypair.json
  --max-len 340000` (tight max-len so programdata rent ~1.73 SOL fits the 4-SOL budget; default 2× would
  have needed ~3.4). Program `2KYq5Za1…`, authority = deployer, on devnet.
- **Lean devnet seed** (`onchain/app/seed-devnet.mjs`, new): no airdrops (faucet dead), deployer is
  admin+payer+buyer. Init global (1.25% tax) + 4 small curve coins. Public RPC threw 429s; anchor retried
  through them. Deployer ~0.94 SOL left.
- **Verified devnet reads:** 4 coins, floor/spot ≈1.25% early, vault = 1.25% of buys, mcaps ~$5.0–5.2K
  (small buys; graduated states need ~86 SOL each, out of budget — mock data covers those).
  UP `58WDyh98…`, RCAT `CCBcnfHn…`, FLOOR `6yQHKR9d…`, ROCK `8itxb2Xm…`.
- `LOVABLE_HANDOFF.md` §8 updated with the live devnet RPC, program id, IDL path, and coin mints for wiring.
- **Budget caveat:** ~0.94 SOL left — enough for a few test trades, not a reseed. Public devnet RPC
  rate-limits; use a free Helius/QuickNode devnet RPC for the production frontend reads.

## 2026-11-07 — session 2 (cont) — Lovable wiring kit

- Built `lovable-wiring/` — a drop-in kit to connect the Lovable (Vite/React) frontend to the live devnet
  program, replacing the mock dataset with real reads (+ optional trades):
  - `ratchetClient.ts` — chain client ported from `lib/chain.ts` for Vite: `import.meta.env.VITE_RPC_URL`
    (defaults to public devnet), burner wallet (localStorage), `listCoins/getCoin/buy/sell/createCoin/
    myTokenBalance/balanceSol/ensureFunds`, exported `burnerAddress()`. Devnet-aware `ensureFunds` (asks
    for 1 SOL, graceful on rate-limit).
  - `coinview.ts` — `CoinAccount`→`CoinView` (same shape as the mock JSON) + `view()` + formatting
    (`priceParts/priceStr` dexscreener-style tiny prices, `usdCompact`, `floorPctLabel`). `CoinView` now
    also carries `floorPctOfSpot` + `vaultUsd` so the UI never has to compute (or misrender) floor strength.
  - `useRatchet.ts` — hooks `useCoins()`, `useCoin(mint)`, `useWallet()`, `useMounted()` (polling, SSR-safe).
  - `polyfill.ts` — Buffer polyfill (web3.js needs it); import once at app entry.
  - `idl.json` — copy of the program IDL. `README.md` — setup (deps, env, polyfill) + usage snippets.
- **Portability fix:** removed a TS parameter-property in `BurnerWallet` (plain field assign) — node's
  strip-only mode rejected it; Vite is fine either way, kept it portable.
- **Verified:** devnet reads already confirmed (4 coins, 1.25% tax). Node can't run the kit directly (it
  needs Vite for `import json` + `import.meta.env`), but the read path is a line-for-line port of the proven
  `lib/chain.ts`. The kit is self-contained; drop into `src/lib/` in Lovable.

## 2026-11-07 — session 2 (cont) — SELL TAX (two-sided tax to the floor)

- **User directive:** tax should be charged on sells too. Added a **sell tax** that also funds the floor
  vault (default **1.25%**, symmetric with the buy tax).
- **Design decisions:**
  - Sell tax is taken from the curve/pool proceeds → floor vault. **Floor-backstop payouts are NOT taxed**
    (that would undercut the guaranteed floor price).
  - Backstop-vs-curve decision is made on the **net-of-tax** proceeds, so a seller is never paid below the
    floor.
  - A normal (pre-graduation) curve sell now **ratchets the floor up** (vault grows + circulating shrinks).
  - Post-graduation `swap` sells grow the vault (stronger backstop) but **do not ratchet** — `floor_scaled`
    is fixed after graduation (keeps post-grad solvency trivially safe).
- **Engine** (`lib/ratchet.ts`): new `sellFeeBps` param (125); `sell()` applies tax, decides on net, runs
  `ratchet()`; removed the dead `ratchetHold()`.
- **Program** (`onchain/src/lib.rs`): new `sell_fee_bps` on `Global` + `initialize` arg + bound check;
  `sell()` and `swap()` sell branch apply the tax. **Global layout changed** (added a u16) → existing global
  accounts must be recreated (fresh validator / reseed).
- **Callers updated:** `seed.mjs`, `seed-devnet.mjs`, `lifecycle.mjs`, web `lib/chain.ts` PARAMS +
  `initGlobal` all pass the new `sell_fee_bps` (125; lifecycle 100).
- **Tests:** updated the backstop/vault tests + fuzz (seller-never-below-floor invariant). **13/13 pass.**
- **Built** (`anchor build`, .so 334,384 → 336,728 bytes — still < the 340,000 devnet max-len slot).
  Rebuilt IDL copied to `lib/idl.json` + `lovable-wiring/idl.json` (adds `sell_fee_bps`; BondingCurve layout
  unchanged, so the new IDL still reads/trades fine against the OLD devnet program).
- **Verified on localnet** (fresh validator, program-v4 redeploy): a 5-SOL buy then a quarter-sell →
  vault grew by **exactly 1.25% of the sell proceeds** (0.01726 SOL on a ~1.38 SOL gross sell), the floor
  **clicked up on the sell**, seller received the net ~1.3635 SOL. (Note: validator `requestAirdrop` RPC
  was flaky right after reset — CLI airdrop fine; verified with the CLI-funded deployer, no web3 airdrops.)
- **DEVNET NOT yet updated:** the live devnet program is the pre-sell-tax build, and the Global layout change
  means an in-place upgrade would break the existing global/coins. A clean devnet refresh needs a fresh
  program deploy (~1.7 SOL rent — over the ~0.94 SOL left) or an admin migrate/close-global instruction.
  Deferred pending (a) confirming the sell-tax rate and (b) funding. Reads/trades on the current devnet
  coins still work with the new IDL (BondingCurve unchanged); they just don't charge the sell tax yet.

## 2026-11-07 — session 2 (cont) — per-coin sell tax (creator-selectable, 1.25%–5%)

- **User directive:** make the SELL tax selectable by the coin creator (buy tax stays fixed). Min 1.25%,
  max 5%.
- **Program:** moved `sell_fee_bps` off `Global` and onto the **`BondingCurve`** account. `create` now takes
  a `sell_fee_bps` arg, clamped `require!(125 ..= 500)` (new consts `MIN/MAX_SELL_FEE_BPS`). `sell()` and
  `swap()` read the coin's own `c.sell_fee_bps`. `initialize` no longer takes a sell arg. **Both Global and
  BondingCurve layouts changed** → fresh validator / reseed (localnet; devnet still on the earlier build).
- **Callers:** `create(name, symbol, sellFeeBps)` everywhere — `seed.mjs` (coins vary 125–500 to show the
  range), `seed-devnet.mjs`, `lifecycle.mjs` (250), web `lib/chain.ts createCoin(name, symbol, sellFeeBps=125)`
  with clamp + exported `SELL_FEE_MIN/MAX_BPS`. `initialize` callers reverted to no sell arg.
- **Data surface:** `CoinAccount.sellFeeBps` (chain.ts + wiring) and `CoinView.sellTaxPct` (lib + wiring
  coinview) so the UI shows each coin's sell tax. Buy tax is still the global 1.25%.
- **Tests:** engine `CurveParams.sellFeeBps` is already per-instance → 13/13 still pass.
- **Built** (.so 336,920 B, < 340K devnet slot). IDL recopied to `lib/` + `lovable-wiring/`.
- **Verified on-chain** (fresh localnet): a coin with `sellFeeBps=125` taxed a sell **1.25%** into the vault;
  a coin with `sellFeeBps=500` taxed **5.00%**; `create` with **100** and **600** bps both **rejected
  (BadParams)**. Exactly the spec.
- `LOVABLE_HANDOFF.md` (data contract + create API + design brief) and `lovable-wiring/README.md` updated
  with the slider (1.25%–5%) and `sellTaxPct`.

## 2026-11-08 — session 2 (cont) — pre-design completeness audit

- **User directive:** no more devnet SOL; make sure all code is in place + 100% done so it can go to design (Lovable).
- **Full consistency sweep — all green:**
  - Program: `sell_fee_bps` on `BondingCurve`, `create` clamp `require!(125..=500)`, `sell()`+`swap()` read per-coin `c.sell_fee_bps`. `.so` built (336,920 B).
  - `lib/`: `chain.ts` (`createCoin(name,symbol,sellFeeBps)`, clamp, `SELL_FEE_MIN/MAX_BPS`, `CoinAccount.sellFeeBps`), `coinview.ts` (`CoinView.sellTaxPct`), `ratchet.ts` (`sellFeeBps`).
  - `lovable-wiring/`: `ratchetClient.ts` + `coinview.ts` match `lib/` 1:1.
  - IDL identical across `onchain/target/idl`, `lib/`, `lovable-wiring/` (same md5), all carry `sell_fee_bps`.
  - Tests **13/13 pass**.
- **Gap found + fixed:** `lovable-sample-data.json` was missing the `sellTaxPct` field (design builds against this file). Added `sellTaxPct` to all 10 coins, varied **1.25–5** to show the slider range; JSON validates, all in range.
- **Re-zipped** source + wiring bundles for the design handoff.
- **Status:** backend + all frontend-facing data surfaces 100% ready for Lovable. Devnet still runs the pre-sell-tax build (deferred — no SOL; does not block design, which works off mock data + the contract).

## 2026-11-08 — session 2 (cont) — dev-buy seeds the floor (25%)

- **User directive:** "25% of dev buy starts the floor" — a coin should open with a real floor, funded by the creator's own launch buy.
- **Mechanic:** `create` gains an optional `dev_buy` (lamports) arg. If `dev_buy > 0`: **25%** (`DEV_FLOOR_CUT_BPS = 2500`) goes straight into the floor vault, the remaining **75%** buys tokens on the curve for the dev; then `ratchet()` runs so the coin opens with a **non-zero, ratcheting floor**. `dev_buy == 0` keeps the old floorless open. Dev tokens land in a new `dev_ata` (ATA of payer). Buy tax (1.25%) is NOT applied to the dev buy — the 25% floor seed replaces it.
- **Program:** `create(name, symbol, sell_fee_bps, dev_buy)`; new `dev_ata` account (`init_if_needed`, authority = payer); `CreateEvent.dev_buy` added.
- **Engine:** `RatchetCurve.devBuy(solIn)` mirrors it (exported `DEV_FLOOR_CUT_BPS = 2500n`).
- **Callers:** `lib/chain.ts createCoin(name, symbol, sellFeeBps, devBuySol=0)` + `devAta`; same in `lovable-wiring/ratchetClient.ts`. `seed.mjs` / `seed-devnet.mjs` tuples gained a devBuy field (coins launch pre-seeded); `lifecycle.mjs` uses a 2 SOL dev buy.
- **Tests:** +3 engine tests (seed = 25%, immediate seller protected at the seeded floor, dev_buy=0 floorless). **16/16 pass**.
- **Built** (.so **349,656 B** — now > 340K, so the next **devnet** deploy needs `--max-len ~360000`, up from 340000). IDL recopied to `lib/` + `lovable-wiring/` (now carry `dev_buy`).
- **Verified on-chain** (fresh localnet, `onchain/app/verify-devbuy.mjs`): dev buy 4 SOL → vault **1.0 SOL (25%)**, floor opens non-zero, dev holds ~97.5M tokens; dev buy **0** → vault 0 / floor 0 / no tokens; dev buy 10 SOL → vault **2.5 SOL**. ALL PASS.

## 2026-11-08 — session 2 (cont) — DEVNET DEPLOY of the updated program + live verify

- **Funded** deployer to ~2.94 devnet SOL. **Extended** program data 340K→360K (~0.10 SOL), then
  **in-place upgraded** the program (same id `2KYq5Za1…`, upgrade slot 520105786, buffer refunded).
- **Seeded** 4 fresh coins via `seed-devnet.mjs` (now with dev buys): UP `8e6FneNW…` (sellFee 125),
  RCAT `GVAdGSXS…` (500), FLOOR `HyN7gAC9…` (300), ROCK `F2nyWeU4…` (250). Deployer ~0.96 SOL left.
- **Verified on-chain (devnet):** all 4 open with a seeded floor (dev-buy 25%→vault confirmed, e.g. UP
  0.2 SOL buy → 0.05 SOL seed). A live **sell on UP** grew the vault 0.0575→0.0582 SOL (sell tax routed
  in) and **clicked the floor up**. Sell tax + dev-buy seed both proven live.
- **Bug found + fixed (legacy coins):** the in-place upgrade left the 4 old pre-sell-tax curves on devnet.
  Their shorter layout mis-decodes under the new IDL (garbage sellFeeBps 18k–58k, vaults in billions).
  `listCoins`/`getCoin` in all three clients (`lib/chain.ts`, `lovable-wiring/ratchetClient.ts`, the
  wired Lovable project) now **filter to sellFeeBps ∈ [125,500]**, so legacy/garbage curves never show.
  Confirmed: 8 on-chain accounts → 4 live after filter.
- **Audit note:** `overflow-checks = true` in the release profile — every floor-vault / reserve
  subtraction panics (reverts) on underflow rather than wrapping, so the post-graduation floor-drain
  edge fails safe (no fund-loss path; worst case a sell reverts).
- Updated the wired deliverable (`ratchet-frontend-wired.zip`): `PUBLISH-STATUS.md` + `WIRING.md` now
  record the devnet deploy, the live coin addresses, and the legacy filter.

## 2026-11-08 — session 2 (cont) — Raydium CPMM migration (locked liquidity), v1

- **Chose Raydium CPMM** over Meteora (easiest real path; Meteora's metRUSH code is a client over Meteora's
  own DBC program — opposite architecture, not reusable). Rationale in `RAYDIUM_MIGRATION.md`.
- **On-chain `release_for_migration` (built + localnet-verified):** ADMIN-gated, once per completed curve;
  sends remaining tokens + reserves + floor vault to the migration authority, marks graduated, zeroes the
  curve. Test: completed curve → authority got all 999e12 tokens + 0.5 SOL reserves + 0.125 SOL vault,
  curve zeroed, 2nd call rejected. New accounts `ReleaseForMigration`, event `MigrateReleaseEvent`.
- **Off-chain `onchain/app/migrate-raydium.mjs`:** creates a real Raydium CPMM pool (coin/wSOL) from the
  released funds via `@raydium-io/raydium-sdk-v2` and **burns the LP** (permanent locked liquidity,
  Jupiter-tradeable). Written, NOT yet end-to-end tested (needs a completed coin + ~0.3 SOL).
- **Trust model (v1):** the ADMIN authority briefly custodies funds between the two steps. Standard early
  pattern; burned LP makes the resulting pool trustless. **v2 (mainnet):** single on-chain CPI into Raydium
  `initialize` (invoke_signed, no crate dep) — trustless + atomic; audit-critical. Interface captured.
- **Build:** `.so` now **369,864 B** — exceeds the devnet 360K slot. Devnet upgrade for this instruction is
  blocked on ~2 more devnet SOL (another `program extend` + ~1.9 SOL transient buffer; deployer has ~0.96).
  Localnet verified. IDL recopied (`release_for_migration` present).
- Updated `SELF_AUDIT.md` (#3 now has a path), `RAYDIUM_MIGRATION.md`, `METEORA_MIGRATION.md` (pointer).

## 2026-11-08 — session 2 (cont) — mainnet-prep: client slippage + mainnet checklist

- **Client slippage (audit #4 fixed):** `buy`/`sell` in `lib/chain.ts` and the wired Lovable app now quote
  expected output from on-chain state (constant-product + floor math, bigint) and send a real `min_out`
  = expected*(1 - slippageBps/BPS), default **1%**, param-configurable. Was `0` (no MEV/sandwich
  protection). Syntax-checked.
- **`MAINNET_CHECKLIST.md`:** the exact gate to live — (1) third-party audit, (2) trustless v2 Raydium CPI
  migration, (3) upgrade authority → Squads multisig or `--final`, (4) mainnet config (CPMM
  `CPMMoo8…`, fee rcvr `DNXgeM9…`, paid RPC). The `network.ts` mainnet guard flip is the deliberate last step.
- **Held the line:** did not enable mainnet or deploy to mainnet. Real money waits on 1–4 + the audit.

## 2026-11-08 — session 2 (cont) — trustless v2 Raydium CPI migration + open-source setup

- **`migrate_to_raydium` (trustless v2):** one atomic, permissionless instruction — CPIs into Raydium CPMM
  `initialize` via `invoke`, pools the coin remainder + (reserves + floor vault wrapped to wSOL), then
  **burns the LP** → permanent locked liquidity. `creator` is any system-owned crank (signs the CPI,
  reimbursed from `MIGRATE_SOL_RESERVE` ≈ 0.3 SOL); because it's atomic the caller can't extract funds.
  Program computes deposit amounts + token_0/token_1 ordering itself; forwards the 20 Raydium accounts.
  **Compiled + logic-complete; NOT tested against live Raydium** (needs devnet + ~0.3 SOL) — prime audit
  target (account order, discriminator [175,175,109,31,13,152,155,237], wSOL amounts, LP burn).
- New: consts `MIGRATE_SOL_RESERVE`, `RAYDIUM_INITIALIZE_IX`, `WSOL_MINT`; `MigrateToRaydium` accounts
  struct; `MigrateRaydiumEvent`. Imports: `invoke`, `Instruction`, `AccountMeta`, `sync_native`.
- **Build:** `.so` 415,272 B. IDL recopied to `lib/`, `lovable-wiring/`, wired app. **16/16 engine tests.**
- **Open source:** added `LICENSE` (MIT, "ratchet contributors") + a real `README.md` (trustless/immutable
  public-good framing, how it works, build/test, migration, honest status). `MAINNET_CHECKLIST.md` now
  marks v2 built + adds a **verifiable-build + immutable-deploy** section (`solana-verify`, `--final`).
  `SELF_AUDIT.md` #3 updated.
- Devnet upgrade for this binary needs more SOL (415 KB > the 360K slot → bigger extend + buffer).

## 2026-11-08 — session 2 (cont) — v2 Raydium migration: test harness + STUCK on lamport bug

- **Test strategy (no devnet SOL needed):** clone Raydium CPMM into a local validator
  (`--clone-upgradeable-program DRaycpLY… --clone 5MxLgy9o… --clone 3oE58BKV…`), deploy ratchet with
  small graduation params so a coin completes for ~0.5 SOL, run `migrate_to_raydium` against the cloned
  Raydium. Harness: `onchain/app/migrate-test-localnet.mjs`; PDA deriver: `onchain/app/raydium-pda-derive.mjs`.
- **Found: the amm_config constant from web search (`D4FPEruK…`) is WRONG** (system-owned/empty). Correct
  devnet amm_config idx 0 = `5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy` (PDA ["amm_config", u16_be(0)],
  owner CPMM, len 236). Fixed in `RAYDIUM_MIGRATION.md`. Raydium PDA seeds documented there too.
- **The coin completes + migration drives deep** (Anchor inits creator ATAs, step 1 transfers curve tokens
  to creator) then FAILS: `sum of account balances before and after instruction do not match`, at the
  `sync_native` CPI boundary, BEFORE Raydium `initialize` runs.
- **Fix attempted (did NOT resolve):** replaced `system_program::transfer(creator→wsol)` with direct PDA
  lamport debits (`curve -= moved; creator_wsol += wsol_liquidity; creator += MIGRATE_SOL_RESERVE`), which
  balances arithmetically (`moved = wsol_liquidity + reserve`). Error persists → it's a lamport-accounting
  issue in steps 2–3 of `migrate_to_raydium`. **Next:** `msg!`-instrument and check the curve's ACTUAL
  lamports vs `real_sol + floor_vault` FIRST. See HANDOFF "ACTIVE TASK" + RAYDIUM_MIGRATION "CURRENT DEBUG STATE".
- Program otherwise unchanged + compiles; nothing deployed to devnet this round (localnet only). Validator
  stopped (ephemeral). No regression to the shipped features.

---

## 2026-11-08 — session 3 (Opus) — trustless v2 Raydium CPMM migration: FIXED, localnet-verified

**Result: `migrate_to_raydium` WORKS on localnet against cloned Raydium CPMM — pool created + LP burned +
coin graduated.** The `sum of account balances before and after instruction do not match` bug is solved.

- **Reproduced** on a localnet with Raydium CPMM cloned from devnet (clone cmd in RAYDIUM_MIGRATION.md).
  Small-param global (virtualSol 2 SOL), a coin completes for ~0.5 SOL, then `migrate_to_raydium` runs.
- **Diagnosed with `msg!` instrumentation (the suspected cause was WRONG).** Printed the curve's actual
  lamports vs `real_sol + floor_vault`: `curve_lamports=502,610,000 = moved(500,000,000) + rent(2,610,000)`,
  i.e. the debit amount was EXACT and the three-account move (`curve -=moved; creator_wsol +=wsol_liq;
  creator +=reserve`) conserved lamports perfectly (−500M +200M +300M = 0). So suspect (a) (debit off) was
  false — the arithmetic was never the problem.
- **Real root cause (confirmed with checkpoint logs):** the Solana runtime only accepts a *direct* lamport
  write (`try_borrow_mut_lamports`) to an account at a CPI boundary when the **offsetting** direct write is on
  another account **in that same CPI's account set**. `sync_native` is passed only `creator_wsol`, so raw-
  crediting it while the offsetting debit sits on `bonding_curve` (not in the CPI) trips the verifier —
  regardless of global balance. Same reason the earlier `creator`-credit + system-transfer attempt failed at
  the transfer CPI. `release_for_migration` raw-writes safely ONLY because no CPI follows it; `buy` is fine
  because it funds via a `system_program::transfer` CPI, not a raw write. This means the pooled SOL can NEVER
  be moved out of the program-owned `bonding_curve` PDA by a raw write that precedes a CPI.
- **The fix (program, `migrate_to_raydium`):** the permissionless crank (`creator`) now **fronts the pooled
  wSOL from its own balance** via `system_program::transfer(creator → creator_wsol, wsol_liquidity)` (a
  sanctioned CPI move), then `sync_native`, then the Raydium `initialize` CPI, then the LP burn — and only
  AFTER every CPI does it drain the curve's reserves+vault to the crank with raw writes
  (`curve -= moved; creator += moved`), the exact no-CPI-after shape proven safe in `release_for_migration`.
  The crank is made whole (reimbursed `wsol_liquidity` + Raydium fee/rents) and keeps the `MIGRATE_SOL_RESERVE`
  (0.3 SOL) margin as its reward; the whole tx is atomic so the crank can never extract funds. Lamports
  conserved end-to-end.
- **Test harness fix:** `migrate_to_raydium` + Raydium `initialize` (~124k CU) + ATA inits + LP burn exceed
  the 200k default compute limit. Added `ComputeBudgetProgram.setComputeUnitLimit({units: 600_000})` as a
  pre-instruction in `onchain/app/migrate-test-localnet.mjs`. (Any real client must do the same.)
- **Verified (localnet):** `graduated: true`; pool exists, owner = Raydium CPMM `DRaycpLY…`; pool vaults hold
  0.2 wSOL + 999,000,000 coin; **LP supply after burn = 0** (liquidity permanently locked). Output:
  `MIGRATE_TO_RAYDIUM: POOL CREATED ✓`.
- **Capital note for mainnet:** the crank must hold ~(pooled SOL + ~0.3) at call time and is reimbursed in the
  same tx. At production economics (virtualSol 30 → ~85 SOL pooled) that's ~85 SOL of working capital per
  crank — fine for an MEV-style bot, but a barrier for a casual crank. A fully capital-free v3 would store the
  curve SOL in a separate **system-owned** vault PDA so the program can `invoke_signed` a system transfer
  straight from it (no fronting) — noted for the audit/mainnet pass, not needed for correctness.
- **Build/deploy gotcha found:** `solana program-v4 deploy --program-id …` redeploy is unreliable here
  (silent no-op with `--buffer`; "Buffer account not created yet" without one when the new `.so` is larger);
  `program-v4 dump` as used also failed silently. Reliable localnet path: `--reset` the validator and deploy
  once with `--program-keypair`. Verify by TEST BEHAVIOR, not by hashing a dump.
- **Stopped here per instructions** — no devnet/mainnet deploy, `network.ts` mainnet guard untouched. Nothing
  else changed (sell tax, dev-buy seed, slippage, v1 migration, legacy filter, open-source all intact).

## 2026-11-08 — session 3 (cont.) — devnet program upgraded with the migrate fix

- User funded deployer `2XPJm6qc…` to ~5 SOL. Upgraded the live devnet program `2KYq5Za1…` (loader-v3,
  upgradeable, authority = deployer) with the fixed build: `solana program extend 2KYq5Za1… 64136` (new .so
  415,944 B > old 360,000 slot → data length now 424,136), then `solana program deploy --program-id` (buffer
  reclaimed). New deploy slot 520135724. Balance after: ~4.69 SOL. The migrate fix is now ON DEVNET.
- **Devnet graduation test is BLOCKED by economics, not code:** the live devnet `global` runs production
  params (virtualSol 30), so completing any coin to graduation costs ~86 SOL. The 8 on-chain coins are all
  far from complete (max realSol ~0.69; 4 are the legacy mis-decoded pre-sell-tax curves). The migrate
  instruction only runs its (now-fixed) lamport/CPI path once a curve is `complete`, so a meaningful devnet
  run needs either ~86 SOL (complete a coin on the live 30-SOL global) or a separate small-param test program
  deployed to devnet (~1.5 SOL more: fresh-program buffer + reclaimable rent). Pending user's choice.
- Note: the localnet pass already exercised the migrate CPI against the EXACT cloned devnet Raydium CPMM
  program + real amm_config, so the CPI accounts/discriminator/PDA seeds/LP-burn are validated against real
  Raydium bytecode; the open gap a devnet run would close is real-network/rent + the shipped global.

## 2026-11-08 — session 3 (cont.) — DEVNET migrate verified against REAL Raydium CPMM ✓

- Chose the small-param-test-program route (the live devnet global is virtualSol 30 → ~86 SOL to graduate).
  User funded deployer to ~5.7 SOL.
- **Deployed a throwaway test program** to devnet with small params: swapped `declare_id!` to a fresh id
  `kgbarrBDHjBga26hpHaxvUeynxS9dApytHXa6xTjcqF` (Anchor 0.31 enforces declare_id == executing id), rebuilt,
  `solana program deploy --program-id /tmp/ratchet-test-prog.json --max-len 416000` (loader-v3; fresh-deploy
  flag is `--program-id <keypair>`, NOT `--program-keypair` which is v4). Cost ~2.1 SOL (reclaimed on close).
- **Ran `onchain/app/migrate-test-devnet.mjs`** (devnet RPC, small-param global, 600k-CU budget ix): init
  global → create coin → buy to complete → `migrate_to_raydium`. **Result vs REAL devnet Raydium CPMM
  (`DRaycpLY…`, not a clone):** `graduated: true`; pool `CenXsd4tJ6B8hZdync8Fc9U6ssTzhGTaxQHoTYwbc43r` exists,
  owner = Raydium CPMM; vaults hold 0.2 wSOL + 999,000,000 coin; **LP supply after burn = 0** (liquidity
  permanently locked). migrate tx `4mXMFLDJaEzXhezknrwjL7KH9eia6mNSGnXfcVUuTPzpQrTG3rKwBmQTCRkVZzKj5PJxZPQaVswsNAWyyHN7o6ou`.
  `MIGRATE_TO_RAYDIUM: POOL CREATED ✓`.
- **Cleanup:** `solana program close kgbarr…` reclaimed 2.114 SOL; reverted `declare_id!` back to
  `2KYq5Za1…`, rebuilt, restored `lib/idl.json`. The REAL devnet program `2KYq5Za1…` is untouched + still
  carries the migrate fix (slot 520135724, data 424136, authority `2XPJm6qc…`). Deployer ~5.29 SOL left.
- **Status: migrate_to_raydium is now verified on BOTH localnet (cloned Raydium) AND real devnet Raydium.**
  Remaining before mainnet (unchanged): trustless-at-scale note (crank fronts pooled SOL; a v3 system-owned
  vault PDA removes the fronting), third-party audit, verifiable+immutable mainnet deploy, mainnet config,
  flip the `network.ts` guard — per MAINNET_CHECKLIST.md. Nothing mainnet touched this session.

## 2026-11-08 — session 4 (Opus) — MAINNET path writeup + v3 system-vault migration spec

No code changed. Deliverables: the mainnet runbook and a full spec + decision for a capital-free "v3"
migration. Everything stays gated per MAINNET_CHECKLIST — no mainnet deploy, no `network.ts` guard flip.

- **`MAINNET_PATH.md` (new).** The *how + order* companion to MAINNET_CHECKLIST's *what*: a 6-step sequence
  from today's devnet-verified state to a live, verifiable, immutable mainnet deploy — trust-model decision
  (step 0) → audit (1) → fresh-id verifiable build with rotated `ADMIN`/`declare_id!` (2) → devnet→mainnet
  id swap table (3: Raydium CPMM `CPMMoo8L…`, create-pool fee `DNXgeM9E…`, derive+verify mainnet AmmConfig,
  paid RPC) → deploy + `solana-verify` (4) → secure upgrade authority, immutable-vs-Squads (5) → the one-line
  guard flip LAST (6). Plus a pre-flip tiny-param mainnet dry-run and a cost summary. Notes the guard lives in
  the Lovable app's `src/lib/ratchet/network.ts` (not this repo); id swaps are client-side (migrate accounts
  are client-forwarded `UncheckedAccount`s), except rotating `ADMIN` + optionally pinning `cp_swap_program`
  on-chain as audit hardening.

- **`RAYDIUM_MIGRATION.md` §"v3 — system-owned SOL vault" (new).** Full spec for the capital-free design.
  Root cause restated: curve SOL sits on the program-owned `bonding_curve` PDA, which (a) can't be a
  `system_program::transfer` source (System needs a 0-data, system-owned source) and (b) can only be
  raw-written when no CPI follows — hence v2's ~85 SOL fronting. v3 moves SOL to a **separate system-owned
  PDA `[b"sol", mint]`** (data stays on `[b"curve"]`); the program then `invoke_signed`s a system transfer
  straight out of it — a real CPI, so the balance verifier is satisfied and no fronting is needed. Crank
  working capital drops ~85 SOL → ~0.3 SOL, still atomic/trustless. Spec covers: the new migrate flow,
  auditor-facing correctness notes (0-data source, auto-create on first transfer-in, rent-floor on drains:
  keep ≥ rent-min or drain to exactly 0), the blast radius (buy/sell/swap/create/release all re-routed
  through the vault — sell/swap payouts gain a cheap CPI but shed the raw-write subtlety), the
  **breaking-layout → fresh-program-id** implication (which mainnet needs anyway), and a localnet test plan
  (re-verify full lifecycle; key new assertion: crank starts < 1 SOL and migrate still lands).

- **Decision (logged in both docs): SPEC now (done) + BUILD to localnet-proven before the audit, but do NOT
  touch the live devnet artifact.** Keep v2 (fronting) as the devnet-verified migrate; build v3 on a separate
  localnet branch / behind the fresh mainnet id, because the rewrite touches the currently-green + devnet-
  verified buy/sell/swap. v3 goes live only as the audited mainnet binary. Cheapest alternative if deferring:
  ship v2 + a platform keeper holding the float (trustless funds, platform-run cranking) and land v3 in a
  later audited upgrade. Still gated behind audit + fresh mainnet deploy either way.

**Open question for the user:** actually build v3 to localnet-proven this session (a sizable program rewrite +
full re-verify, risking the green buy/sell/swap on a throwaway branch), or leave it spec'd and gate the build
into the audit scope? Recommendation above is build-to-localnet; not started pending the call.

## 2026-11-08 — session 4 (cont, Opus) — v3 system-vault migration BUILT + localnet-verified (capital-free)

Built the v3 design from the spec above and verified it on localnet against cloned devnet Raydium CPMM.
**Devnet/mainnet untouched** — the live devnet program `2KYq5Za1…` still runs v2 (not redeployed); no mainnet
deploy, no `network.ts` guard flip. v3 is a fresh program id on localnet only.

**What changed in the program (`onchain/programs/ratchet-curve/src/lib.rs`, now the v3 build):**
- New per-coin **system-owned SOL vault PDA** `[b"sol", mint]` (owner = System program, 0 data). ALL of a
  coin's lamports (reserves + floor) live here; the program-owned `bonding_curve` PDA now holds only its own
  data rent — never user SOL.
- `create` seeds the vault rent-exempt (`Rent::minimum_balance(0)`) so it exists for later trades; dev_buy
  SOL goes into the vault.
- `buy` / `swap`-buy route `sol_in` → vault. `sell` / `swap`-sell payouts and `release_for_migration` and
  `migrate_to_raydium` pay OUT via a new `vault_pay()` helper = `invoke_signed(system transfer, sol_vault →
  dest, &[b"sol", mint, bump])`. **Every lamport move is now a CPI — zero raw `try_borrow_mut_lamports`
  writes remain.** That deletes the whole class of "raw-write-before-CPI" verifier bugs v2 had to dance around.
- `migrate_to_raydium`: step 2 funds the wSOL side DIRECTLY from the vault (no crank fronting); step 6
  reimburses the crank `MIGRATE_SOL_RESERVE` from the vault. Rent-min seed stays behind.
- Added `sol_vault: SystemAccount` (seeds `[b"sol", mint]`, mut, not init) to `Create`/`Trade`/
  `ReleaseForMigration`/`MigrateToRaydium`. `declare_id!` + Anchor.toml → fresh id
  `H1xojHARw1twf2GvVUTbVfHFmuh1rixTYkJAReAdDrw6`.

**Build/deploy:** `anchor build` clean (one deprecation warning only). Localnet validator `--reset` with
Raydium CPMM `DRaycpLY…` + AmmConfig `5MxLgy9o…` + fee rcvr `3oE58BKV…` cloned from devnet; deployed with
`solana program-v4 deploy --program-keypair program-keypair-v3.json`.

**Verified by behavior (not a dump):**
- `app/migrate-test-localnet-v3.mjs` — create (dev_buy 0.5) → 20× buy → complete → migrate run by a **FRESH
  crank funded with only 1 SOL** against a 0.5-SOL pool deposit. Result: `graduated: true`, real Raydium pool
  created (owner `DRaycpLY…`), pool vaults = 0.2 wSOL + 999M coin, **LP supply after burn = 0** (locked).
  `bonding_curve` PDA held 0.00261 SOL (its own rent, no user SOL); `sol_vault` drained 0.50089 → 0.00089
  (seed stays). **Crank 1.0 → 1.104 SOL, net +0.104 — it never fronted the pool.** migrate tx
  `2cadgNmhcDka7uocqErh5xNDkDCQCVfCaDPYk8QwfVpWK7xxfAs2NkfCk9dSp977CvoXovfdr1kRCmNnCWX4bPgP`.
  This is the whole v3 win proven: crank working capital ~85 SOL → ~1 SOL (gas + Raydium cost), vs the pool
  deposit it can't possibly have fronted.
- `app/sell-smoke-v3.mjs` — buy 1 SOL → `sol_vault` = 1.00089 (1 + seed), floorVault 0.0125 (1.25% buy tax);
  sell half → user **+0.00624 SOL paid out of the vault** (vault 1.00089 → 0.99464), floor clicked up via the
  sell tax. Confirms the `invoke_signed` payout path (shared by sell/swap/release) works.

**Preserved / recovery:** v2 source → `programs/ratchet-curve/src/lib.rs.v2-fronting.bak`; v2 devnet keypair →
`program-keypair-v2-devnet.json.bak`. To rebuild the devnet v2 artifact: restore both + revert declare_id/
Anchor.toml to `2KYq5Za1…`. v2 (fronting) remains the devnet-verified live migrate; v3 is the mainnet-form
candidate (fresh id required anyway) and is now localnet-proven BEFORE the audit, as recommended.

**Follow-ups (not blocking):** `lifecycle.mjs`, `seed.mjs`, `migrate-test-devnet.mjs`, and the web
`lib/chain.ts` still build the v2 account layout (no `sol_vault`); they need the vault account added before
they run against a v3 deployment. v3 stays gated behind the audit + fresh mainnet deploy per
MAINNET_CHECKLIST / MAINNET_PATH — still no mainnet, no guard flip.

## 2026-11-08 — session 4 (cont, Opus) — wire all clients to the v3 vault + full-lifecycle verify

Added the `sol_vault` PDA (`[b"sol", mint]`, camelCase `solVault` in JS/TS) to every create/buy/sell/swap
account object across the clients, and copied the v3 IDL into the web app. Then re-ran the full on-chain
lifecycle on v3 to confirm the wiring.

- **Wired:** `onchain/app/lifecycle.mjs`, `seed.mjs`, `seed-devnet.mjs`, `migrate-test-devnet.mjs`,
  `verify-devbuy.mjs` (create + trade account objs), and the web client `lib/chain.ts` (new `solVaultPda()`
  helper; `solVault` added to `tradeAccounts()` + `createCoin`). `lib/idl.json` ← v3 IDL (address now
  `H1xojHAR…`). `migrate-raydium.mjs` needed no change (off-chain Raydium-SDK step, no program ix).
- **NOT touched:** `lovable-wiring/` — that is the live **devnet v2** drop-in kit; leaving it on v2 so the
  devnet demo keeps working. The in-repo Next.js client (`lib/chain.ts` + `lib/idl.json`) is now a **v3**
  client (program `H1xojHAR…`), so it talks to a v3 deployment (localnet today; devnet/mainnet gated). The
  live devnet v2 demo is served by `lovable-wiring/` + the Lovable app, unaffected.
- **Verified — full lifecycle on v3** (`app/lifecycle.mjs`, fresh validator, v3 deployed): create (2-SOL dev
  buy seeds the floor) → 4× buy (vault + floor climb) → sell 20% (**+1.9427 SOL paid out of the vault**) →
  buy out → graduate (pool opened 10.6 SOL + 100M tok, 4.45 SOL floor locked) → swap buys → crash: 18 dumps,
  **floor backstop paid ON-CHAIN** out of the system vault every time, floor never dropped. `ON-CHAIN
  LIFECYCLE OK ✓`. This exercises create/buy/sell/graduate/swap (both sides incl. the floor backstop) through
  the wired `solVault` accounts.
- **Note:** `lifecycle.mjs` can't self-init global (the ADMIN gate added in session 1 rejects its random
  payer) — pre-init global once as the admin (`~/.config/solana/id.json` = `2XPJm6qc…`) then run it. Added
  `app/init-global-v3.mjs` as that one-shot admin init helper for v3 localnet.

v3 remains gated behind audit + fresh mainnet deploy per MAINNET_CHECKLIST / MAINNET_PATH — still no mainnet,
no `network.ts` guard flip. Devnet program `2KYq5Za1…` is still v2 (not redeployed).

## 2026-11-08 — session 4 (cont, Opus) — MAINNET v3 artifact STAGED (not deployed)

User will deploy + launch manually with their own wallet. Assistant staged the full mainnet build but did
NOT run any mainnet transaction. The program is UNAUDITED and the v3 build has never run against real
Raydium — flagged throughout.

- **Rotated for mainnet:** `declare_id!` → fresh `35UELzdncBr15qztq55Kct3sZvmXnn5D5e5rpGiHgMuC`
  (keypair `onchain/program-keypair-mainnet.json`), `ADMIN` const → the user's wallet
  `3vkTXSV3LG7ZrZt1SWMnEYBjNBiYAg168fbEV3Q6skTi` (validated: valid ed25519, on-curve). Anchor.toml updated.
  `anchor build` clean; IDL address matches. Localnet v3 preserved → `lib.rs.v3-localnet.bak`.
- **Mainnet Raydium constants verified live (mainnet-beta RPC):** CPMM `CPMMoo8L…`; AmmConfig idx0
  `D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2` (owner=CPMM, len 236 ✓ — note this is the CORRECT mainnet
  config even though the same address was the WRONG one on devnet); authority `GpMZbSM2…`; fee receiver
  `DNXgeM9E…` (wSOL token acct ✓).
- **Deliverables for the manual launch:** `DEPLOY_MAINNET.md` (root) — staged artifact table, verified
  constants, verifiable-build step, deploy command (`solana program deploy --program-id
  program-keypair-mainnet.json`), IDL copy, global init, secure-upgrade-authority, cost summary, rollback.
  `onchain/app/launch-mainnet.mjs` — env-driven (RPC_URL/WALLET/MODE) full test launch: init global → create
  → buy to graduate → `migrate_to_raydium` on real mainnet Raydium; `MODE=test` (virtual_sol 2 → graduates
  for a few SOL) vs `MODE=prod` (30). Refuses to run unless RPC_URL is a mainnet endpoint.
- **NOT done (by design / the user's to do):** the mainnet `solana program deploy`, global init, and token
  launch — the assistant does not deploy unaudited fund-custody code to mainnet; the user runs it manually
  with their wallet per DEPLOY_MAINNET.md. No third-party audit; upgrade authority not yet secured (Step 4).

Build state note: in-repo `lib.rs` is now the MAINNET build (id `35UELz…`, ADMIN = user wallet). Backups:
`lib.rs.v3-localnet.bak` (H1xojHAR…), `lib.rs.v2-fronting.bak` (2KYq5Za1…).

## 2026-11-08 — session 4 (cont, Opus) — DEVNET DRY RUN of the v3 mainnet code: migrate on REAL Raydium ✓

Dry run of the mainnet launch, on devnet, before the user's manual mainnet deploy. Proves the v3 migrate
against REAL (not cloned) Raydium — the one thing localnet couldn't.

- **Deployed v3 to devnet** (program `H1xojHAR…`, ADMIN = local deployer `2XPJm6qc…` so the harness can sign
  init). Deploy cost ~2.15 SOL (5.29 → 3.14). Loader-v3 `solana program deploy --program-id program-keypair-v3.json`.
- **Full launch on real devnet Raydium** (`app/migrate-test-devnet.mjs`, small-param global virtualSol 2):
  create (dev_buy 0.5) → buys → complete (realSol 0.375, floorVault 0.125, 999M remainder) →
  `migrate_to_raydium`. Result: real Raydium CPMM pool `BqUmczAr43LxKdQPuNN2w6waHsgq3AKemn9uysE8mLx9` created
  (owner `DRaycpLY…` devnet CPMM), vaults 0.2 wSOL + 999M coin, **LP supply after burn = 0 (locked)**.
  migrate tx `5tmNPqR6kt3CobVWKsQePwQxtEJV9TLmTi1XBnEMzcAHEZnyvGdJctFXvB1swn8Wwb2TFY5x2MyExYjvjWWHRVP4`.
  So v3 (system-vault, capital-free) now migrates on REAL Raydium, matching the v2 devnet result from session 3.
- **Restored the mainnet build** after the dry run: in-repo `lib.rs` back to `declare_id 35UELz…` + `ADMIN
  3vkTXSV3…` (user wallet), rebuilt, `lib/idl.json` repointed to the mainnet id. Backed up as
  `lib.rs.v3-mainnet.bak`. The devnet `H1xojHAR…` deployment stays live on devnet for inspection.
- Devnet deployer `2XPJm6qc…` is now low (~0.5 SOL) after deploy + test; airdrop was rate-limited.

Backups now: `lib.rs.v3-mainnet.bak` (35UELz, user ADMIN — current), `lib.rs.v3-localnet.bak` (H1xojHAR),
`lib.rs.v2-fronting.bak` (2KYq5Za1). Mainnet still NOT deployed — user runs DEPLOY_MAINNET.md manually.

## 2026-11-08 — session 4 (cont, Opus) — low-budget (cheap) launch mode

User wants to launch with 0.03–0.05 SOL. Added a `cheap` mode (now the default) to
`onchain/app/launch-mainnet.mjs` and documented the hard cost floors.

- **`MODE=cheap`** (default): virtual_sol 0.05, dev_buy 0.03, no extra buys. create + dev buy ≈ **0.039 SOL**
  (~0.009 account rents: mint + curve PDA + curve_vault ATA + dev ATA + sol_vault rent-seed, + 0.03 dev buy).
  Coin is LIVE + tradeable on the bonding curve, then the script STOPS — it does not attempt Raydium.
  `DEV_BUY=<sol>` env overrides the dev buy (e.g. 0.02 → ~0.029 total; 0 → ~0.009, floor opens at 0).
- **Migrate guard:** before `migrate_to_raydium` the script now checks `realSol + floorVault > 0.3`
  (MIGRATE_SOL_RESERVE). If not (always true in cheap mode), it prints the coin is live on the curve and
  exits cleanly instead of sending a migrate that would hit the program's `require!`.
- **Documented the floors in `DEPLOY_MAINNET.md`** (can't be lowered — not our code): a coin must collect
  **>0.3 SOL** before it can migrate; Raydium charges ~0.15 create-pool fee + ~0.4 account rents on
  `initialize`; so graduating to a real pool needs ~0.7+ SOL of organic buys. Program deploy is ~2.6 SOL
  one-time regardless. `MODE=test` (~1 SOL) and `MODE=prod` (~86 SOL) still do the full graduate+migrate.
- No program/const change — `MIGRATE_SOL_RESERVE` (0.3) left as-is (it must cover Raydium's real fee+rents;
  lowering it underfunds migrate). Only client params/flow changed.

## 2026-11-08 — session 4 (cont, Opus) — v3.1: POOL-PAID graduation (sender needs ZERO SOL)

Per user: graduation must be paid from the pool, not by the creator/sender. Built v3.1 — the migrate tx
pre-funds the sender from the pool, so the sender fronts nothing.

- **Program change (`migrate_to_raydium`):** added **step 0** — `invoke_signed(sol_vault → creator,
  MIGRATE_SOL_RESERVE)` at the very top (pool hands the sender the 0.3 budget before any cost). The sender's
  `creator_coin`/`creator_wsol` ATAs are now created **in-handler** via `associated_token::create_idempotent`
  (funded from the pre-fund) instead of Anchor `init_if_needed, payer=creator` (which charged the sender
  ~0.004 before the handler ran); in the struct they became `UncheckedAccount`. Removed the old step-6
  post-reimbursement. Net: sender needs ZERO SOL of its own (beyond the ~5000-lamport base tx fee); keeps the
  ~0.1 leftover as reward. Lamports still conserved (vault pays real_sol+floor across step 0 + step 2).
  Fixed a name collision — the program already has a `Create` accounts struct, so imported spl's as
  `AtaCreate`.
- **Verified (localnet, cloned devnet Raydium):** `app/migrate-test-localnet-v3.mjs` with the crank funded
  only **0.03 SOL** vs a 0.5-SOL pool deposit → migrate landed, real pool (owner `DRaycpLY…`), 0.2 wSOL +
  999M coin, **LP burned (supply 0)**; crank **0.03 → 0.134 (net +0.104)**, never fronted the pool. migrate
  tx `25vJdzQZwhwAQue7fomEKi7xvjdejf3rBJVvzcK9ducPYXrPje6kx4nZ1wHn5xNhPMwf8jNUD3qrNHQQpfqVJfFV`. Buy/sell/floor
  unchanged (`sell-smoke-v3.mjs` green).
- **Devnet v3.1 run BLOCKED on the faucet:** upgrading the devnet `H1xojHAR…` to v3.1 needs ~2.8 SOL
  transient buffer; deployer had 2.75, airdrops rate-limited. Not a real gap — the Raydium CPI is
  byte-identical to v3 (verified on real devnet Raydium, tx 5tmNPqR6…); v3.1's delta (pre-fund order) is
  localnet-covered. Can be re-run on devnet once the deployer is funded.
- **Mainnet artifact re-staged:** `lib.rs` = v3.1 with `declare_id 35UELz…` + ADMIN `3vkTXSV3…` (user wallet);
  `anchor build` clean; `lib/idl.json` repointed; backup `lib.rs.v3.1-mainnet.bak`. `.so` ~401 KB.
  DEPLOY_MAINNET.md + RAYDIUM_MIGRATION.md (§v3.1) updated. Still UNAUDITED; mainnet NOT deployed (user's
  manual step).

Backups now: `lib.rs.v3.1-mainnet.bak` (35UELz, user ADMIN — CURRENT), `lib.rs.v3.1-localnet` builds from
`program-keypair-v3.json` (H1xojHAR), `lib.rs.v2-fronting.bak` (2KYq5Za1). The earlier `lib.rs.v3-*.bak` are
the pre-pool-paid v3 (reimburse model).

## 2026-11-09 — session 4 (cont, Opus) — v3.1 verified on REAL devnet Raydium

Ran the v3.1 (pool-paid) migrate on real devnet Raydium (the run that was faucet-blocked before). Faucet was
still capped at 2.75 SOL, so instead of UPGRADING the devnet H1xojHAR (needs ~2.8 transient buffer) I did a
FRESH deploy of v3.1 to a new devnet id (~2.09 SOL rent, fits 2.75).

- **Fresh v3.1 devnet program** `CcELoEGgvJDFjWNXKVXRcRQ3C9cZFstzqqG3Zs7vr4Wk` (keypair
  `program-keypair-v31-devnet.json`, ADMIN = local deployer `2XPJm6qc…`). Deploy tx `5NHozXft…`, cost ~2.09
  SOL (2.75 → 0.66).
- **v3.1 migrate on real devnet Raydium** (`app/migrate-test-devnet.mjs`): create (dev_buy 0.5 → pooled 0.5,
  > the 0.3 reserve) → `migrate_to_raydium`. Result: real Raydium CPMM pool
  `7LaoL9muMWqJAfyV1Z7x6nmsLLtGQ2R1rkkdAGtrneNN` (owner `DRaycpLY…`), vaults 0.2 wSOL + 999M coin, **LP supply
  after burn = 0 (locked)**, `graduated: true`. migrate tx
  `BNtynPtH96BhmSjmB3RXmtMgU6WYFwGTNGxPwm9E6V7QYVWdke9Qig68cqyJHsAFnmTmG1q2oha5aa4f5w8PQhV`. Deployer left 0.27
  SOL. So the v3.1 pool-paid pre-fund path now runs on REAL Raydium (devnet), matching the localnet proof.
  (The 0.03-SOL-crank creator-zero proof stands from the localnet run; here the sender was the admin.)
- **Mainnet build restored + re-staged** from `lib.rs.v3.1-mainnet.bak`: `35UELz…` + ADMIN `3vkTXSV3…`, rebuilt
  clean, `lib/idl.json` repointed. Mainnet NOT deployed (0 mainnet SOL in any reachable wallet; user's manual
  step). Still UNAUDITED.

Devnet artifacts now: v2 `2KYq5Za1…` (old), v3-reimburse `H1xojHAR…` (session-4 dry run), **v3.1 `CcELoEGg…`
(current, pool-paid)**. New keypair `program-keypair-v31-devnet.json`.

## 2026-11-09 — session 4 (cont, Opus) — consolidated master TO-DO into HANDOFF

No code change. Compiled every remaining item to go live into a single **"⬜ TO-DO — everything left to go
live (master list)"** section at the top of HANDOFF.md, tagged [USER]/[CLAUDE]/[LOVABLE]:
- A. Hard gates: audit; fund a mainnet wallet (both wallets 0 mainnet SOL); paid RPC; deploy (~2.6 SOL);
  init global; secure upgrade authority; point frontend at mainnet + flip the network.ts guard (Lovable).
- B. Program work missing: Metaplex metadata on create (NOT built, decision pending) + off-chain coin
  image/JSON hosting.
- C. Pre-launch: one mainnet MODE=test launch; verifiable build (solana-verify).
- D. Ops/polish: persistent indexer/DB; in-repo(v3.1)-vs-Lovable(v2) client split; legacy filter (done).
- DONE list captured so nothing gets redone.
See HANDOFF.md for the full tagged checklist. Program artifact remains staged (v3.1, 35UELz, user ADMIN),
UNAUDITED, mainnet not deployed.

## 2026-11-09 — workspace review (Codex)

Reviewed the workspace architecture, build log/handoff/deploy history, staged Rust source, clients,
launch/migration scripts, IDLs and engine tests. Added `WORKSPACE_REVIEW.md` and a superseding current
assessment at the top of HANDOFF. No program/client code changed and no mainnet transaction sent.

Found blockers absent from the old master TODO: unconstrained migration CPI target (static
asset-extraction path), retained ADMIN release route, competing permissionless internal graduation,
floor backing removed by external migration, and permanent global-mode reuse. Clients still route to
the internal pool; Next.js quote omits the floor output cap; checked-in Lovable kit still uses min-out 0.

Reproduced exact script economics in existing engine: test follows up with 6 SOL without completing
(needs 81.5 SOL at its chunk size); prod requires 780 SOL vs the script's 90 SOL cap. Devnet fixture uses
different supply parameters and does not prove those budgets. These are model results, not new on-chain runs.

16/16 engine unit/fuzz tests passed. TypeScript failed TS5097 on `.ts` test imports. Launch script syntax
passed. IDL/program keypair public IDs match staged mainnet declaration. Binary SHA-256 recorded in review.
Anchor invocation failed activating Solana 2.1.0; no rebuild or validator lifecycle performed. Historical
balances/deployment status were not rechecked over RPC. RTK.md reference could not be resolved.

Next is the ordered remediation in WORKSPACE_REVIEW.md, then audit and deployment preparation. Funding
alone does not make the current staged artifact launch-ready.


## 2026-11-09 — v4 technical release preparation (Codex)

User requested all technical work to prepare for mainnet. User explicitly selected continued floor
redemption after external migration. Implemented v4 (fresh account layout, same undeployed mainnet ID):

- Pinned Raydium executable, index-0 config, canonical pool/vault/LP/observation accounts, classic token
  programs and fee receiver. Require nonzero LP receipt, burn it and verify zero LP supply. Removed
  ADMIN release, competing internal graduation and internal swaps; enforce trade/migration phases.
- Preserve full-supply floor backing at graduation (including all pool tokens) by retaining
  max(existing floor vault, ceil(mint supply × floor / 1e18)); only remaining reserves fund migration.
  Added untaxed fixed-floor burn/redemption. External swaps do not pay Ratchet taxes or ratchet floor.
- Added immutable Metaplex metadata creation before mint-authority revocation, URI bounds and creator
  attribution to payer. Supplied permanent image/JSON pinning helper (requires configured Pinata JWT).
- Shared integer quotes and migration budget; capped buy min-out matches program. Reconciled engine real
  reserves with Rust and retained solvency cap/economics. Removed false universal 86-SOL claim. Isolated
  small test fixture has full normal token supply and enough SOL to migrate; no production test init.
- Explicit resumable CLI, full genesis verification, production global checks, read-only default,
  manifest/deployed-bytecode verification on mainnet, bounded spending and exact simulated create cost.
- Public wallet signing through injected Phantom/Solflare, no public browser-local key, closed mainnet
  guard, explicit migration/redemption/market handoff, real canonical Raydium reserves, metadata form.
  Generated matching Vite kit. Actual external Lovable app remains outside this workspace.
- Unified browser/on-chain pnpm workspace; patched Next/PostCSS/TOML/JSON-RPC dependencies and replaced
  the unpatched native bigint addon with tested pure JS codec. Production audit: no known advisories.
- Release scripts pin SBF tools v1.44 and lockfiles, disallow custom feature/cfg inputs, verify mainnet
  constants/absence of test constants, and hash source/IDL/binary. Same-toolchain repeated bytecode SHA:
  85a8daec2c5fec1c360fec6b56f51572026bf649167589f038dae011e6f3c17e.

Validation: 23 unit/property tests, TypeScript and optimized Next build pass. Mobile isolated browser
proof passes connect/disconnect, mainnet guard, no stored keys/writes/page errors/horizontal overflow.
Multiple local lifecycles against cloned MAINNET Raydium+Metaplex pass; final exact-default-bytecode run
uses production Global injected at genesis (mainnet ADMIN signer unavailable), engine/chain parity,
metadata immutability, account/legacy-route negatives, 0.01-SOL crank, LP=0 and exact floor redemption
with remaining liabilities backed. CLI rejects wrong genesis and test/prod reuse; cost simulation rejects
overspend. Evidence is in release/*-proof.json and release/manifest.json. No public-network writes.

Read-only mainnet check confirms program absent, ADMIN and recorded deployer both 0 SOL. External gates:
independent audit, accessible/funded signing wallets and RPC, actual metadata pins, public isolated build
verification (Docker unavailable), mainnet deployment/smoke proof, owner upgrade-policy choice, integration
of actual Lovable app and guard enablement last. Rewrote HANDOFF/README/runbook/checklist for v4; historical
v2/v3 docs are marked superseded. Initialized source control with private keypairs, env secrets, build output
and dependency directories excluded; release source snapshot is prepared after final verification.

Final harness portability: local tests now use the deterministic public test-only `GmaDrpp…` key,
funded only on loopback, and need no personal wallet. Release verification rejects that authority in
mainnet bytecode. Added read-only live mainnet rent/config preflight; current 409600-byte allocation
needs ~2.08248 SOL final program rent, with ~2.07705 SOL transient buffer rent (~4.15953 SOL conservative
peak before transaction fees/margin). No mainnet tx; both recorded wallets remain unfunded.


## 2026-11-09 — researched and corrected early-launch rent budget

User asked about zero to ten launches in the first days. Checked live mainnet rent, official Agave 2.2.1
CLI/loader deployment implementation, current Metaplex fee schedule and Raydium fee docs. Found and
corrected my previous 4.16-SOL estimate: the loader drains the buffer to the payer BEFORE ProgramData
funding, so adding both rents double-counts the same SOL. No program/runtime changes.

Updated read-only mainnet-preflight estimator and deploy/handoff docs. Program+ProgramData rent is
2.08247996 SOL; global 0.00116332. Per-coin rent 0.01153160 (metadata allocation is 607 bytes), plus separate
0.01 SOL Metaplex create fee. Base+10 self-funded coins: 2.29895928 SOL excluding tx/priority fees, optional
dev buys and graduation. Recommended 2.5 SOL starting budget for that limited scope. Other creators pay
their own create costs; no daily rent charge on exempt accounts. Graduation reserve is collected from
curve reserves, not a launch-day fee for every token. Sources linked in DEPLOY_MAINNET.md. Mainnet still
not deployed; external audit/build/signing/frontend gates remain unchanged.


## 2026-11-09 — user chose upgradeable showcase with later rent recovery

User clarified that ProgramData rent is their focus and chose to retain upgrade authority, then close
the program after the showcase. Recorded that decision in the handoff, release status, README, checklist
and runbook; removed `--final` from the active showcase steps. No program code or deployed state changed.
No mainnet deployment/closure occurred. Keep actual upgrade-authority signer accessible (separate from
ADMIN); future closure recovers ProgramData lamports only and disables redemption. Coin positions must
be settled before shutdown; coin vaults and burned-LP liquidity are not refunded by closing the program.
