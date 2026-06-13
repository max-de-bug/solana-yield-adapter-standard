use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::state::{RegistryState, REGISTRY_STATE_SEED};

/// Dev/test admin key that can force-transfer governance.
/// Set to the test wallet pubkey for CI/Surfpool; in production set to `Pubkey::default()`.
const ADMIN_PUBKEY: Pubkey = pubkey!("5FsXjNmmudnBndWPgQWj8uvY7kfs3dSpf655i39Q6A9A");

#[derive(Accounts)]
pub struct ForceTransferGovernance<'info> {
    /// Must be the hardcoded admin key.
    #[account(constraint = admin.key() == ADMIN_PUBKEY @ RegistryError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [REGISTRY_STATE_SEED],
        bump = registry_state.bump,
    )]
    pub registry_state: Account<'info, RegistryState>,

    /// CHECK: New authority to set (no restrictions).
    pub new_authority: UncheckedAccount<'info>,
}

/// Force-transfer governance to a new authority.
/// Only callable by the hardcoded admin key (dev/test only).
pub fn handler(ctx: Context<ForceTransferGovernance>) -> Result<()> {
    let state = &mut ctx.accounts.registry_state;
    let new_auth = ctx.accounts.new_authority.key();

    msg!(
        "Force governance transfer: {} -> {} (admin override)",
        state.authority,
        new_auth
    );

    state.authority = new_auth;
    state.pending_authority = None;

    Ok(())
}
