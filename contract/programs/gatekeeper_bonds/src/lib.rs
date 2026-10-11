//! GateKeeper bonds: SKR escrow for ticket transfers + SKR burn for VIP upgrades.
//!
//! The mint is stored in `Config`, so the SAME program works with a mock "tSKR" on devnet
//! and the real SKR mint on mainnet. Nothing here is devnet-specific.
//!
//! Trust model: a compressed NFT transfer cannot be inspected from this program, so the
//! `authority` (the organizer / GateKeeper oracle) decides whether a bond is returned or
//! slashed. Returned -> back to the seller. Slashed -> to the treasury.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

declare_id!("9AgLUBrzQHkaQWyqwtThjAERYKv4tgtnoxrhpSCvZoqM");

pub const CONFIG_SEED: &[u8] = b"config";
pub const VAULT_SEED: &[u8] = b"vault";
pub const BOND_SEED: &[u8] = b"bond";
pub const VIP_SEED: &[u8] = b"vip";
pub const STAKE_CFG_SEED: &[u8] = b"stake_cfg";
pub const STAKE_VAULT_SEED: &[u8] = b"stake_vault";
pub const ORG_SEED: &[u8] = b"organizer";

#[program]
pub mod gatekeeper_bonds {
    use super::*;

    /// One-time setup. `authority` also pays rent here.
    pub fn initialize(ctx: Context<Initialize>, bond_amount: u64, vip_burn_amount: u64) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.skr_mint = ctx.accounts.skr_mint.key();
        c.treasury = ctx.accounts.treasury.key();
        c.bond_amount = bond_amount;
        c.vip_burn_amount = vip_burn_amount;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Seller escrows the bond before a ticket transfer. `payer` covers rent so the
    /// seller needs no SOL (the backend relays as fee payer).
    pub fn lock_transfer_bond(ctx: Context<LockTransferBond>, asset_id: Pubkey) -> Result<()> {
        let amount = ctx.accounts.config.bond_amount;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.seller_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            amount,
        )?;

        let b = &mut ctx.accounts.bond;
        b.seller = ctx.accounts.seller.key();
        b.asset_id = asset_id;
        b.amount = amount;
        b.created_at = Clock::get()?.unix_timestamp;
        b.bump = ctx.bumps.bond;

        emit!(BondLocked { asset_id, seller: b.seller, amount });
        Ok(())
    }

    /// Authority resolves a bond. slash=false -> refund seller, slash=true -> treasury.
    /// The bond account is closed (rent returns to the authority) so the asset can be bonded again.
    pub fn resolve_bond(ctx: Context<ResolveBond>, slash: bool) -> Result<()> {
        let config = &ctx.accounts.config;
        let bond = &ctx.accounts.bond;
        let dest = &ctx.accounts.destination;

        let dest_ok = if slash {
            dest.key() == config.treasury
        } else {
            dest.owner == bond.seller && dest.mint == config.skr_mint
        };
        require!(dest_ok, GkError::BadDestination);

        let seeds: &[&[u8]] = &[CONFIG_SEED, &[config.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            bond.amount,
        )?;

        emit!(BondResolved {
            asset_id: bond.asset_id,
            seller: bond.seller,
            amount: bond.amount,
            slashed: slash
        });
        Ok(())
    }

    /// Burn SKR to mark a ticket as VIP. Creates a receipt PDA; the backend/app reads
    /// that receipt to show VIP status. The backend verifies cNFT ownership before
    /// building this tx (the program cannot see compressed NFT ownership).
    pub fn burn_for_vip(ctx: Context<BurnForVip>, asset_id: Pubkey) -> Result<()> {
        let amount = ctx.accounts.config.vip_burn_amount;

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.skr_mint.to_account_info(),
                    from: ctx.accounts.owner_token.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;

        let r = &mut ctx.accounts.vip_receipt;
        r.owner = ctx.accounts.owner.key();
        r.asset_id = asset_id;
        r.amount = amount;
        r.burned_at = Clock::get()?.unix_timestamp;
        r.bump = ctx.bumps.vip_receipt;

        emit!(VipUpgraded { asset_id, owner: r.owner, amount });
        Ok(())
    }

    // ------------------------------------------------------------ organizer stake (additive: no change to Config)

    /// One-time. Creates the stake settings + the stake vault. Authority only.
    pub fn init_stake_config(ctx: Context<InitStakeConfig>, amount: u64) -> Result<()> {
        let c = &mut ctx.accounts.stake_cfg;
        c.amount = amount;
        c.bump = ctx.bumps.stake_cfg;
        Ok(())
    }

    /// Change the required stake (e.g. when the SKR price moves). Authority only.
    pub fn set_stake_amount(ctx: Context<SetStakeAmount>, amount: u64) -> Result<()> {
        ctx.accounts.stake_cfg.amount = amount;
        Ok(())
    }

    /// Lock the required SKR to become an organizer. `payer` covers rent.
    pub fn stake_organizer(ctx: Context<StakeOrganizer>) -> Result<()> {
        let amount = ctx.accounts.stake_cfg.amount;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.organizer_token.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                    authority: ctx.accounts.organizer.to_account_info(),
                },
            ),
            amount,
        )?;
        let s = &mut ctx.accounts.organizer_stake;
        s.owner = ctx.accounts.organizer.key();
        s.amount = amount;
        s.staked_at = Clock::get()?.unix_timestamp;
        s.bump = ctx.bumps.organizer_stake;
        Ok(())
    }

    /// Get the stake back and stop being an organizer.
    pub fn unstake_organizer(ctx: Context<UnstakeOrganizer>) -> Result<()> {
        let config = &ctx.accounts.config;
        let seeds: &[&[u8]] = &[CONFIG_SEED, &[config.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.stake_vault.to_account_info(),
                    to: ctx.accounts.organizer_token.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            ctx.accounts.organizer_stake.amount,
        )
    }

    /// Authority punishes an abusive organizer: stake goes to the treasury.
    pub fn slash_organizer(ctx: Context<SlashOrganizer>) -> Result<()> {
        let config = &ctx.accounts.config;
        let seeds: &[&[u8]] = &[CONFIG_SEED, &[config.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.stake_vault.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            ctx.accounts.organizer_stake.amount,
        )
    }
}

// ---------------------------------------------------------------- accounts

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init, payer = authority, space = 8 + Config::SIZE,
        seeds = [CONFIG_SEED], bump
    )]
    pub config: Account<'info, Config>,

    pub skr_mint: Account<'info, Mint>,

    /// Where slashed bonds go. Must be a token account of `skr_mint`.
    #[account(token::mint = skr_mint)]
    pub treasury: Account<'info, TokenAccount>,

    #[account(
        init, payer = authority,
        seeds = [VAULT_SEED], bump,
        token::mint = skr_mint, token::authority = config
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(asset_id: Pubkey)]
pub struct LockTransferBond<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init, payer = payer, space = 8 + Bond::SIZE,
        seeds = [BOND_SEED, asset_id.as_ref()], bump
    )]
    pub bond: Account<'info, Bond>,

    #[account(
        mut,
        token::mint = config.skr_mint,
        token::authority = seller
    )]
    pub seller_token: Account<'info, TokenAccount>,

    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveBond<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,

    #[account(
        mut, close = authority,
        seeds = [BOND_SEED, bond.asset_id.as_ref()], bump = bond.bump
    )]
    pub bond: Account<'info, Bond>,

    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault: Account<'info, TokenAccount>,

    /// Seller's SKR token account (refund) or the treasury (slash); checked in the handler.
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(asset_id: Pubkey)]
pub struct BurnForVip<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init, payer = payer, space = 8 + VipReceipt::SIZE,
        seeds = [VIP_SEED, asset_id.as_ref()], bump
    )]
    pub vip_receipt: Account<'info, VipReceipt>,

    #[account(mut, address = config.skr_mint)]
    pub skr_mint: Account<'info, Mint>,

    #[account(mut, token::mint = skr_mint, token::authority = owner)]
    pub owner_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitStakeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,

    #[account(
        init, payer = authority, space = 8 + StakeConfig::SIZE,
        seeds = [STAKE_CFG_SEED], bump
    )]
    pub stake_cfg: Account<'info, StakeConfig>,

    #[account(address = config.skr_mint)]
    pub skr_mint: Account<'info, Mint>,

    #[account(
        init, payer = authority,
        seeds = [STAKE_VAULT_SEED], bump,
        token::mint = skr_mint, token::authority = config
    )]
    pub stake_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SetStakeAmount<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [STAKE_CFG_SEED], bump = stake_cfg.bump)]
    pub stake_cfg: Account<'info, StakeConfig>,
}

#[derive(Accounts)]
pub struct StakeOrganizer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub organizer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(seeds = [STAKE_CFG_SEED], bump = stake_cfg.bump)]
    pub stake_cfg: Account<'info, StakeConfig>,

    #[account(
        init, payer = payer, space = 8 + OrganizerStake::SIZE,
        seeds = [ORG_SEED, organizer.key().as_ref()], bump
    )]
    pub organizer_stake: Account<'info, OrganizerStake>,

    #[account(mut, token::mint = config.skr_mint, token::authority = organizer)]
    pub organizer_token: Account<'info, TokenAccount>,

    #[account(mut, seeds = [STAKE_VAULT_SEED], bump)]
    pub stake_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnstakeOrganizer<'info> {
    #[account(mut)]
    pub organizer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut, close = organizer,
        seeds = [ORG_SEED, organizer.key().as_ref()], bump = organizer_stake.bump
    )]
    pub organizer_stake: Account<'info, OrganizerStake>,

    #[account(mut, token::mint = config.skr_mint, token::authority = organizer)]
    pub organizer_token: Account<'info, TokenAccount>,

    #[account(mut, seeds = [STAKE_VAULT_SEED], bump)]
    pub stake_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SlashOrganizer<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,

    #[account(
        mut, close = authority,
        seeds = [ORG_SEED, organizer_stake.owner.as_ref()], bump = organizer_stake.bump
    )]
    pub organizer_stake: Account<'info, OrganizerStake>,

    #[account(mut, seeds = [STAKE_VAULT_SEED], bump)]
    pub stake_vault: Account<'info, TokenAccount>,

    #[account(mut, address = config.treasury)]
    pub treasury: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ---------------------------------------------------------------- state

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub skr_mint: Pubkey,
    pub treasury: Pubkey,
    pub bond_amount: u64,
    pub vip_burn_amount: u64,
    pub bump: u8,
}
impl Config {
    pub const SIZE: usize = 32 * 3 + 8 + 8 + 1;
}

#[account]
pub struct Bond {
    pub seller: Pubkey,
    pub asset_id: Pubkey,
    pub amount: u64,
    pub created_at: i64,
    pub bump: u8,
}
impl Bond {
    pub const SIZE: usize = 32 * 2 + 8 + 8 + 1;
}

#[account]
pub struct VipReceipt {
    pub owner: Pubkey,
    pub asset_id: Pubkey,
    pub amount: u64,
    pub burned_at: i64,
    pub bump: u8,
}
impl VipReceipt {
    pub const SIZE: usize = 32 * 2 + 8 + 8 + 1;
}

#[account]
pub struct StakeConfig {
    pub amount: u64,
    pub bump: u8,
}
impl StakeConfig {
    pub const SIZE: usize = 8 + 1;
}

#[account]
pub struct OrganizerStake {
    pub owner: Pubkey,
    pub amount: u64,
    pub staked_at: i64,
    pub bump: u8,
}
impl OrganizerStake {
    pub const SIZE: usize = 32 + 8 + 8 + 1;
}

// ---------------------------------------------------------------- events / errors

#[event]
pub struct BondLocked {
    pub asset_id: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
}
#[event]
pub struct BondResolved {
    pub asset_id: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub slashed: bool,
}
#[event]
pub struct VipUpgraded {
    pub asset_id: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum GkError {
    #[msg("Destination token account is not valid for this resolution")]
    BadDestination,
}
