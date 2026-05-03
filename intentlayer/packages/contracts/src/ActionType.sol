// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Canonical action types for IntentProofs. Add to the END only —
///         changing existing values is a breaking change to EIP-712.
enum ActionType {
    NONE,           // 0 — invalid
    PAY_ERC20,      // 1 — direct ERC20 transfer
    PAY_STEALTH,    // 2 — ERC-5564 stealth payment (Phase 4)
    UNISWAP_SWAP,   // 3 — Phase 5
    NOTE_ONLY       // 4 — record IntentNote with no execution
}
