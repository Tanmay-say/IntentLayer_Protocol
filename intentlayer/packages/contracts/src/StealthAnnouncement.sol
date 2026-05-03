// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title StealthAnnouncement — ERC-5564 compliant ephemeral announcements
/// @notice ERC-5564 spec defines schemeId as uint256 (BUG #2 FIX).
contract StealthAnnouncement {
    error UnsupportedScheme(uint256 schemeId);

    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    /// @notice Announce a stealth-address payment per ERC-5564.
    /// @dev    schemeId == 1 = SECP256K1 with view tag (the IntentLayer default).
    function announce(
        uint256 schemeId,
        address stealthAddress,
        bytes calldata ephemeralPubKey,
        bytes calldata metadata
    ) external {
        if (schemeId != 1) revert UnsupportedScheme(schemeId);
        emit Announcement(schemeId, stealthAddress, msg.sender, ephemeralPubKey, metadata);
    }
}
