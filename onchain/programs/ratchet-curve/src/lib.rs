// Ratchet v4 release candidate: permissionless Raydium migration and fully backed floor redemption.
// Mainnet is the default build. Test features must never be used in a mainnet release.
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_lang::solana_program::{instruction::{Instruction, AccountMeta}, program::{invoke, invoke_signed}};
use anchor_spl::associated_token::{self as ata, AssociatedToken};
use anchor_spl::associated_token::Create as AtaCreate;
use anchor_spl::token::{self, Burn, Mint, MintTo, SetAuthority, SyncNative, Token, TokenAccount, Transfer, sync_native};
use anchor_spl::token::spl_token::instruction::AuthorityType;

declare_id!("35UELzdncBr15qztq55Kct3sZvmXnn5D5e5rpGiHgMuC");

const SCALE: u128 = 1_000_000_000_000_000_000; // 1e18 floor-price fixed point
const BPS: u128 = 10_000;
// Per-coin SELL tax bounds the creator chooses at `create`. Buy tax stays global.
const MIN_SELL_FEE_BPS: u16 = 125; // 1.25%
const MAX_SELL_FEE_BPS: u16 = 500; // 5%
// A dev's launch buy seeds the floor: 25% of it goes straight into the vault, the
// rest buys tokens on the curve. So a coin opens with a real, ratcheting floor.
const DEV_FLOOR_CUT_BPS: u16 = 2500; // 25%
// Trustless Raydium migration: SOL kept with the crank to cover Raydium's create-pool fee
// (~0.15 SOL) + account rents; the remaining curve reserves (after full-supply backing) become pooled wSOL liquidity.
const MIGRATE_SOL_RESERVE: u64 = 300_000_000; // 0.3 SOL
// anchor sighash("global:initialize") — Raydium cp-swap `initialize` discriminator.
const RAYDIUM_INITIALIZE_IX: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];
const WSOL_MINT: Pubkey = anchor_lang::solana_program::pubkey!("So11111111111111111111111111111111111111112");

#[cfg(not(feature = "test-admin"))]
const ADMIN: Pubkey = anchor_lang::solana_program::pubkey!("3vkTXSV3LG7ZrZt1SWMnEYBjNBiYAg168fbEV3Q6skTi");
#[cfg(feature = "test-admin")]
const ADMIN: Pubkey = anchor_lang::solana_program::pubkey!("GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB");
#[cfg(not(feature = "devnet"))]
const CPMM: Pubkey = anchor_lang::solana_program::pubkey!("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
#[cfg(feature = "devnet")]
const CPMM: Pubkey = anchor_lang::solana_program::pubkey!("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb");
#[cfg(not(feature = "devnet"))]
const POOL_FEE: Pubkey = anchor_lang::solana_program::pubkey!("DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8");
#[cfg(feature = "devnet")]
const POOL_FEE: Pubkey = anchor_lang::solana_program::pubkey!("3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy");
const METADATA_PROGRAM: Pubkey = anchor_lang::solana_program::pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

#[program]
pub mod ratchet_curve {
    use super::*;

    /// One-time: set the launchpad parameters.
    pub fn initialize(
        ctx: Context<Initialize>,
        virtual_sol: u128,
        virtual_token: u128,
        real_token: u128,
        total_supply: u64,
        fee_bps: u16,
        floor_cut_bps: u16,
    ) -> Result<()> {
        require!(ctx.accounts.admin.key() == ADMIN, RatchetError::Unauthorized);
        require!(fee_bps == 125 && floor_cut_bps == 0, RatchetError::BadParams);
        require!(virtual_sol > 0 && virtual_sol <= 1_000_000_000_000_000, RatchetError::BadParams);
        require!(total_supply == 1_000_000_000_000_000 && real_token > 0
            && real_token < total_supply as u128 && virtual_token > real_token
            && virtual_token <= 2_000_000_000_000_000, RatchetError::BadParams);
        let g = &mut ctx.accounts.global;
        g.admin = ctx.accounts.admin.key();
        g.virtual_sol = virtual_sol;
        g.virtual_token = virtual_token;
        g.real_token = real_token;
        g.total_supply = total_supply;
        g.fee_bps = fee_bps;
        g.floor_cut_bps = floor_cut_bps;
        g.bump = ctx.bumps.global;
        Ok(())
    }

    /// Create a coin: mint the full supply into the curve vault, open the curve.
    pub fn create(ctx: Context<Create>, name: String, symbol: String, uri: String, sell_fee_bps: u16, dev_buy: u64) -> Result<()> {
        require!(!name.trim().is_empty() && name.len() <= 32 && !symbol.trim().is_empty()
            && symbol.len() <= 10 && uri.len() <= 200
            && (uri.starts_with("https://") || uri.starts_with("ipfs://") || uri.starts_with("ar://")), RatchetError::BadParams);
        // creator picks the SELL tax per coin, clamped to [1.25%, 5%]
        require!(sell_fee_bps >= MIN_SELL_FEE_BPS && sell_fee_bps <= MAX_SELL_FEE_BPS, RatchetError::BadParams);
        let g = &ctx.accounts.global;
        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.bumps.bonding_curve;
        let seeds: &[&[u8]] = &[b"curve", mint_key.as_ref(), &[bump]];

        // mint the whole supply to the curve's vault
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.curve_vault.to_account_info(),
                    authority: ctx.accounts.bonding_curve.to_account_info(),
                },
                &[seeds],
            ),
            g.total_supply,
        )?;
        // Immutable Metaplex metadata is created while the curve still holds mint authority.
        // CreateMetadataAccountV3 discriminator and Borsh DataV2 (no royalties/creators/collection/uses).
        let mut data = vec![33];
        name.serialize(&mut data)?;
        symbol.serialize(&mut data)?;
        uri.serialize(&mut data)?;
        data.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0]);
        let ix = Instruction {
            program_id: METADATA_PROGRAM,
            accounts: vec![
                AccountMeta::new(ctx.accounts.metadata.key(), false),
                AccountMeta::new_readonly(mint_key, false),
                AccountMeta::new_readonly(ctx.accounts.bonding_curve.key(), true),
                AccountMeta::new(ctx.accounts.payer.key(), true),
                AccountMeta::new_readonly(ctx.accounts.bonding_curve.key(), true),
                AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
                AccountMeta::new_readonly(ctx.accounts.rent.key(), false),
            ], data,
        };
        invoke_signed(&ix, &[
            ctx.accounts.metadata.to_account_info(), ctx.accounts.mint.to_account_info(),
            ctx.accounts.bonding_curve.to_account_info(), ctx.accounts.payer.to_account_info(),
            ctx.accounts.system_program.to_account_info(), ctx.accounts.rent.to_account_info(),
            ctx.accounts.metadata_program.to_account_info(),
        ], &[seeds])?;

        // fix the supply: revoke mint authority
        token::set_authority(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                SetAuthority {
                    current_authority: ctx.accounts.bonding_curve.to_account_info(),
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                },
                &[seeds],
            ),
            AuthorityType::MintTokens,
            None,
        )?;

        // Seed the system-owned SOL vault PDA ([b"sol", mint]) to rent-exempt so it exists for
        // later buys/sells. ALL of the coin's SOL lives here (reserves + floor vault); the
        // program-owned bonding_curve PDA holds only its own data rent, never user funds. This is
        // what lets migrate invoke_signed a system transfer straight out of the vault (no fronting).
        let rent_min = Rent::get()?.minimum_balance(0);
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            rent_min,
        )?;

        let c = &mut ctx.accounts.bonding_curve;
        c.mint = mint_key;
        c.creator = ctx.accounts.creator.key();
        c.name = name.clone();
        c.symbol = symbol.clone();
        c.uri = uri;
        c.initial_real_token = g.real_token;
        c.sell_fee_bps = sell_fee_bps;
        c.virtual_sol = g.virtual_sol;
        c.virtual_token = g.virtual_token;
        c.real_sol = 0;
        c.real_token = g.real_token;
        c.circulating = 0;
        c.floor_vault = 0;
        c.floor_scaled = 0;
        c.complete = false;
        c.graduated = false;
        c.raydium_pool = Pubkey::default();
        c.bump = bump;

        // Dev launch buy (optional): 25% of the dev's buy seeds the floor vault, the
        // rest buys tokens on the curve for the dev. The coin then opens with a real,
        // ratcheting floor instead of ~0. `dev_buy == 0` keeps the old behavior.
        if dev_buy > 0 {
            let sol = dev_buy as u128;
            let to_floor = sol * DEV_FLOOR_CUT_BPS as u128 / BPS; // 25% seeds the floor
            let curve_in = sol - to_floor;
            require!(curve_in > 0, RatchetError::BadAmount);
            let mut out = curve_in * c.virtual_token / (c.virtual_sol + curve_in);
            if out > c.real_token { out = c.real_token; }
            require!(out > 0, RatchetError::BadAmount);
            // pull the dev's SOL into the SOL vault (curve_in reserves + to_floor, all as lamports)
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: ctx.accounts.sol_vault.to_account_info(),
                    },
                ),
                dev_buy,
            )?;
            // deliver the dev's tokens from the curve vault
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.curve_vault.to_account_info(),
                        to: ctx.accounts.dev_ata.to_account_info(),
                        authority: c.to_account_info(),
                    },
                    &[seeds],
                ),
                out as u64,
            )?;
            c.virtual_sol += curve_in;
            c.virtual_token -= out;
            c.real_token -= out;
            c.real_sol += curve_in;
            c.circulating += out;
            c.floor_vault += to_floor as u64;
            ratchet(c); // open the coin with a non-zero, ratcheting floor
            if c.real_token == 0 { c.complete = true; }
        }
        emit!(CreateEvent { mint: mint_key, creator: c.creator, name, symbol, dev_buy });
        Ok(())
    }

    /// Buy with `sol_in` lamports; receive at least `min_tokens_out` base tokens.
    pub fn buy(ctx: Context<Trade>, sol_in: u64, min_tokens_out: u64) -> Result<()> {
        let g = &ctx.accounts.global;
        let c = &mut ctx.accounts.bonding_curve;
        require!(!c.complete && !c.graduated, RatchetError::Complete);
        require!(sol_in > 0, RatchetError::BadAmount);

        let sol = sol_in as u128;
        let fee = sol * g.fee_bps as u128 / BPS;
        let floor_cut = sol * g.floor_cut_bps as u128 / BPS;
        let curve_in = sol - fee - floor_cut;
        require!(curve_in > 0, RatchetError::BadAmount);

        // x*y=k on virtual reserves
        let mut out = curve_in * c.virtual_token / (c.virtual_sol + curve_in);
        if out > c.real_token { out = c.real_token; }

        // Solvency guard (mirrors lib/ratchet.ts): a buy must never add more
        // floor-liability (out * floor_scaled) than it funds into the vault
        // (fee + floor_cut). This can bind during ordinary seeded trading too:
        // a non-decreasing floor must back every newly issued token, regardless of spot.
        let to_floor = fee + floor_cut;
        if c.floor_scaled > 0 {
            let max_out = to_floor * SCALE / c.floor_scaled;
            if out > max_out { out = max_out; }
        }
        require!(out > 0, RatchetError::BadAmount);
        require!(out as u64 >= min_tokens_out, RatchetError::Slippage);

        // pull the full sol_in into the SOL vault (curve_in is reserves, the rest is floor)
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            sol_in,
        )?;

        // deliver tokens from the curve vault
        let mint_key = c.mint;
        let seeds: &[&[u8]] = &[b"curve", mint_key.as_ref(), &[c.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.curve_vault.to_account_info(),
                    to: ctx.accounts.user_ata.to_account_info(),
                    authority: c.to_account_info(),
                },
                &[seeds],
            ),
            out as u64,
        )?;

        c.virtual_sol += curve_in;
        c.virtual_token -= out;
        c.real_token -= out;
        c.real_sol += curve_in;
        c.circulating += out;
        c.floor_vault += (fee + floor_cut) as u64;

        let clicked = ratchet(c);
        if c.real_token == 0 { c.complete = true; }
        emit_trade(c, ctx.accounts.user.key(), true, sol_in, out as u64, false, clicked);
        Ok(())
    }

    /// Sell `tokens_in` base tokens; receive at least `min_sol_out` lamports,
    /// paid at max(curve price, floor price).
    pub fn sell(ctx: Context<Trade>, tokens_in: u64, min_sol_out: u64) -> Result<()> {
        let c = &mut ctx.accounts.bonding_curve;
        require!(!c.graduated, RatchetError::AlreadyMigrated);
        let sell_fee_bps = c.sell_fee_bps as u128; // per-coin sell tax
        require!(tokens_in > 0, RatchetError::BadAmount);
        require!((tokens_in as u128) <= c.circulating, RatchetError::BadAmount);

        let t = tokens_in as u128;
        let mut curve_out = t * c.virtual_sol / (c.virtual_token + t);
        if curve_out > c.real_sol { curve_out = c.real_sol; } // can't pay more real SOL than held
        // SELL tax on the curve proceeds -> floor vault. Decide backstop vs curve on the
        // NET proceeds so a seller is never paid below the guaranteed floor.
        let sell_tax = curve_out * sell_fee_bps / BPS;
        let curve_net = curve_out - sell_tax;
        let floor_out = t * c.floor_scaled / SCALE;

        let paid_from_floor = floor_out > curve_net;
        let sol_out: u128;
        let mut clicked = false;

        if paid_from_floor {
            // floor backstop: burn the seller's tokens, pay from the vault. NOT taxed —
            // the floor price is a hard guarantee.
            sol_out = floor_out;
            token::burn(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Burn {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.user_ata.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                tokens_in,
            )?;
            c.floor_vault -= sol_out as u64;
            c.circulating -= t;
        } else {
            // normal curve sell: tokens return to the vault; the tax stays as floor vault.
            sol_out = curve_net;
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.user_ata.to_account_info(),
                        to: ctx.accounts.curve_vault.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                tokens_in,
            )?;
            c.virtual_sol -= curve_out;
            c.virtual_token += t;
            c.real_token += t;
            c.real_sol -= curve_out;
            c.circulating -= t;
            c.floor_vault += sell_tax as u64;
            clicked = ratchet(c); // vault up + circulating down -> floor can click up on a sell
        }
        require!(sol_out as u64 >= min_sol_out, RatchetError::Slippage);

        // pay lamports out of the system-owned SOL vault via an invoke_signed system transfer
        // (the v3 replacement for a raw lamport write; the vault stays >= rent-exempt).
        let out = sol_out as u64;
        let mint_key = c.mint;
        vault_pay(
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.sol_vault.to_account_info(),
            &ctx.accounts.user.to_account_info(),
            &mint_key,
            ctx.bumps.sol_vault,
            out,
        )?;

        c.complete = c.real_token == 0;
        emit_trade(c, ctx.accounts.user.key(), false, out, tokens_in, paid_from_floor, clicked);
        Ok(())
    }

    /// The sole graduation route. Reserve a fixed floor for EVERY outstanding token,
    /// create the canonical Raydium pool with the remaining reserves and burn all received LP.
    pub fn migrate_to_raydium(ctx: Context<MigrateToRaydium>, open_time: u64) -> Result<()> {
        require!(ctx.accounts.bonding_curve.complete, RatchetError::NotComplete);
        require!(!ctx.accounts.bonding_curve.graduated, RatchetError::NotComplete);

        require!(open_time == 0, RatchetError::BadParams);
        validate_raydium_accounts(&ctx.accounts)?;
        // the two pool mints must be exactly {this coin, wSOL}
        let our_mint = ctx.accounts.mint.key();
        let t0 = ctx.accounts.token_0_mint.key();
        let t1 = ctx.accounts.token_1_mint.key();
        let coin_is_0 = t0 == our_mint && t1 == WSOL_MINT;
        let coin_is_1 = t1 == our_mint && t0 == WSOL_MINT;
        require!(coin_is_0 || coin_is_1, RatchetError::BadParams);

        let bump = ctx.accounts.bonding_curve.bump;
        let coin_tokens = ctx.accounts.curve_vault.amount;
        let c = &ctx.accounts.bonding_curve;
        // Round UP so rounding cannot leave any outstanding token unbacked.
        let backing = floor_backing(ctx.accounts.mint.supply, c.floor_scaled)?;
        let retained_floor = backing.max(c.floor_vault);
        let top_up = retained_floor.checked_sub(c.floor_vault).ok_or(RatchetError::BadAmount)?;
        let reserves = u64::try_from(c.real_sol).map_err(|_| RatchetError::BadAmount)?;
        let moved_lamports = reserves.checked_sub(top_up).ok_or(RatchetError::InsufficientMigrationReserves)?;
        require!(moved_lamports > MIGRATE_SOL_RESERVE && coin_tokens > 0, RatchetError::InsufficientMigrationReserves);
        let wsol_liquidity = moved_lamports - MIGRATE_SOL_RESERVE;

        // 0) v3.1 — THE POOL PAYS GRADUATION, not the sender. Pre-fund `creator` (whoever sends this tx)
        //    with MIGRATE_SOL_RESERVE straight from the pool's SOL vault, BEFORE any account is created or
        //    any Raydium fee is charged. The sender then spends this pool-provided SOL on the two ATAs it
        //    needs + Raydium's create-pool fee + the pool account rents — all within this same tx. So the
        //    sender needs ZERO SOL of its own beforehand (beyond the ~5000-lamport base tx fee every Solana
        //    tx costs). No post-hoc reimbursement, no fronting. The leftover margin stays with the sender as
        //    the permissionless-graduation reward.
        vault_pay(
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.sol_vault.to_account_info(),
            &ctx.accounts.creator.to_account_info(),
            &our_mint,
            ctx.bumps.sol_vault,
            MIGRATE_SOL_RESERVE,
        )?;
        // create the sender's coin + wSOL ATAs now, funded from the pre-fund (idempotent: ok if they exist).
        ata::create_idempotent(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            AtaCreate {
                payer: ctx.accounts.creator.to_account_info(),
                associated_token: ctx.accounts.creator_coin.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ))?;
        ata::create_idempotent(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            AtaCreate {
                payer: ctx.accounts.creator.to_account_info(),
                associated_token: ctx.accounts.creator_wsol.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
                mint: ctx.accounts.wsol_mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ))?;

        // 1) curve token balance -> creator's coin token account (PDA signs)
        let seeds: &[&[u8]] = &[b"curve", our_mint.as_ref(), &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.curve_vault.to_account_info(),
                    to: ctx.accounts.creator_coin.to_account_info(),
                    authority: ctx.accounts.bonding_curve.to_account_info(),
                },
                &[seeds],
            ),
            coin_tokens,
        )?;

        // 2) fund the wSOL side of the pool DIRECTLY from the system-owned SOL vault — no fronting.
        //    In v2 the curve's SOL lived on the program-owned `bonding_curve` PDA, which can't be a
        //    `system_program::transfer` source and can't be raw-debited before a CPI, so the crank
        //    had to front ~85 SOL. In v3 the SOL lives in `sol_vault` (owner = System program, 0
        //    data), so the program `invoke_signed`s a system transfer straight out of it into
        //    `creator_wsol` — a proper CPI, verifier-safe. (v3.1: the sender's own costs were already
        //    covered by the step-0 pre-fund, so the sender fronts nothing.) Capital-free, fully atomic.
        vault_pay(
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.sol_vault.to_account_info(),
            &ctx.accounts.creator_wsol.to_account_info(),
            &our_mint,
            ctx.bumps.sol_vault,
            wsol_liquidity,
        )?;

        // 3) sync the wSOL account so its token balance reflects the lamports just added
        sync_native(CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            SyncNative { account: ctx.accounts.creator_wsol.to_account_info() },
        ))?;

        // 4) CPI Raydium CPMM `initialize` (creator is a real signer -> plain invoke).
        // Order creator token accounts + amounts to Raydium's token_0<token_1.
        let (creator_0, creator_1) = if coin_is_0 {
            (ctx.accounts.creator_coin.to_account_info(), ctx.accounts.creator_wsol.to_account_info())
        } else {
            (ctx.accounts.creator_wsol.to_account_info(), ctx.accounts.creator_coin.to_account_info())
        };
        let (amount_0, amount_1) = if coin_is_0 { (coin_tokens, wsol_liquidity) } else { (wsol_liquidity, coin_tokens) };

        let metas = vec![
            AccountMeta::new(ctx.accounts.creator.key(), true),
            AccountMeta::new_readonly(ctx.accounts.amm_config.key(), false),
            AccountMeta::new_readonly(ctx.accounts.authority.key(), false),
            AccountMeta::new(ctx.accounts.pool_state.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_0_mint.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_1_mint.key(), false),
            AccountMeta::new(ctx.accounts.lp_mint.key(), false),
            AccountMeta::new(creator_0.key(), false),
            AccountMeta::new(creator_1.key(), false),
            AccountMeta::new(ctx.accounts.creator_lp_token.key(), false),
            AccountMeta::new(ctx.accounts.token_0_vault.key(), false),
            AccountMeta::new(ctx.accounts.token_1_vault.key(), false),
            AccountMeta::new(ctx.accounts.create_pool_fee.key(), false),
            AccountMeta::new(ctx.accounts.observation_state.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_0_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_1_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.associated_token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.rent.key(), false),
        ];
        let mut data = RAYDIUM_INITIALIZE_IX.to_vec();
        data.extend_from_slice(&amount_0.to_le_bytes());
        data.extend_from_slice(&amount_1.to_le_bytes());
        data.extend_from_slice(&open_time.to_le_bytes());
        let ix = Instruction { program_id: ctx.accounts.cp_swap_program.key(), accounts: metas, data };
        invoke(
            &ix,
            &[
                ctx.accounts.creator.to_account_info(),
                ctx.accounts.amm_config.to_account_info(),
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.pool_state.to_account_info(),
                ctx.accounts.token_0_mint.to_account_info(),
                ctx.accounts.token_1_mint.to_account_info(),
                ctx.accounts.lp_mint.to_account_info(),
                creator_0,
                creator_1,
                ctx.accounts.creator_lp_token.to_account_info(),
                ctx.accounts.token_0_vault.to_account_info(),
                ctx.accounts.token_1_vault.to_account_info(),
                ctx.accounts.create_pool_fee.to_account_info(),
                ctx.accounts.observation_state.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.token_0_program.to_account_info(),
                ctx.accounts.token_1_program.to_account_info(),
                ctx.accounts.associated_token_program.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.rent.to_account_info(),
            ],
        )?;

        // 5) burn the LP the pool minted to the creator -> permanent locked liquidity
        let lp = {
            let acc = ctx.accounts.creator_lp_token.to_account_info();
            let data = acc.try_borrow_data()?;
            TokenAccount::try_deserialize(&mut &data[..])?.amount
        };
        require!(lp > 0, RatchetError::InvalidPool);
        {
            token::burn(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Burn {
                        mint: ctx.accounts.lp_mint.to_account_info(),
                        from: ctx.accounts.creator_lp_token.to_account_info(),
                        authority: ctx.accounts.creator.to_account_info(),
                    },
                ),
                lp,
            )?;
        }

        require_keys_eq!(*ctx.accounts.pool_state.owner, CPMM, RatchetError::InvalidPool);
        let lp_info = ctx.accounts.lp_mint.to_account_info();
        require_keys_eq!(*lp_info.owner, token::ID, RatchetError::InvalidPool);
        let lp_data = lp_info.try_borrow_data()?;
        let lp_mint = Mint::try_deserialize(&mut &lp_data[..])?;
        require!(lp_mint.supply == 0, RatchetError::InvalidPool);
        let c = &mut ctx.accounts.bonding_curve;
        c.graduated = true;
        c.real_sol = 0;
        c.floor_vault = retained_floor;
        c.circulating = ctx.accounts.mint.supply as u128;
        c.raydium_pool = ctx.accounts.pool_state.key();
        emit!(MigrateRaydiumEvent {
            mint: our_mint, pool: ctx.accounts.pool_state.key(),
            coin_tokens, wsol_liquidity, lp_burned: lp,
        });
        Ok(())
    }

    /// Redeem any holder's tokens at the fixed, fully backed post-migration floor.
    /// External market buys/sells do not call this program or charge Ratchet taxes.
    pub fn redeem_floor(ctx: Context<Trade>, tokens_in: u64, min_sol_out: u64) -> Result<()> {
        let c = &mut ctx.accounts.bonding_curve;
        require!(c.graduated, RatchetError::NotComplete);
        require!(tokens_in > 0 && tokens_in as u128 <= c.circulating, RatchetError::BadAmount);
        let out = u64::try_from(tokens_in as u128 * c.floor_scaled / SCALE)
            .map_err(|_| RatchetError::BadAmount)?;
        require!(out > 0 && out <= c.floor_vault, RatchetError::BadAmount);
        require!(out >= min_sol_out, RatchetError::Slippage);
        token::burn(CpiContext::new(ctx.accounts.token_program.to_account_info(), Burn {
            mint: ctx.accounts.mint.to_account_info(), from: ctx.accounts.user_ata.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        }), tokens_in)?;
        vault_pay(&ctx.accounts.system_program.to_account_info(), &ctx.accounts.sol_vault.to_account_info(),
            &ctx.accounts.user.to_account_info(), &c.mint, ctx.bumps.sol_vault, out)?;
        c.floor_vault -= out;
        c.circulating -= tokens_in as u128;
        emit_trade(c, ctx.accounts.user.key(), false, out, tokens_in, true, false);
        Ok(())
    }
}

/// Raise the floor to vault/circulating if higher. Returns true on a click.
fn ratchet(c: &mut BondingCurve) -> bool {
    if c.circulating == 0 { return false; }
    let candidate = c.floor_vault as u128 * SCALE / c.circulating;
    if candidate > c.floor_scaled {
        c.floor_scaled = candidate;
        true
    } else {
        false
    }
}

/// Pay lamports OUT of the system-owned SOL vault PDA ([b"sol", mint]) via an invoke_signed
/// system transfer. This is the v3 replacement for the v2 raw `try_borrow_mut_lamports` writes:
/// the vault is system-owned with 0 data, so it can't be raw-written by this program, but it CAN
/// sign a system transfer with its seeds — a proper CPI, so lamports balance at the CPI boundary.
/// The caller must keep the vault >= rent-exempt(0) after the move (or drain it to exactly 0).
fn vault_pay<'info>(
    system_program: &AccountInfo<'info>,
    sol_vault: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    mint: &Pubkey,
    vault_bump: u8,
    lamports: u64,
) -> Result<()> {
    let seeds: &[&[u8]] = &[b"sol", mint.as_ref(), &[vault_bump]];
    system_program::transfer(
        CpiContext::new_with_signer(
            system_program.clone(),
            system_program::Transfer { from: sol_vault.clone(), to: to.clone() },
            &[seeds],
        ),
        lamports,
    )
}

fn emit_trade(c: &BondingCurve, user: Pubkey, is_buy: bool, sol: u64, tokens: u64, floor: bool, clicked: bool) {
    emit!(TradeEvent {
        mint: c.mint, user, is_buy, sol_amount: sol, token_amount: tokens,
        paid_from_floor: floor, clicked,
        virtual_sol: c.virtual_sol, virtual_token: c.virtual_token, real_token: c.real_token,
        floor_vault: c.floor_vault, floor_scaled: c.floor_scaled, complete: c.complete,
    });
}

#[account]
#[derive(InitSpace)]
pub struct Global {
    pub admin: Pubkey,
    pub virtual_sol: u128,
    pub virtual_token: u128,
    pub real_token: u128,
    pub total_supply: u64,
    pub fee_bps: u16,
    pub floor_cut_bps: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BondingCurve {
    pub mint: Pubkey,
    pub creator: Pubkey,
    #[max_len(32)]
    pub name: String,
    #[max_len(10)]
    pub symbol: String,
    #[max_len(200)]
    pub uri: String,
    pub initial_real_token: u128,
    pub sell_fee_bps: u16, // per-coin SELL tax -> floor (creator's choice, 125..=500 bps)
    pub virtual_sol: u128,
    pub virtual_token: u128,
    pub real_sol: u128,
    pub real_token: u128,
    pub circulating: u128,
    pub floor_vault: u64,
    pub floor_scaled: u128,
    pub complete: bool,
    pub graduated: bool,
    pub raydium_pool: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Global::INIT_SPACE, seeds = [b"global"], bump)]
    pub global: Account<'info, Global>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Create<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: creator attribution is bound to the paying signer.
    #[account(address = payer.key())]
    pub creator: UncheckedAccount<'info>,
    #[account(seeds = [b"global"], bump = global.bump)]
    pub global: Account<'info, Global>,
    #[account(
        init, payer = payer, mint::decimals = 6, mint::authority = bonding_curve,
    )]
    pub mint: Account<'info, Mint>,
    #[account(
        init, payer = payer, space = 8 + BondingCurve::INIT_SPACE,
        seeds = [b"curve", mint.key().as_ref()], bump,
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    /// System-owned SOL vault PDA (holds ALL of the coin's lamports; seeded rent-exempt here).
    /// Not `init` — it stays a 0-data system account so it can sign system transfers out.
    #[account(mut, seeds = [b"sol", mint.key().as_ref()], bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(
        init, payer = payer,
        associated_token::mint = mint, associated_token::authority = bonding_curve,
    )]
    pub curve_vault: Account<'info, TokenAccount>,
    // receives the dev's launch-buy tokens (empty if dev_buy == 0)
    #[account(
        init_if_needed, payer = payer,
        associated_token::mint = mint, associated_token::authority = payer,
    )]
    pub dev_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    /// CHECK: canonical immutable Metaplex metadata PDA; initialized by the pinned program.
    #[account(mut, seeds = [b"metadata", METADATA_PROGRAM.as_ref(), mint.key().as_ref()],
        bump, seeds::program = METADATA_PROGRAM)]
    pub metadata: UncheckedAccount<'info>,
    /// CHECK: pinned Metaplex executable.
    #[account(address = METADATA_PROGRAM, executable)]
    pub metadata_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [b"global"], bump = global.bump)]
    pub global: Account<'info, Global>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"curve", mint.key().as_ref()], bump = bonding_curve.bump,
        has_one = mint)]
    pub bonding_curve: Account<'info, BondingCurve>,
    /// System-owned SOL vault PDA — all of the coin's lamports (reserves + floor) live here.
    #[account(mut, seeds = [b"sol", mint.key().as_ref()], bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = bonding_curve)]
    pub curve_vault: Account<'info, TokenAccount>,
    #[account(init_if_needed, payer = user,
        associated_token::mint = mint, associated_token::authority = user)]
    pub user_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MigrateToRaydium<'info> {
    #[account(mut)]
    pub creator: Signer<'info>, // permissionless crank; pre-funded from curve reserves
    #[account(mut, seeds = [b"curve", mint.key().as_ref()], bump = bonding_curve.bump, has_one = mint)]
    pub bonding_curve: Account<'info, BondingCurve>,
    pub mint: Account<'info, Mint>,
    /// System-owned SOL vault PDA — the program invoke_signed's the pooled wSOL straight out of
    /// here (no crank fronting) and pre-funds the crank cost reserve from it.
    #[account(mut, seeds = [b"sol", mint.key().as_ref()], bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = bonding_curve)]
    pub curve_vault: Account<'info, TokenAccount>,
    /// CHECK: sender's coin ATA — created IN-HANDLER funded from the step-0 pool pre-fund (create_idempotent
    /// enforces it is the canonical ATA of (mint, creator)); not charged to the sender upfront.
    #[account(mut)]
    pub creator_coin: UncheckedAccount<'info>,
    #[account(address = WSOL_MINT)]
    pub wsol_mint: Account<'info, Mint>,
    /// CHECK: sender's wSOL ATA — created in-handler from the pre-fund (create_idempotent enforces the
    /// canonical ATA of (wsol_mint, creator)).
    #[account(mut)]
    pub creator_wsol: UncheckedAccount<'info>,
    // --- Raydium CPMM `initialize` accounts (derived client-side, forwarded to the CPI) ---
    /// CHECK: pinned executable Raydium CPMM deployment.
    #[account(address = CPMM, executable)]
    pub cp_swap_program: UncheckedAccount<'info>,
    /// CHECK: canonical index-0 config validated in handler; owned by pinned CPMM.
    #[account(owner = CPMM)]
    pub amm_config: UncheckedAccount<'info>,
    /// CHECK: Raydium authority PDA
    pub authority: UncheckedAccount<'info>,
    /// CHECK: pool state (init by Raydium)
    #[account(mut)] pub pool_state: UncheckedAccount<'info>,
    /// CHECK: token_0 mint (this coin or wSOL, per Raydium ordering)
    pub token_0_mint: UncheckedAccount<'info>,
    /// CHECK: token_1 mint
    pub token_1_mint: UncheckedAccount<'info>,
    /// CHECK: LP mint (init by Raydium)
    #[account(mut)] pub lp_mint: UncheckedAccount<'info>,
    /// CHECK: creator LP token account (init by Raydium)
    #[account(mut)] pub creator_lp_token: UncheckedAccount<'info>,
    /// CHECK: token_0 vault (init by Raydium)
    #[account(mut)] pub token_0_vault: UncheckedAccount<'info>,
    /// CHECK: token_1 vault (init by Raydium)
    #[account(mut)] pub token_1_vault: UncheckedAccount<'info>,
    /// CHECK: create-pool fee receiver (fixed address, Raydium validates)
    #[account(mut, address = POOL_FEE)] pub create_pool_fee: UncheckedAccount<'info>,
    /// CHECK: observation state (init by Raydium)
    #[account(mut)] pub observation_state: UncheckedAccount<'info>,
    /// CHECK: token program for token_0
    #[account(address = token::ID)]
    pub token_0_program: UncheckedAccount<'info>,
    /// CHECK: token program for token_1
    #[account(address = token::ID)]
    pub token_1_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[event]
pub struct CreateEvent { pub mint: Pubkey, pub creator: Pubkey, pub name: String, pub symbol: String, pub dev_buy: u64 }

#[event]
pub struct TradeEvent {
    pub mint: Pubkey, pub user: Pubkey, pub is_buy: bool,
    pub sol_amount: u64, pub token_amount: u64, pub paid_from_floor: bool, pub clicked: bool,
    pub virtual_sol: u128, pub virtual_token: u128, pub real_token: u128,
    pub floor_vault: u64, pub floor_scaled: u128, pub complete: bool,
}

#[event]
pub struct MigrateRaydiumEvent { pub mint: Pubkey, pub pool: Pubkey, pub coin_tokens: u64, pub wsol_liquidity: u64, pub lp_burned: u64 }

#[error_code]
pub enum RatchetError {
    #[msg("bad parameters")] BadParams,
    #[msg("bad amount")] BadAmount,
    #[msg("curve complete")] Complete,
    #[msg("curve not complete")] NotComplete,
    #[msg("slippage exceeded")] Slippage,
    #[msg("unauthorized")] Unauthorized,
    #[msg("coin has migrated; use Raydium or redeem_floor")] AlreadyMigrated,
    #[msg("invalid Raydium pool or accounts")] InvalidPool,
    #[msg("reserves cannot cover full-supply floor backing and migration costs")] InsufficientMigrationReserves,
}

fn floor_backing(supply: u64, floor: u128) -> Result<u64> {
    let liability = (supply as u128).checked_mul(floor).ok_or(RatchetError::BadAmount)?;
    let rounded = liability / SCALE + u128::from(liability % SCALE != 0);
    u64::try_from(rounded).map_err(|_| error!(RatchetError::BadAmount))
}

fn validate_raydium_accounts(a: &MigrateToRaydium) -> Result<()> {
    let derive = |seeds: &[&[u8]]| Pubkey::find_program_address(seeds, &CPMM).0;
    require_keys_eq!(a.amm_config.key(), derive(&[b"amm_config", &0u16.to_be_bytes()]), RatchetError::InvalidPool);
    let t0 = a.token_0_mint.key();
    let t1 = a.token_1_mint.key();
    require!(t0 < t1, RatchetError::InvalidPool);
    let pool = derive(&[b"pool", a.amm_config.key().as_ref(), t0.as_ref(), t1.as_ref()]);
    require_keys_eq!(a.pool_state.key(), pool, RatchetError::InvalidPool);
    require_keys_eq!(a.authority.key(), derive(&[b"vault_and_lp_mint_auth_seed"]), RatchetError::InvalidPool);
    require_keys_eq!(a.lp_mint.key(), derive(&[b"pool_lp_mint", pool.as_ref()]), RatchetError::InvalidPool);
    require_keys_eq!(a.token_0_vault.key(), derive(&[b"pool_vault", pool.as_ref(), t0.as_ref()]), RatchetError::InvalidPool);
    require_keys_eq!(a.token_1_vault.key(), derive(&[b"pool_vault", pool.as_ref(), t1.as_ref()]), RatchetError::InvalidPool);
    require_keys_eq!(a.observation_state.key(), derive(&[b"observation", pool.as_ref()]), RatchetError::InvalidPool);
    let lp_ata = anchor_spl::associated_token::get_associated_token_address(&a.creator.key(), &a.lp_mint.key());
    require_keys_eq!(a.creator_lp_token.key(), lp_ata, RatchetError::InvalidPool);
    Ok(())
}
