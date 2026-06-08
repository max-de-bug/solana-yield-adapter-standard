//! Pre-computed instruction discriminators for the Yield Adapter Standard.
//!
//! Anchor derives each instruction's 8-byte discriminator as
//! `sha256("global:<instruction_name>")[..8]`.  Pre-computing them here makes
//! them available to adapter developers, CPI callers, and off-chain clients
//! without re-deriving at compile time.

/// `sha256("global:initialize")[..8]`
pub const ADAPTER_INITIALIZE: [u8; 8] =
    [0xaf, 0xaf, 0x6d, 0x1f, 0x0d, 0x98, 0x9b, 0xed];

/// `sha256("global:deposit")[..8]`
pub const ADAPTER_DEPOSIT: [u8; 8] =
    [0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6];

/// `sha256("global:withdraw")[..8]`
pub const ADAPTER_WITHDRAW: [u8; 8] =
    [0xb7, 0x12, 0x46, 0x9c, 0x94, 0x6d, 0xa1, 0x22];

/// `sha256("global:current_value")[..8]`
pub const ADAPTER_CURRENT_VALUE: [u8; 8] =
    [0xe8, 0xc7, 0xa7, 0xce, 0xf7, 0x38, 0xea, 0x14];

/// `sha256("global:toggle_status")[..8]`
pub const ADAPTER_TOGGLE_STATUS: [u8; 8] =
    [0xfb, 0xd7, 0x1e, 0x34, 0xe2, 0x99, 0x73, 0x82];

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn compute_discriminator(name: &str) -> [u8; 8] {
        let mut hasher = Sha256::new();
        hasher.update(b"global:");
        hasher.update(name.as_bytes());
        let result = hasher.finalize();
        let mut disc = [0u8; 8];
        disc.copy_from_slice(&result[..8]);
        disc
    }

    macro_rules! verify_disc {
        ($name:ident, $expected:ident, $label:expr) => {
            #[test]
            fn $name() {
                assert_eq!(
                    $expected,
                    compute_discriminator($label),
                    "discriminator mismatch for {}",
                    $label
                );
            }
        };
    }

    verify_disc!(disc_initialize, ADAPTER_INITIALIZE, "initialize");
    verify_disc!(disc_deposit, ADAPTER_DEPOSIT, "deposit");
    verify_disc!(disc_withdraw, ADAPTER_WITHDRAW, "withdraw");
    verify_disc!(disc_current_value, ADAPTER_CURRENT_VALUE, "current_value");
    verify_disc!(disc_toggle_status, ADAPTER_TOGGLE_STATUS, "toggle_status");
}
