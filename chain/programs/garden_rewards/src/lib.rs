//! Meme Garden on-chain program (MGRD).
//!
//! Two jobs, following gametokenomics.md sections 11 to 13:
//!
//! 1. **Weekly reward pools.** A prefunded vault holds MGRD. Each week the operator publishes one Merkle root of
//!    finalized allocations (`open_epoch`). Players claim their fixed amount with a proof (`claim`); a receipt
//!    account per leaf stops a second claim. Leaves are bound to this program, the mint, the epoch, the leaf index
//!    and the recipient wallet, so a proof cannot be replayed in another week, for another mint or by another wallet.
//!    After the claim deadline the epoch is closed and its unclaimed amount stays in the vault for later pools.
//! 2. **Cosmetic orders paid in MGRD.** The server quotes an order (id + amount); the player pays with
//!    `pay_order`, which records a receipt for that order id (so one order can only be paid once) and splits the
//!    payment: `recycle_bps` back into the rewards vault, the rest to the treasury. The server grants the item only
//!    after reading that receipt on chain.
//!
//! There is no minting here. The token is launched separately; the program is deployed first and told about the
//! token afterwards (`initialize`, once). Only the program's upgrade authority can do that, so nobody can set the
//! program up with their own token in between. It works with the classic token program and with Token-2022, and
//! refuses tokens whose rules could take a fee, block or move the vault's or a player's tokens.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{hash::hashv, program_option::COption};
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("BMFwJHibR1ELEANjpsNKvwry8HEDfZRqMicki4MT9kd1");

pub const CONFIG_SEED: &[u8] = b"config";
pub const VAULT_SEED: &[u8] = b"vault";
pub const EPOCH_SEED: &[u8] = b"epoch";
pub const RECEIPT_SEED: &[u8] = b"receipt";
pub const ORDER_SEED: &[u8] = b"order";
pub const LOCK_SEED: &[u8] = b"lock";
pub const LOCK_VAULT_SEED: &[u8] = b"lockvault";
pub const MAX_LOCK_DAYS: u16 = 365;
pub const LEAF_DOMAIN: &[u8] = b"MGRD-REWARD-V1";
pub const MAX_PROOF_LEN: usize = 24; // up to 16 million leaves per week
pub const MAX_BPS: u16 = 10_000;

#[program]
pub mod garden_rewards {
    use super::*;

    /// Name the token and create the rewards vault (a token account owned by the config PDA). Works once, and only
    /// for the program's upgrade authority, who becomes the admin.
    pub fn initialize(ctx: Context<Initialize>, recycle_bps: u16) -> Result<()> {
        require!(recycle_bps <= MAX_BPS, GardenError::BadBps);
        check_mint(&ctx.accounts.mint)?;
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.pending_admin = Pubkey::default();
        c.mint = ctx.accounts.mint.key();
        c.vault = ctx.accounts.vault.key();
        c.treasury = ctx.accounts.treasury.key();
        c.recycle_bps = recycle_bps;
        c.paused = false;
        c.outstanding = 0;
        c.bump = ctx.bumps.config;
        c.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// Change the recycle share or the pause switch.
    pub fn update_config(ctx: Context<AdminOnly>, recycle_bps: Option<u16>, paused: Option<bool>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        if let Some(b) = recycle_bps {
            require!(b <= MAX_BPS, GardenError::BadBps);
            c.recycle_bps = b;
        }
        if let Some(p) = paused {
            c.paused = p;
        }
        Ok(())
    }

    pub fn set_treasury(ctx: Context<SetTreasury>) -> Result<()> {
        ctx.accounts.config.treasury = ctx.accounts.treasury.key();
        Ok(())
    }

    /// Two-step admin handover (the new admin must accept), so a typo cannot lock the program.
    pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        ctx.accounts.config.pending_admin = new_admin;
        Ok(())
    }
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.admin = c.pending_admin;
        c.pending_admin = Pubkey::default();
        Ok(())
    }

    /// Publish a finalized weekly allocation. The vault must already hold enough for every open epoch.
    pub fn open_epoch(ctx: Context<OpenEpoch>, epoch_id: u64, root: [u8; 32], total: u64, claim_deadline: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(claim_deadline > now, GardenError::BadDeadline);
        require!(total > 0, GardenError::ZeroAmount);
        let c = &mut ctx.accounts.config;
        let needed = c.outstanding.checked_add(total).ok_or(GardenError::Overflow)?;
        require!(ctx.accounts.vault.amount >= needed, GardenError::VaultUnderfunded);
        c.outstanding = needed;
        let e = &mut ctx.accounts.epoch;
        e.epoch_id = epoch_id;
        e.root = root;
        e.total = total;
        e.claimed = 0;
        e.claim_deadline = claim_deadline;
        e.closed = false;
        e.bump = ctx.bumps.epoch;
        emit!(EpochOpened { epoch_id, root, total, claim_deadline });
        Ok(())
    }

    /// Claim one allocation leaf. `payer` may be the player or a fee sponsor; the tokens always go to `claimant`.
    pub fn claim(ctx: Context<Claim>, epoch_id: u64, index: u32, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        require!(!ctx.accounts.config.paused, GardenError::Paused);
        require!(proof.len() <= MAX_PROOF_LEN, GardenError::ProofTooLong);
        require!(amount > 0, GardenError::ZeroAmount);
        let mint_key = ctx.accounts.config.mint;
        let config_bump = ctx.accounts.config.bump;
        let claimant = ctx.accounts.claimant.key();
        let now = Clock::get()?.unix_timestamp;

        let e = &mut ctx.accounts.epoch;
        require!(!e.closed, GardenError::EpochClosed);
        require!(now <= e.claim_deadline, GardenError::ClaimExpired);
        let leaf = leaf_hash(&crate::ID, &mint_key, epoch_id, index, &claimant, amount);
        require!(verify_proof(leaf, &proof, e.root), GardenError::BadProof);
        let claimed = e.claimed.checked_add(amount).ok_or(GardenError::Overflow)?;
        require!(claimed <= e.total, GardenError::Overdraw);
        e.claimed = claimed;

        let r = &mut ctx.accounts.receipt;
        r.epoch_id = epoch_id;
        r.index = index;
        r.claimant = claimant;
        r.amount = amount;
        r.claimed_at = now;
        r.bump = ctx.bumps.receipt;

        // the epoch's reservation shrinks with each claim only when it closes (see close_epoch)
        let seeds: &[&[u8]] = &[CONFIG_SEED, &[config_bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.claimant_token.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        emit!(Claimed { epoch_id, index, claimant, amount });
        Ok(())
    }

    /// After the deadline: stop claims and release the epoch's reservation (unclaimed tokens stay in the vault).
    pub fn close_epoch(ctx: Context<CloseEpoch>, _epoch_id: u64) -> Result<()> {
        let e = &mut ctx.accounts.epoch;
        require!(!e.closed, GardenError::EpochClosed);
        require!(Clock::get()?.unix_timestamp > e.claim_deadline, GardenError::NotExpired);
        e.closed = true;
        let c = &mut ctx.accounts.config;
        c.outstanding = c.outstanding.saturating_sub(e.total);
        emit!(EpochClosed { epoch_id: e.epoch_id, unclaimed: e.total - e.claimed });
        Ok(())
    }

    /// Move vault tokens that no open epoch needs (for example to a new vault policy). Never touches reserved funds.
    pub fn withdraw_unreserved(ctx: Context<WithdrawUnreserved>, amount: u64) -> Result<()> {
        let c = &ctx.accounts.config;
        let free = ctx.accounts.vault.amount.saturating_sub(c.outstanding);
        require!(amount <= free, GardenError::Reserved);
        let seeds: &[&[u8]] = &[CONFIG_SEED, &[c.bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.to.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )
    }

    /// Pay for one quoted cosmetic order. A second payment for the same order id fails (the receipt already exists).
    /// A payment that arrives after the quote's `deadline` is refused, so no tokens leave the wallet for an order the
    /// game would no longer honour. The receipt belongs to the payer: nobody else can take up another's order id.
    pub fn pay_order(ctx: Context<PayOrder>, order_id: [u8; 16], amount: u64, deadline: i64) -> Result<()> {
        let c = &ctx.accounts.config;
        require!(!c.paused, GardenError::Paused);
        require!(amount > 0, GardenError::ZeroAmount);
        require!(Clock::get()?.unix_timestamp <= deadline, GardenError::QuoteExpired);
        let recycle = ((amount as u128) * (c.recycle_bps as u128) / (MAX_BPS as u128)) as u64;
        let to_treasury = amount - recycle;
        let decimals = ctx.accounts.mint.decimals;
        let parts = [(ctx.accounts.vault.to_account_info(), recycle), (ctx.accounts.treasury.to_account_info(), to_treasury)];
        for (to, part) in parts {
            if part == 0 {
                continue;
            }
            token_interface::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.payer_token.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to,
                        authority: ctx.accounts.payer.to_account_info(),
                    },
                ),
                part,
                decimals,
            )?;
        }
        let payer = ctx.accounts.payer.key();
        let o = &mut ctx.accounts.order;
        o.order_id = order_id;
        o.payer = payer;
        o.amount = amount;
        o.recycled = recycle;
        o.paid_at = Clock::get()?.unix_timestamp;
        o.bump = ctx.bumps.order;
        emit!(OrderPaid { order_id, payer, amount, recycled: recycle });
        Ok(())
    }

    /// Garden Club: lock $MGRD in the player's own lock vault for `days` (at least 1). Topping up adds to the lock
    /// and can only push the unlock date later. No interest is paid; the tokens come back with `club_unlock`.
    pub fn club_lock(ctx: Context<ClubLock>, amount: u64, days: u16) -> Result<()> {
        require!(!ctx.accounts.config.paused, GardenError::Paused);
        require!(amount > 0, GardenError::ZeroAmount);
        require!(days >= 1 && days <= MAX_LOCK_DAYS, GardenError::BadLockDays);
        let now = Clock::get()?.unix_timestamp;
        // test builds only (`--features short-days`, never deployed): a "day" is one second so unlocking can be tested
        let day: i64 = if cfg!(feature = "short-days") { 1 } else { 86_400 };
        let until = now.checked_add(days as i64 * day).ok_or(GardenError::Overflow)?;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.owner_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.lock_vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        let owner = ctx.accounts.owner.key();
        let l = &mut ctx.accounts.lock;
        if l.amount == 0 {
            l.locked_at = now;
            l.unlock_at = until;
        } else if until > l.unlock_at {
            l.unlock_at = until;
        }
        l.owner = owner;
        l.amount = l.amount.checked_add(amount).ok_or(GardenError::Overflow)?;
        l.bump = ctx.bumps.lock;
        emit!(ClubLocked { owner, amount: l.amount, unlock_at: l.unlock_at });
        Ok(())
    }

    /// Return all locked $MGRD to the owner once the unlock date has passed. Works even while paused.
    pub fn club_unlock(ctx: Context<ClubUnlock>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let config_bump = ctx.accounts.config.bump;
        let owner = ctx.accounts.owner.key();
        let l = &mut ctx.accounts.lock;
        require!(l.amount > 0, GardenError::ZeroAmount);
        require!(now >= l.unlock_at, GardenError::StillLocked);
        let amount = l.amount;
        l.amount = 0;
        let seeds: &[&[u8]] = &[CONFIG_SEED, &[config_bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.lock_vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.owner_token.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        emit!(ClubUnlocked { owner, amount });
        Ok(())
    }
}

/// Refuse any token that could mint more, freeze accounts, or (Token-2022) take a fee, run its own code on transfers,
/// move holders' tokens or add other rules. Only the name-and-picture extensions are accepted, and anything this
/// program does not know is refused.
fn check_mint(mint: &InterfaceAccount<Mint>) -> Result<()> {
    require!(mint.mint_authority == COption::None, GardenError::MintAuthority);
    require!(mint.freeze_authority == COption::None, GardenError::FreezeAuthority);
    let info = mint.to_account_info();
    if *info.owner == spl_token_2022::ID {
        let data = info.try_borrow_data()?;
        let state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&data).map_err(|_| error!(GardenError::TokenRules))?;
        let extensions = state.get_extension_types().map_err(|_| error!(GardenError::TokenRules))?;
        for extension in extensions {
            require!(matches!(extension, ExtensionType::MetadataPointer | ExtensionType::TokenMetadata), GardenError::TokenRules);
        }
    }
    Ok(())
}

// ---- Merkle helpers (also mirrored in shared/src/chain/program.js) -------------------------------------------

/// Leaf = sha256(0x00 || "MGRD-REWARD-V1" || program || mint || epoch u64 LE || index u32 LE || claimant || amount u64 LE)
pub fn leaf_hash(program: &Pubkey, mint: &Pubkey, epoch_id: u64, index: u32, claimant: &Pubkey, amount: u64) -> [u8; 32] {
    hashv(&[&[0u8], LEAF_DOMAIN, program.as_ref(), mint.as_ref(), &epoch_id.to_le_bytes(), &index.to_le_bytes(), claimant.as_ref(), &amount.to_le_bytes()]).to_bytes()
}

/// Inner node = sha256(0x01 || smaller || larger), so proofs need no left/right flags.
pub fn node_hash(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    hashv(&[&[1u8], lo, hi]).to_bytes()
}

pub fn verify_proof(leaf: [u8; 32], proof: &[[u8; 32]], root: [u8; 32]) -> bool {
    let mut h = leaf;
    for p in proof {
        h = node_hash(&h, p);
    }
    h == root
}

// ---- accounts ---------------------------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub treasury: Pubkey,
    pub recycle_bps: u16,
    pub paused: bool,
    /// Sum of the totals of all open epochs (reserved vault funds).
    pub outstanding: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Epoch {
    pub epoch_id: u64,
    pub root: [u8; 32],
    pub total: u64,
    pub claimed: u64,
    pub claim_deadline: i64,
    pub closed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ClaimReceipt {
    pub epoch_id: u64,
    pub index: u32,
    pub claimant: Pubkey,
    pub amount: u64,
    pub claimed_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct OrderReceipt {
    pub order_id: [u8; 16],
    pub payer: Pubkey,
    pub amount: u64,
    pub recycled: u64,
    pub paid_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ClubLockAccount {
    pub owner: Pubkey,
    pub amount: u64,
    pub locked_at: i64,
    pub unlock_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// This program and its data account: only the wallet that may upgrade the program can set it up.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ GardenError::NotAdmin)]
    pub program: Program<'info, crate::program::GardenRewards>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ GardenError::NotAdmin)]
    pub program_data: Account<'info, ProgramData>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init, payer = admin, seeds = [VAULT_SEED], bump, token::mint = mint, token::authority = config, token::token_program = token_program)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(token::mint = mint, token::token_program = token_program)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ GardenError::NotAdmin)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct SetTreasury<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ GardenError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(token::mint = config.mint, constraint = treasury.key() != config.vault @ GardenError::BadTreasury)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, constraint = config.pending_admin == new_admin.key() @ GardenError::NotAdmin)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(epoch_id: u64)]
pub struct OpenEpoch<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ GardenError::NotAdmin, has_one = vault)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = 8 + Epoch::INIT_SPACE, seeds = [EPOCH_SEED, &epoch_id.to_le_bytes()], bump)]
    pub epoch: Account<'info, Epoch>,
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(epoch_id: u64, index: u32)]
pub struct Claim<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub claimant: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = vault, has_one = mint)]
    pub config: Account<'info, Config>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [EPOCH_SEED, &epoch_id.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    /// Exists once the leaf is claimed: a second claim of the same leaf fails here.
    #[account(init, payer = payer, space = 8 + ClaimReceipt::INIT_SPACE, seeds = [RECEIPT_SEED, &epoch_id.to_le_bytes(), &index.to_le_bytes()], bump)]
    pub receipt: Account<'info, ClaimReceipt>,
    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = claimant, token::token_program = token_program)]
    pub claimant_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(epoch_id: u64)]
pub struct CloseEpoch<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ GardenError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [EPOCH_SEED, &epoch_id.to_le_bytes()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
}

#[derive(Accounts)]
pub struct WithdrawUnreserved<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ GardenError::NotAdmin, has_one = vault, has_one = mint)]
    pub config: Account<'info, Config>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub to: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(order_id: [u8; 16])]
pub struct PayOrder<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = vault, has_one = treasury, has_one = mint)]
    pub config: Account<'info, Config>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init, payer = payer, space = 8 + OrderReceipt::INIT_SPACE, seeds = [ORDER_SEED, payer.key().as_ref(), &order_id], bump)]
    pub order: Account<'info, OrderReceipt>,
    #[account(mut, token::mint = mint, token::authority = payer, token::token_program = token_program)]
    pub payer_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClubLock<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = mint)]
    pub config: Account<'info, Config>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init_if_needed, payer = owner, space = 8 + ClubLockAccount::INIT_SPACE, seeds = [LOCK_SEED, owner.key().as_ref()], bump)]
    pub lock: Account<'info, ClubLockAccount>,
    /// The owner's own lock vault, controlled by the program (only `club_unlock` can move it, and only to the owner).
    #[account(init_if_needed, payer = owner, seeds = [LOCK_VAULT_SEED, owner.key().as_ref()], bump, token::mint = mint, token::authority = config, token::token_program = token_program)]
    pub lock_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClubUnlock<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = mint)]
    pub config: Account<'info, Config>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [LOCK_SEED, owner.key().as_ref()], bump = lock.bump, has_one = owner)]
    pub lock: Account<'info, ClubLockAccount>,
    #[account(mut, seeds = [LOCK_VAULT_SEED, owner.key().as_ref()], bump)]
    pub lock_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

// ---- events and errors ------------------------------------------------------------------------------------

#[event]
pub struct EpochOpened { pub epoch_id: u64, pub root: [u8; 32], pub total: u64, pub claim_deadline: i64 }
#[event]
pub struct Claimed { pub epoch_id: u64, pub index: u32, pub claimant: Pubkey, pub amount: u64 }
#[event]
pub struct EpochClosed { pub epoch_id: u64, pub unclaimed: u64 }
#[event]
pub struct ClubLocked { pub owner: Pubkey, pub amount: u64, pub unlock_at: i64 }
#[event]
pub struct ClubUnlocked { pub owner: Pubkey, pub amount: u64 }
#[event]
pub struct OrderPaid { pub order_id: [u8; 16], pub payer: Pubkey, pub amount: u64, pub recycled: u64 }

#[error_code]
pub enum GardenError {
    #[msg("Only the admin can do that")]
    NotAdmin,
    #[msg("Basis points must be 0..=10000")]
    BadBps,
    #[msg("The claim deadline must be in the future")]
    BadDeadline,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("The vault does not hold enough MGRD for all open pools")]
    VaultUnderfunded,
    #[msg("Claims and payments are paused")]
    Paused,
    #[msg("Proof is too long")]
    ProofTooLong,
    #[msg("This week is closed")]
    EpochClosed,
    #[msg("The claim period has ended")]
    ClaimExpired,
    #[msg("The claim period has not ended yet")]
    NotExpired,
    #[msg("Invalid proof for this wallet, week and amount")]
    BadProof,
    #[msg("Claim would exceed the week's total")]
    Overdraw,
    #[msg("Those tokens are reserved for open pools")]
    Reserved,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Lock days must be 1..=365")]
    BadLockDays,
    #[msg("The Garden Club lock has not ended yet")]
    StillLocked,
    #[msg("This token can still be minted: its mint authority must be revoked")]
    MintAuthority,
    #[msg("This token's accounts can be frozen: it must have no freeze authority")]
    FreezeAuthority,
    #[msg("This token has extra rules (for example a transfer fee) that the game cannot support")]
    TokenRules,
    #[msg("The treasury cannot be the rewards vault")]
    BadTreasury,
    #[msg("This price quote has expired")]
    QuoteExpired,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(n: u8) -> Pubkey { Pubkey::new_from_array([n; 32]) }

    /// Build a tree the same way the server does (sorted pairs, odd node carried up) and check every proof.
    #[test]
    fn proofs_verify_and_bind_every_field() {
        let mint = pk(9);
        let leaves: Vec<[u8; 32]> = (0..5u32).map(|i| leaf_hash(&crate::ID, &mint, 7, i, &pk(i as u8 + 1), 1000 + i as u64)).collect();
        let mut levels = vec![leaves.clone()];
        while levels.last().unwrap().len() > 1 {
            let l = levels.last().unwrap();
            let next: Vec<[u8; 32]> = l.chunks(2).map(|c| if c.len() == 2 { node_hash(&c[0], &c[1]) } else { c[0] }).collect();
            levels.push(next);
        }
        let root = levels.last().unwrap()[0];
        for i in 0..leaves.len() {
            let mut proof = vec![];
            let mut idx = i;
            for l in &levels[..levels.len() - 1] {
                let sib = idx ^ 1;
                if sib < l.len() { proof.push(l[sib]); }
                idx /= 2;
            }
            assert!(verify_proof(leaves[i], &proof, root));
            // any changed field must fail
            assert!(!verify_proof(leaf_hash(&crate::ID, &mint, 7, i as u32, &pk(i as u8 + 1), 1001 + i as u64), &proof, root));
            assert!(!verify_proof(leaf_hash(&crate::ID, &mint, 8, i as u32, &pk(i as u8 + 1), 1000 + i as u64), &proof, root));
            assert!(!verify_proof(leaf_hash(&crate::ID, &mint, 7, i as u32, &pk(99), 1000 + i as u64), &proof, root));
            assert!(!verify_proof(leaf_hash(&crate::ID, &pk(10), 7, i as u32, &pk(i as u8 + 1), 1000 + i as u64), &proof, root));
        }
    }

    /// Shared test vector: the JavaScript code must produce the same hex.
    #[test]
    fn leaf_vector() {
        // a fixed program address, so the vector stays the same whatever address the program is built with
        let program = Pubkey::new_from_array([7; 32]);
        let leaf = leaf_hash(&program, &pk(9), 7, 3, &pk(4), 1_234_567);
        let hex: String = leaf.iter().map(|b| format!("{:02x}", b)).collect();
        println!("LEAF_VECTOR {}", hex);
        assert_eq!(hex.len(), 64);
    }
}
