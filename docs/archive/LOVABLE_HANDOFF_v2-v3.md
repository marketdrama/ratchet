> Historical v2/v3 reference. The v4 release candidate supersedes these instructions. See the root README.md, DEPLOY_MAINNET.md and RELEASE_STATUS.md for current behavior and commands.

# ratchet — LOVABLE HANDOFF (frontend brief)

This is the brief for building the **ratchet** frontend in **Lovable**. The backend is finished — a
deployed Solana program, a verified data layer, and a frozen data contract. Lovable owns the UI from here.
Read this top to bottom; everything you need to design against is in §4 (data) and §7 (design brief), and you
do **not** need to touch or understand the on-chain code.

---

## 1. What you're building

A **pump.fun-style memecoin launchpad** with one signature twist: every coin has a **ratcheting floor**.
A flat **1.25% tax on every buy** goes 100% into a locked **floor vault**; the floor price only ever
**clicks up, never down**. Sellers are always paid `max(spot price, floor price)`, so there's a hard bottom
that rises over time. At graduation the vault becomes locked pool liquidity. The product's whole feeling is:
**a coin with a safety net that only goes higher.** The UI's job is to make that legible and exciting.
Creators can **seed the floor at launch**: 25% of their optional dev buy drops straight into the vault, so a
coin can open with a real floor on day one (see §7.3).

Three core screens:
- **Feed** (`/`) — grid of coins, sortable (market cap / progress / new / graduating). The hook of each card
  is the ratchet floor (vault SOL).
- **Coin page** (`/coin/:mint`) — the hero. Price + floor chart, the **ratchet staircase**, a buy/sell panel.
- **Create** (`/create`) — launch a coin (name + ticker). Plus a **docs/how-it-works** page.

## 2. Important: stack reality (read this)

The existing repo is **Next.js + plain CSS**. **Lovable builds in Vite + React + Tailwind + shadcn/ui** —
a different stack. **Do not try to import the Next.js app.** Build the UI fresh in Lovable's stack. You are
free to design from scratch; only the **data contract** (§4) and the **product rules** (§7) are fixed.

The app is a live **Solana** client. Lovable's preview sandbox can't reach the chain, so **build the entire
UI against the typed mock data in `lovable-sample-data.json`** (a real snapshot of 10 coins, shape = §4).
Wiring the UI to the real chain is a **separate, later step** done by a developer (§8) once the program is on
devnet — it is not your concern. Design and build as if the data in that JSON is what you get.

## 3. Tech the backend already provides (done — not your job)

- On-chain Anchor program `ratchet-curve`, program id `2KYq5Za1PctA7p6XzaSnXAjCe2ARMCE5iWtMViHDaqmn`.
  Instructions: `initialize, create, buy, sell, graduate, swap`. Fixed token supply, 6 decimals.
- Verified on localnet: 13/13 tests pass, 10 coins seeded, a live buy confirmed the 1.25% tax on-chain.
- A browser client (`lib/chain.ts`) with the read/trade functions in §5, and display math (`lib/coinview.ts`,
  `components/num.tsx`) you can copy the logic from. The IDL (the program's typed interface) is
  `lib/idl.json`.
- **Pending (not blocking you):** a devnet deploy so the live app is reachable from the cloud. Design/build
  does not wait on it.

## 4. THE DATA CONTRACT (design against this)

Every coin the UI renders is a `CoinView`. This shape is frozen — build your components around it.

```ts
interface CoinView {
  mint: string;       // on-chain address, also the route param and the emoji seed
  name: string;       // e.g. "The Ladder"
  symbol: string;     // ticker, e.g. "LADR" (no $)
  emoji: string;      // deterministic from mint (already chosen; see sample data)
  creator: string;    // wallet address (show shortened: "9kmB…L1EH")
  spot: number;       // price in SOL per whole token (tiny, e.g. 4.3e-7)
  floor: number;      // floor price in SOL per whole token (tinier, e.g. 1.4e-9)
  vaultSol: number;   // SOL locked in the floor vault (e.g. 1.125)
  progress: number;   // 0..100 — % of the bonding curve filled
  complete: boolean;  // curve sold out
  graduated: boolean; // migrated to the pool
  mcUsd: number;      // spot market cap in USD (the headline number)
  sellTaxPct: number; // this coin's SELL tax, % (1.25..5) — creator chose it at launch
}
```

**Sample dataset: `lovable-sample-data.json`** — 10 real coins spanning fresh → graduated. Drop it in and
map over it. States to design for: early curve (low %), near-graduation (90%+), and **graduated** (badge it).

Derived display values (compute in the UI):
- **floor / spot %** = `floor / spot * 100` — the honest "floor strength" (≈0.3% graduated up to ~1.3% small
  coins). Show with 2 decimals so it never reads "0%".
- **vault in USD** = `vaultSol * 180` (SOL assumed $180; keep it one constant).
- Prices are tiny — format memecoin-style: `$0.0₅773` (subscript zero-count) or `$4.3e-7`. See
  `components/num.tsx` in the repo for a reference implementation you can port.

## 5. The read/trade API (for the later wiring step — reference only)

When a dev wires your UI to the chain, these are the calls (`lib/chain.ts`). Build your components so these
map cleanly onto event handlers and data hooks:

```ts
listCoins(): Promise<CoinAccount[]>      // feed  → map each through view() → CoinView
getCoin(mint): Promise<CoinAccount|null> // coin page
balanceSol(): Promise<number>            // wallet SOL (burner)
myTokenBalance(mint): Promise<number>    // user's holding of a coin
createCoin(name, symbol, sellFeeBps, devBuySol?): Promise<mint>  // launch; sellFeeBps 125..=500 (1.25%..5%)
                                                 // devBuySol: optional dev launch buy — 25% seeds the floor
buy(mint, sol): Promise<void>            // buy with N SOL
sell(mint, tokensWhole): Promise<void>   // sell N whole tokens
ensureFunds()                            // tops up the burner (localnet airdrop / "Get SOL")
```

Wallet model: an in-browser **burner wallet** (localStorage), no extension. The header shows its address +
SOL balance and a **Get SOL** button. Model it as "already connected" — no connect-wallet modal needed.

## 6. Economics (so your numbers read true)

- 1.25% tax on every buy → floor vault, **no platform or creator cut**.
- Graduation at ~86 SOL of buys ≈ **$76K market cap** (SOL = $180).
- Graduated coins: ~$76–77K mcap, ~1.1 SOL vault (~$200 backing), floor ≈ 0.3% of spot.
- Curve coins in the sample span ~$7K → ~$69K mcap; 3 of 10 graduated.

## 7. Design brief & house rules

Direction: a crypto-native launchpad that feels **premium, kinetic, confident** — not a generic dashboard.
The ratchet is the brand: lean into "it only clicks up." A staircase / ratchet-teeth motif, a floor line that
visibly steps, upward motion. Dark theme, one strong accent (the current build uses a lime green). Fast,
dense, legible at a glance; great on mobile.

Priorities:
1. **Coin page is the hero.** The price-vs-floor chart + a **ratchet staircase** that makes "clicks up, never
   down" obvious and satisfying. Buy/sell panel with live estimate, token balance, the "1.25% → floor"
   framing, graduated vs curve states.
2. **Feed** — strong card hierarchy, sort/filter, the floor (vault SOL) as each card's hook, a progress bar,
   a graduated badge.
3. **Create** — name/ticker with a live preview card, the 1.25%-buy-tax explainer, **plus a SELL-tax
   slider the creator sets: 1.25%–5%** (min 1.25, max 5, step 0.25 reads nicely). Show it on the coin page
   too (`sellTaxPct`) so traders see a coin's sell tax before buying.
   **Also: an optional DEV-BUY field** — the creator's own launch buy (in SOL). Frame it as
   "**seed the floor**": **25% of the dev buy goes straight into the floor vault**, so the coin launches
   with a real, non-zero floor instead of starting at ~0; the other 75% buys the creator their bag on the
   curve. Make the 25%→floor split explicit in the UI, with a live "opening floor" preview. 0 / empty = a
   bare launch (no seeded floor). Passed as `createCoin(name, symbol, sellFeeBps, devBuySol)`.
4. States: loading skeletons, empty, error, "not found".

**House rules (non-negotiable):**
- The tax is **1.25% on every buy, 100% into the floor vault, no platform/creator cut.** All copy must match.
- **Never render the floor as a market cap.** The vault only backs circulating tokens; floor-as-mcap
  massively overstates it. Show the floor as a **price per token** + **vault in SOL/USD**, and optionally
  **floor/spot %**. The headline cap number is always **spot** `mcUsd`.
- Prices are display floats — never feed a rendered number back into a trade; trades take SOL / whole tokens.

## 8. Wiring to the live chain (dev step, after Lovable) — NOW LIVE ON DEVNET

The program is **deployed and seeded on Solana devnet**, so the seam is ready whenever you wire it.

```
Cluster:    devnet
RPC:        https://api.devnet.solana.com   (public — rate-limits / 429s under load;
            for production use a free Helius/QuickNode devnet RPC instead)
Program id: 2KYq5Za1PctA7p6XzaSnXAjCe2ARMCE5iWtMViHDaqmn  (updated program — sell tax + dev-buy seed)
IDL:        lib/idl.json (in this repo)
Live coins (fresh, seeded with a dev-buy floor + a per-coin sell tax):
  UP    8e6FneNWdY31EmXnqZA89bMxm5rVPngsgvmpkcFS5cPX   (sell tax 1.25%)
  RCAT  GVAdGSXS4XHeGDLPquit2cyPJCVXqbt1jiksp6tZSJuF   (sell tax 5%)
  FLOOR HyN7gAC9bV7YxQ8jM8tkc4hS3FQ329WV24ZhVs3sGud7   (sell tax 3%)
  ROCK  F2nyWeU4ix7tqVzLNRtxiKjX5CCXJBAmoUvyFu9KhAxc   (sell tax 2.5%)
```
Note: an in-place upgrade left the old pre-sell-tax coins on devnet; they mis-decode under the new IDL,
so the client filters to `sellFeeBps ∈ [125,500]` — only the four above show.

To wire: a dev ports `lib/chain.ts` (plain `@solana/web3.js` + `@coral-xyz/anchor`, runs fine under Vite),
sets `VITE_RPC_URL` to the devnet RPC, and swaps the mock dataset for `listCoins()`/`getCoin()` → `view()`.
Keep data access behind one hook/service boundary so this swap touches a single module, not every component.
Note: devnet burner wallets need devnet SOL to *trade*; reads work for everyone.

## 9. Pointers into the repo

- `lovable-sample-data.json` — the mock dataset (build against this).
- `lib/coinview.ts` — the `CoinView` shape + all display math (spot/floor/mcap/progress/emoji).
- `components/num.tsx` — tiny-price + vault USD formatting you can port.
- `lib/chain.ts` — the read/trade API (reference for the wiring step).
- `lib/idl.json` — the program's typed interface.
- `FRONTEND.md` — deeper notes on the Next.js build (reference only; you're not using that stack).
- `HANDOFF.md` / `BUILD_LOG.md` — whole-project state and history.
