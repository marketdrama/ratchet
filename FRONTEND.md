> Historical v2/v3 reference. The v4 release candidate supersedes these instructions. See the root README.md, DEPLOY_MAINNET.md and RELEASE_STATUS.md for current behavior and commands.

# ratchet — FRONTEND orientation

Everything a **frontend/design session** needs to work on `ratchet` without reading the whole repo.
You will mostly touch `app/`, `components/`, `app/globals.css`, and read from `lib/`. You should **not**
need to touch the Rust program or the on-chain logic — the data is already there and the read/write API is
done. When in doubt about overall project state, `HANDOFF.md` is the source of truth; this file is the
frontend-focused slice.

---

## 1. What the product is (one paragraph)

A pump.fun-style Solana memecoin launchpad with one twist: every coin has a **ratcheting floor**. A flat
**1.25% tax on every buy** goes into a locked **floor vault**; the floor price = vault ÷ circulating supply
and **only ever clicks up**. Sellers are always paid `max(curve price, floor price)`, so there's a hard
bottom that rises over time. At graduation the vault becomes locked pool liquidity. That's the whole story
the UI has to tell: **price discovery on a bonding curve + a floor that only goes up.**

## 2. Stack

- **Next.js 15** (App Router) · **React 18** · **TypeScript** · **pnpm**
- **Plain CSS** — all styles in `app/globals.css` (~157 lines, CSS custom properties, dark theme). **No
  Tailwind, no CSS-in-JS lib.** Inline `style={{}}` is used in places. Accent color is `var(--accent)`.
- Solana via `@coral-xyz/anchor` + `@solana/web3.js` + `@solana/spl-token`, talking straight to a local
  validator. `components/Providers.tsx` installs a `Buffer` polyfill (needed by web3.js in the browser).
- **No backend server, no database.** The feed reads live on-chain state each poll.

## 3. Run it

The backend (validator + seeded coins) is normally already running from another session. To bring the UI up:

```sh
cd "/Users/paupau/reverse engineer/higher fun/ratchet"
pnpm install
pnpm dev          # http://localhost:3100
```

If the feed is empty, the validator isn't seeded — see `HANDOFF.md` "Run it (localnet)" to reset + seed.
The app uses a **burner wallet** stored in `localStorage` (`ratchet-burner`) that **auto-airdrops on
localnet**; the Header has a **Get SOL** button. No browser extension needed.

`.claude/launch.json` already defines the `ratchet` dev server on port 3100, so the preview tooling can
start it by name.

## 4. Data flow (how the UI gets its numbers)

```
on-chain BondingCurve accounts
        │  (RPC reads via lib/chain.ts)
        ▼
  CoinAccount  (raw bigint fields)        ← lib/chain.ts
        │  (lib/coinview.ts: view(c))
        ▼
  CoinView     (display-ready numbers)    ← what components render
        │
        ▼
  React hooks  (lib/useChain.ts)          ← useCoins(), useCoin(mint)
```

**You almost always consume `CoinView` via the hooks. You rarely call `lib/chain.ts` directly except for
the write actions (create/buy/sell).**

### `CoinAccount` (raw, `lib/chain.ts`) — bigints, lamports/base units
`mint, creator, name, symbol, virtualSol, virtualToken, realSol, realToken, circulating, floorVault,
floorScaled, complete, graduated, poolTokens`

### `CoinView` (display, `lib/coinview.ts`) — plain numbers, this is what you render
```ts
{ mint, name, symbol, emoji, creator,
  spot,       // SOL per whole token (live curve, or pool if graduated)
  floor,      // SOL per whole token guaranteed by the vault
  vaultSol,   // real SOL locked in the floor vault
  progress,   // 0..100 of the bonding curve filled
  complete,   // curve sold out
  graduated,  // migrated to the pool
  mcUsd }     // spot market cap in USD
```

## 5. The API surface you'll use (`lib/chain.ts`)

Reads:
- `listCoins(): Promise<CoinAccount[]>` — all coins (feed).
- `getCoin(mint): Promise<CoinAccount | null>` — one coin.
- `balanceSol(): Promise<number>` — burner SOL balance.
- `myTokenBalance(mint): Promise<number>` — burner's holding of a coin (whole tokens).
- `ensureFunds()` — tops up the burner (airdrop on localnet; best-effort on devnet).

Writes (all signed by the burner, all `Promise<void>` unless noted; they handle graduation automatically):
- `createCoin(name, symbol): Promise<string>` — launches a coin, returns its mint.
- `buy(mint, sol)` — buy with `sol` (a JS number of SOL).
- `sell(mint, tokensWhole)` — sell a number of whole tokens.

Display helpers:
- `lib/coinview.ts`: `view(c)`, `spotPrice(c)`, `floorPrice(c)`, `marketCapUsd(c)`, `progress(c)`,
  `emojiFor(mint)`. **`SOL_USD = 180` is hardcoded here** — single place to change the USD assumption.
- `lib/format.ts`: number/price formatting helpers.

Hooks (`lib/useChain.ts`):
- `useCoins()` — feed, polls.
- `useCoin(mint)` — one coin, polls.
- `useMounted()` — **gate client-only render** (see gotchas).

## 6. Page & component map (what exists today)

Pages (`app/`):
- `layout.tsx` — app shell: `Providers` + `Header`, global CSS.
- `page.tsx` — **the feed**: grid of `CoinCard`.
- `coin/[mint]/page.tsx` — **coin detail**: `PriceChart` (dual line: spot + floor), `RatchetMeter`,
  `TradePanel`.
- `create/page.tsx` — **launch form** (name/symbol → `createCoin`).
- `docs/page.tsx` — **"How ratchet works"** explainer copy (keep this truthful to the mechanics).

Components (`components/`):
- `Header.tsx` — logo/nav + wallet chip (burner address + balance) + **Get SOL** button.
- `CoinCard.tsx` — one coin tile in the feed (name, emoji, mcap, progress).
- `PriceChart.tsx` — the dual spot/floor line chart on the coin page.
- `RatchetMeter.tsx` — visual of the floor vs spot / how high the floor has clicked.
- `TradePanel.tsx` — buy/sell box on the coin page.
- `Providers.tsx` — Buffer polyfill wrapper (don't remove).

## 7. How to talk about the floor in the UI (important, don't get this wrong)

- The floor is a **price per token** and a **vault of real SOL** (`vaultSol`). Show those.
- **Never render the floor as a market cap** (floorPrice × total supply). The vault only backs *circulating*
  tokens, so a full-supply "floor mcap" massively overstates it (e.g. a $20 vault reads as a fake $640
  "mcap"). The real guarantee is the vault SOL, period. The current UI correctly shows floor as price + vault
  and never as a mcap — keep it that way.
- A good honest strength readout is **floor ÷ spot %** (today ~0.3% graduated up to ~1.3% on small curve
  coins) plus the **vault SOL**. Spot market cap (`mcUsd`) is fine to show as the coin's headline number.

## 8. Current economics (so your mock numbers are realistic)

- 1.25% tax → floor vault. Graduation at ~86 SOL of buys ≈ **~$76K market cap** (SOL=$180).
- Graduated coins: ~$76–77K mcap, ~**1.1 SOL** in the vault (~$200 backed), floor ≈ **0.33%** of spot.
- Curve coins currently seeded span ~$7K → ~$69K mcap. 3 of 10 graduated (UP, NVRD, LADR).

## 9. Gotchas

- **Client-only data → SSR mismatch.** Chain reads only work in the browser. Pages gate dynamic render on
  `useMounted()` to avoid hydration errors. Keep that pattern on any new component that reads chain/burner
  state; render a skeleton/placeholder until mounted.
- **Prices are floats derived from bigints** for display only — never route them back into a transaction.
  Trades take SOL (number) / whole tokens (number); the lib converts to lamports/base units.
- `lib/market.ts` + `lib/useMarket.ts` are an **old in-browser simulation**, kept for reference and **not
  used** by the live app. Don't build on them; use `lib/chain.ts` + `lib/useChain.ts`.
- The burner lives in `localStorage`; clearing site data makes a new wallet (and you re-airdrop).
- `SOL_USD` is a hardcoded constant, not a live oracle.

## 10. Design backlog (suggested, not required)

The app is **functionally complete but visually basic**. Likely high-value frontend work:
1. Feed polish — real card hierarchy, sort/filter (by mcap, progress, graduated), live-ish updates.
2. Coin page — stronger ratchet storytelling: make the "floor only clicks up" visible and emotional
   (the `PriceChart` + `RatchetMeter` are the hero). Show vault SOL + floor/spot %, never a floor mcap.
3. Trade panel UX — slippage/again, token balance, post-trade feedback, graduated vs curve states.
4. Create flow — preview, validation, the 1.25%-tax explainer inline.
5. Mobile layout pass (globals.css is desktop-first).
6. Empty/loading/error states (esp. while `useMounted` is false or the validator is down).

> House rule for any copy you write: the tax is **1.25% on every buy, 100% into the floor vault, no
> platform or creator cut.** Keep `app/docs/page.tsx` consistent with that.
