use anchor_lang::prelude::*;
use yield_adapter_trait::YieldAdapterError;

use crate::state::TemplateVaultState;
use crate::EXTERNAL_PROGRAM_ID;

// ─── DISCRIMINATORS ───────────────────────────────────────────────────────────
// Replace these with the actual instruction discriminators from your protocol.
// Compute via: sha256("global:<instruction_name>")[..8]
// Example: Kamino deposit → sha256("global:deposit_reserve_liquidity")[..8]
//
// const MY_PROTOCOL_DEPOSIT: [u8; 8] = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
// const MY_PROTOCOL_WITHDRAW: [u8; 8] = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
// ───────────────────────────────────────────────────────────────────────────────

/// Called after user tokens are transferred into the vault.
///
/// ### Conditional CPI pattern
/// This function checks `remaining.len()` to determine whether we're running
/// on a mainnet fork (where protocol accounts are provided) or localnet.
///
/// - **Fork**: remaining accounts are present → execute real protocol CPI.
/// - **Localnet**: remaining accounts are absent → skip CPI, just update bookkeeping.
///
/// ### Customizing
/// 1. Replace the discriminator constant above with your protocol's discriminator.
/// 2. Set `EXTERNAL_PROGRAM_ID` in `lib.rs` to your protocol's program ID.
/// 3. Build the `Instruction` with the correct accounts and data layout.
/// 4. Pass the correct `AccountInfo` slice to `invoke_signed`.
#[allow(unused_variables)]
pub fn on_deposit<'info>(
    vault: &mut TemplateVaultState,
    vault_authority: &AccountInfo<'info>,
    vault_token_account: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    amount: u64,
    remaining: &[AccountInfo<'info>],
    vault_authority_bump: u8,
) -> Result<()> {
    // Example: check for 5 remaining accounts (adjust to your protocol's needs).
    // if remaining.len() >= 5 {
    //     let pool = &remaining[0];
    //     let pool_vault = &remaining[1];
    //     let receipt_mint = &remaining[2];
    //     let instruction_sysvar = &remaining[3];
    //
    //     let seed: &[&[u8]] = &[VAULT_AUTHORITY_SEED, &[vault_authority_bump]];
    //     let signer_seeds: &[&[&[u8]]] = &[seed];
    //
    //     let ix = Instruction {
    //         program_id: EXTERNAL_PROGRAM_ID,
    //         accounts: vec![
    //             AccountMeta::new(vault_authority.key(), true),
    //             AccountMeta::new(pool.key(), false),
    //             AccountMeta::new(vault_token_account.key(), false),
    //             AccountMeta::new(receipt_mint.key(), false),
    //             AccountMeta::new_readonly(instruction_sysvar.key(), false),
    //             AccountMeta::new_readonly(token_program.key(), false),
    //         ],
    //         data: [MY_PROTOCOL_DEPOSIT.as_slice(), &amount.to_le_bytes()].concat(),
    //     };
    //
    //     let account_infos = [
    //         vault_authority.clone(),
    //         pool.clone(),
    //         vault_token_account.clone(),
    //         receipt_mint.clone(),
    //         instruction_sysvar.clone(),
    //         token_program.clone(),
    //     ];
    //
    //     invoke_signed(&ix, &account_infos, signer_seeds)?;
    // }

    // Track the amount routed through the protocol for auditability.
    vault.protocol_routed_underlying = vault
        .protocol_routed_underlying
        .checked_add(amount)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;

    Ok(())
}

/// Called before the vault transfers underlying tokens back to the user.
///
/// ### Conditional CPI pattern
/// Same as `on_deposit`: remaining accounts present → CPI, absent → no-op.
///
/// ### Customizing
/// Follow the same pattern as `on_deposit` above, using the withdraw
/// discriminator and account layout from your protocol.
#[allow(unused_variables)]
pub fn on_withdraw<'info>(
    vault: &mut TemplateVaultState,
    vault_authority: &AccountInfo<'info>,
    vault_token_account: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    amount: u64,
    remaining: &[AccountInfo<'info>],
    vault_authority_bump: u8,
) -> Result<()> {
    // if remaining.len() >= 5 {
    //     ... CPI logic ...
    // }

    vault.protocol_routed_underlying = vault
        .protocol_routed_underlying
        .checked_sub(amount)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;

    Ok(())
}

/// Called before a `current_value` query.
///
/// On fork, validates the remaining accounts contain a reference to the
/// protocol program. On localnet, silently succeeds.
pub fn before_value_query(_vault: &TemplateVaultState, remaining: &[AccountInfo]) -> Result<()> {
    if !remaining.is_empty() {
        let program = &remaining[0];
        require!(
            program.key() == EXTERNAL_PROGRAM_ID,
            YieldAdapterError::AdapterProgramMismatch
        );
        require!(program.executable, YieldAdapterError::ProtocolCpiError);
    }
    Ok(())
}
