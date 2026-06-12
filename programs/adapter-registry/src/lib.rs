//! # Adapter Registry
//!
//! A governance-gated on-chain registry for the Solana Yield Adapter Standard.
//!
//! ## Lifecycle
//!
//! 1. **Propose** — Anyone can propose a new adapter by submitting its program ID and metadata.
//! 2. **Approve** — Only the governance authority can approve a proposed adapter.
//! 3. **Revoke**  — The governance authority can revoke an adapter at any time.
//!
//! ## Governance
//!
//! The registry is controlled by a single governance authority (initially the deployer).
//! Governance can be transferred to a multisig, DAO, or other program via `nominate_governance` / `accept_governance`.

#![allow(clippy::diverging_sub_expression)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("8TAhAne1z4chGzuP9EeXFuYsqyGHzACWuD7sURS3ydAq");

#[program]
pub mod adapter_registry {
    use super::*;

    /// Initialize the registry with a governance authority.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Propose a new adapter for inclusion in the registry.
    /// Anyone can call this instruction.
    pub fn propose_adapter(
        ctx: Context<ProposeAdapter>,
        name: String,
        metadata_uri: String,
        vault_state_seed: String,
        vault_authority_seed: String,
    ) -> Result<()> {
        instructions::propose_adapter::handler(ctx, name, metadata_uri, vault_state_seed, vault_authority_seed)
    }

    /// Approve a proposed adapter. Governance-gated.
    pub fn approve_adapter(ctx: Context<ApproveAdapter>) -> Result<()> {
        instructions::approve_adapter::handler(ctx)
    }

    /// Revoke an approved adapter. Governance-gated.
    pub fn revoke_adapter(ctx: Context<RevokeAdapter>) -> Result<()> {
        instructions::revoke_adapter::handler(ctx)
    }

    /// Step 1 of two-step governance transfer: nominate a new authority.
    /// The current authority sets `pending_authority`; the nominee must call `accept_governance`.
    pub fn nominate_governance(ctx: Context<NominateGovernance>) -> Result<()> {
        instructions::transfer_governance::handler(ctx)
    }

    /// Step 2 of two-step governance transfer: accept a pending nomination.
    pub fn accept_governance(ctx: Context<AcceptGovernance>) -> Result<()> {
        instructions::accept_governance::handler(ctx)
    }

    /// Set or remove the guardian role.
    /// Authority-only. Pass `Pubkey::default()` to clear the guardian.
    pub fn set_guardian(ctx: Context<SetGuardian>, new_guardian: Pubkey) -> Result<()> {
        instructions::set_guardian::handler(ctx, new_guardian)
    }
}
