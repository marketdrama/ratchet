# v4 developer review — 2026-11-09

This is not an independent audit or authorization for real funds. See RELEASE_STATUS.md for evidence.

Fixed since v3.1: arbitrary migration CPI target; retained ADMIN release; competing internal graduation;
post-migration unbacked floor; stale client quote math; mode-dependent global initialization; zero min-out
in the checked-in Vite kit; missing mint metadata; public-network browser-local key signing.

v4 migration retains `max(existing_floor_vault, ceil(mint_supply * floor_scaled / 1e18))`. It funds the
0.3 SOL cost reserve and pool liquidity from `real_sol` after that top-up, uses pinned Raydium and canonical
PDAs, requires LP receipt, burns it and verifies zero LP supply. Failure rolls back the whole instruction.
The migrated floor stays fixed. Redemption burns tokens, decreases tracked liabilities and pays a rounded-
down floor value. External burns can only leave surplus backing. No ADMIN vault withdrawal exists.

Existing invariants: mint authority revoked after immutable metadata creation; global fee fixed to 125 bps;
bounded config math; seeds/owners/signers bind vaults and ATAs; release overflow checks enabled; all SOL
payouts use system CPIs signed by the SOL-vault PDA. Creator attribution equals payer.

Independent review must cover: integer rounding and bounds; all-token liabilities including pool tokens;
CPI/account-substitution attacks; metadata encoding; migrated and pre-migration phase transitions; liquidity
creation fee changes; unsolicited donations/external token burns; MEV/slippage; upgrade/signing custody.

Accepted limitations: no emergency pause; no vault close/withdraw; redemption floor freezes at graduation;
external Raydium trades do not fund Ratchet taxes; fixed mint supply and no tax skim; tiny floor redemptions
round to zero and are rejected; migration reverts if reserves cannot cover backing and costs; network fees
remain the caller's responsibility. A single-signature upgrade authority must not be presented as immutable.

Graduation economics depend materially on creator seed and trade sizes. Buy caps are intentional solvency
protection; clients and launch budgets must not assume the old 86 SOL estimate. Historical tests of tiny
sellable supply do not establish production economics or third-party security review.
