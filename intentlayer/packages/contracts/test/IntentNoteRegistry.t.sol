// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IntentNoteRegistry} from "../src/IntentNoteRegistry.sol";

contract IntentNoteRegistryTest is Test {
    IntentNoteRegistry reg;

    event IntentNote(bytes32 indexed intentId, address indexed author, uint256 timestamp, bytes encBlob);

    function setUp() public {
        reg = new IntentNoteRegistry();
    }

    function test_recordNote() public {
        bytes32 id = keccak256("hello");
        bytes memory blob = bytes("encrypted-blob");
        vm.expectEmit(true, true, false, true);
        emit IntentNote(id, address(this), block.timestamp, blob);
        reg.recordNote(id, blob);
    }

    function test_revert_emptyId() public {
        vm.expectRevert(IntentNoteRegistry.EmptyIntentId.selector);
        reg.recordNote(bytes32(0), bytes("x"));
    }

    function test_revert_blobTooLarge() public {
        bytes memory big = new bytes(4097);
        vm.expectRevert(abi.encodeWithSelector(IntentNoteRegistry.BlobTooLarge.selector, uint256(4097)));
        reg.recordNote(keccak256("k"), big);
    }
}
