// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IntentNoteRegistry — append-only log of human-readable intent notes
/// @notice Each note is bound to an intentId; the encrypted blob is opaque to
///         the contract. Length cap of 4096 bytes prevents log-spam DoS.
contract IntentNoteRegistry {
    error BlobTooLarge(uint256 size);
    error EmptyIntentId();

    uint256 public constant MAX_BLOB_SIZE = 4096;

    // BUG #1 FIX: only intentId + author indexed (3-topic limit, useful filters);
    // timestamp is non-indexed (every block has new ts — useless as filter)
    event IntentNote(
        bytes32 indexed intentId,
        address indexed author,
        uint256 timestamp,
        bytes encBlob
    );

    function recordNote(bytes32 intentId, bytes calldata encBlob) external {
        if (intentId == bytes32(0)) revert EmptyIntentId();
        if (encBlob.length > MAX_BLOB_SIZE) revert BlobTooLarge(encBlob.length);
        emit IntentNote(intentId, msg.sender, block.timestamp, encBlob);
    }
}
