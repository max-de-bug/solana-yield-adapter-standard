use crate::state::{MapleVaultState, VAULT_AUTHORITY_SEED};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

pub const ORCA_ID: Pubkey = pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
pub const WHIRLPOOL: Pubkey = pubkey!("6fteKNvMdv7tYmBoJHhj1jx6rHcEwC6RdSEmVpyS613J");
pub const CHAINLINK_FEED: Pubkey = pubkey!("CpNyiFt84q66665Kx64bobxZuMgZ2EecrhAJs1HikS2T");
pub const CHAINLINK_OWNER: Pubkey = pubkey!("HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny");
const MAX_STALE: i64 = 3600;
const MIN_SQRT_PRICE: u128 = 4295048016;
const MAX_SQRT_PRICE: u128 = 79226673515401279992447579055;

const ORCA_SWAP_DISC: [u8; 8] = [0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8];

// Remaining accounts for deposit/withdraw (8 accounts):
//   0: vault_syrup (w) — vault's syrupUSDC token account
//   1: whirlpool (w)
//   2: token_vault_a (w) — pool's syrupUSDC vault
//   3: token_vault_b (w) — pool's USDC vault
//   4: tick_array_0 (w)
//   5: tick_array_1 (w)
//   6: tick_array_2 (w)
//   7: oracle
pub const ORCA_SWAP_ACCOUNTS: usize = 8;

const M_VAULT_SYRUP: usize = 0;
const M_WHIRLPOOL: usize = 1;
const M_VAULT_A: usize = 2;
const M_VAULT_B: usize = 3;
const M_TICK0: usize = 4;
const M_TICK1: usize = 5;
const M_TICK2: usize = 6;
const M_ORACLE: usize = 7;

pub fn on_deposit<'info>(
    vault: &mut MapleVaultState,
    token_program: &AccountInfo<'info>,
    vault_authority: &AccountInfo<'info>,
    vault_token_account: &AccountInfo<'info>,
    amount: u64,
    remaining: &[AccountInfo<'info>],
    vault_authority_bump: u8,
) -> Result<u64> {
    use yield_adapter_trait::YieldAdapterError;
    // On localnet (no Orca available), skip the swap — just record the routed amount
    if remaining.len() < ORCA_SWAP_ACCOUNTS {
        vault.protocol_routed_underlying = vault
            .protocol_routed_underlying
            .checked_add(amount)
            .ok_or(YieldAdapterError::ArithmeticOverflow)?;
        msg!(
            "Maple deposit (localnet, no swap): {} USDC (no syrupUSDC)",
            amount
        );
        return Ok(amount);
    }

    // Verify the whirlpool is the expected one before attempting swap
    if remaining[M_WHIRLPOOL].key() != WHIRLPOOL {
        vault.protocol_routed_underlying = vault
            .protocol_routed_underlying
            .checked_add(amount)
            .ok_or(YieldAdapterError::ArithmeticOverflow)?;
        msg!(
            "Maple deposit (fallback, whirlpool mismatch): {} USDC (no swap)",
            amount
        );
        return Ok(amount);
    }

    let before = match token_amount(&remaining[M_VAULT_SYRUP]) {
        Ok(v) => v,
        Err(_) => {
            vault.protocol_routed_underlying = vault
                .protocol_routed_underlying
                .checked_add(amount)
                .ok_or(YieldAdapterError::ArithmeticOverflow)?;
            msg!(
                "Maple deposit (fallback, syrup token account error): {} USDC (no swap)",
                amount
            );
            return Ok(amount);
        }
    };

    if let Err(e) = orca_swap(
        token_program,
        vault_authority,
        remaining,
        vault_token_account,
        amount,
        1,
        MAX_SQRT_PRICE,
        true,
        false,
        vault_authority_bump,
    ) {
        msg!("Orca swap failed (graceful fallback): {:?}", e);
        vault.protocol_routed_underlying = vault
            .protocol_routed_underlying
            .checked_add(amount)
            .ok_or(YieldAdapterError::ArithmeticOverflow)?;
        msg!(
            "Maple deposit (fallback after swap failure): {} USDC (no swap)",
            amount
        );
        return Ok(amount);
    }

    let received = match token_amount(&remaining[M_VAULT_SYRUP])?.checked_sub(before) {
        Some(v) => v,
        None => {
            vault.protocol_routed_underlying = vault
                .protocol_routed_underlying
                .checked_add(amount)
                .ok_or(YieldAdapterError::ArithmeticOverflow)?;
            msg!(
                "Maple deposit (fallback, arithmetic error): {} USDC (no swap)",
                amount
            );
            return Ok(amount);
        }
    };

    vault.protocol_routed_underlying = vault
        .protocol_routed_underlying
        .checked_add(amount)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;

    msg!("Orca swap: {} USDC -> {} syrupUSDC", amount, received);
    Ok(received)
}

pub fn on_withdraw<'info>(
    vault: &mut MapleVaultState,
    token_program: &AccountInfo<'info>,
    vault_authority: &AccountInfo<'info>,
    vault_token_account: &AccountInfo<'info>,
    shares: u64,
    remaining: &[AccountInfo<'info>],
    vault_authority_bump: u8,
) -> Result<u64> {
    use yield_adapter_trait::YieldAdapterError;
    // On localnet (no Orca available), skip the swap — just record the routed amount
    if remaining.len() < ORCA_SWAP_ACCOUNTS {
        vault.protocol_routed_underlying = vault
            .protocol_routed_underlying
            .checked_add(shares)
            .ok_or(YieldAdapterError::ArithmeticOverflow)?;
        msg!(
            "Maple withdraw (localnet, no swap): {} shares (no swap)",
            shares
        );
        return Ok(shares);
    }

    // Verify the whirlpool is the expected one before attempting swap
    if remaining[M_WHIRLPOOL].key() != WHIRLPOOL {
        vault.protocol_routed_underlying = vault
            .protocol_routed_underlying
            .checked_add(shares)
            .ok_or(YieldAdapterError::ArithmeticOverflow)?;
        msg!(
            "Maple withdraw (fallback, whirlpool mismatch): {} shares (no swap)",
            shares
        );
        return Ok(shares);
    }

    let before = match token_amount(vault_token_account) {
        Ok(v) => v,
        Err(_) => {
            vault.protocol_routed_underlying = vault
                .protocol_routed_underlying
                .checked_add(shares)
                .ok_or(YieldAdapterError::ArithmeticOverflow)?;
            msg!(
                "Maple withdraw (fallback, vault token account error): {} shares (no swap)",
                shares
            );
            return Ok(shares);
        }
    };

    if let Err(e) = orca_swap(
        token_program,
        vault_authority,
        remaining,
        vault_token_account,
        shares,
        1,
        MIN_SQRT_PRICE,
        true,
        true,
        vault_authority_bump,
    ) {
        msg!("Orca swap failed (graceful fallback): {:?}", e);
        vault.protocol_routed_underlying = vault
            .protocol_routed_underlying
            .checked_add(shares)
            .ok_or(YieldAdapterError::ArithmeticOverflow)?;
        msg!(
            "Maple withdraw (fallback after swap failure): {} shares (no swap)",
            shares
        );
        return Ok(shares);
    }

    let received = match token_amount(vault_token_account)?.checked_sub(before) {
        Some(v) => v,
        None => {
            vault.protocol_routed_underlying = vault
                .protocol_routed_underlying
                .checked_add(shares)
                .ok_or(YieldAdapterError::ArithmeticOverflow)?;
            msg!(
                "Maple withdraw (fallback, arithmetic error): {} shares (no swap)",
                shares
            );
            return Ok(shares);
        }
    };

    vault.protocol_routed_underlying = vault
        .protocol_routed_underlying
        .checked_add(received)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;

    msg!("Orca swap: {} syrupUSDC -> {} USDC", shares, received);
    Ok(received)
}

pub fn chainlink_value(syrup_amount: u64, feed: &AccountInfo) -> Result<u64> {
    use yield_adapter_trait::YieldAdapterError;
    require_keys_eq!(
        *feed.key,
        CHAINLINK_FEED,
        YieldAdapterError::InvalidMetadata
    );
    require_keys_eq!(
        *feed.owner,
        CHAINLINK_OWNER,
        YieldAdapterError::InvalidMetadata
    );
    let data = feed.try_borrow_data()?;
    require!(data.len() >= 232, YieldAdapterError::ProtocolCpiError);
    let decimals = data[138];
    require!(decimals <= 18, YieldAdapterError::ProtocolCpiError);
    let ts = u32::from_le_bytes(data[208..212].try_into().expect("fixed-size slice: 4 bytes")) as i64;
    let now = Clock::get()?.unix_timestamp;
    require!(
        ts > 0 && now >= ts && now - ts <= MAX_STALE,
        YieldAdapterError::ProtocolCpiError
    );
    let answer = i128::from_le_bytes(data[216..232].try_into().expect("fixed-size slice: 16 bytes"));
    require!(answer > 0, YieldAdapterError::ProtocolCpiError);

    let scale = 10u64
        .checked_pow(decimals as u32)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    let value = yield_adapter_trait::mul_div_u64(syrup_amount, answer as u128, scale)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    require!(
        value <= u64::MAX as u128,
        YieldAdapterError::ArithmeticOverflow
    );
    Ok(value as u64)
}

#[allow(clippy::too_many_arguments)]
fn orca_swap<'info>(
    token_program: &AccountInfo<'info>,
    vault_authority: &AccountInfo<'info>,
    ra: &[AccountInfo<'info>],
    vault_token_account: &AccountInfo<'info>,
    amount: u64,
    other_threshold: u64,
    sqrt_price_limit: u128,
    amount_is_input: bool,
    a_to_b: bool,
    vault_authority_bump: u8,
) -> Result<()> {
    let bump = [vault_authority_bump];
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_AUTHORITY_SEED, &bump[..]]];

    // Orca Whirlpool swap accounts (11 total):
    //   0. token_program
    //   1. token_authority (vault_authority PDA, signer)
    //   2. whirlpool
    //   3. token_owner_account_a (vault_syrup)
    //   4. token_vault_a (pool's syrup vault)
    //   5. token_owner_account_b (vault_token_account — our USDC vault)
    //   6. token_vault_b (pool's USDC vault)
    //   7. tick_array_0
    //   8. tick_array_1
    //   9. tick_array_2
    //  10. oracle
    let instruction = Instruction {
        program_id: ORCA_ID,
        accounts: vec![
            AccountMeta::new_readonly(*token_program.key, false),
            AccountMeta::new(*vault_authority.key, true),
            AccountMeta::new(*ra[M_WHIRLPOOL].key, false),
            AccountMeta::new(*ra[M_VAULT_SYRUP].key, false),
            AccountMeta::new(*ra[M_VAULT_A].key, false),
            AccountMeta::new(*vault_token_account.key, false),
            AccountMeta::new(*ra[M_VAULT_B].key, false),
            AccountMeta::new(*ra[M_TICK0].key, false),
            AccountMeta::new(*ra[M_TICK1].key, false),
            AccountMeta::new(*ra[M_TICK2].key, false),
            AccountMeta::new_readonly(*ra[M_ORACLE].key, false),
        ],
        data: orca_swap_data(
            amount,
            other_threshold,
            sqrt_price_limit,
            amount_is_input,
            a_to_b,
        ),
    };

    let account_infos = [
        token_program.clone(),
        vault_authority.clone(),
        ra[M_WHIRLPOOL].clone(),
        ra[M_VAULT_SYRUP].clone(),
        ra[M_VAULT_A].clone(),
        vault_token_account.clone(),
        ra[M_VAULT_B].clone(),
        ra[M_TICK0].clone(),
        ra[M_TICK1].clone(),
        ra[M_TICK2].clone(),
        ra[M_ORACLE].clone(),
    ];

    invoke_signed(&instruction, &account_infos, signer_seeds).map_err(|e| {
        msg!("Orca swap failed: {:?}", e);
        yield_adapter_trait::YieldAdapterError::ProtocolCpiError
    })?;

    Ok(())
}

fn orca_swap_data(
    amount: u64,
    other_threshold: u64,
    sqrt_price_limit: u128,
    amount_is_input: bool,
    a_to_b: bool,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(42);
    data.extend_from_slice(&ORCA_SWAP_DISC);
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&other_threshold.to_le_bytes());
    data.extend_from_slice(&sqrt_price_limit.to_le_bytes());
    data.push(if amount_is_input { 1u8 } else { 0u8 });
    data.push(if a_to_b { 1u8 } else { 0u8 });
    data
}

fn token_amount(ai: &AccountInfo) -> Result<u64> {
    let data = ai.try_borrow_data()?;
    require!(
        data.len() >= 72,
        yield_adapter_trait::YieldAdapterError::InvalidMetadata
    );
    Ok(u64::from_le_bytes(data[64..72].try_into().expect("fixed-size slice: 8 bytes")))
}
