// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StealthAnnouncement} from "../src/StealthAnnouncement.sol";

contract StealthAnnouncementTest is Test {
    StealthAnnouncement sa;

    function setUp() public {
        sa = new StealthAnnouncement();
    }

    function test_announce_scheme1() public {
        sa.announce(1, address(0x1234), hex"deadbeef", hex"01");
    }

    function test_revert_unsupportedScheme() public {
        vm.expectRevert(abi.encodeWithSelector(StealthAnnouncement.UnsupportedScheme.selector, uint256(2)));
        sa.announce(2, address(0x1234), hex"00", hex"00");
    }
}
