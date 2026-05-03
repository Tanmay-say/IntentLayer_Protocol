// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";

contract IdentityRegistryTest is Test {
    IdentityRegistry registry;
    address agentA = address(0xA11CE);
    address agentB = address(0xB0B);

    function setUp() public {
        registry = new IdentityRegistry();
    }

    function test_register_and_resolve() public {
        vm.prank(agentA);
        uint256 id = registry.register("ipfs://card-a");
        assertEq(id, 1);
        assertEq(registry.cardURI(agentA), "ipfs://card-a");
        assertTrue(registry.isRegistered(agentA));
    }

    function test_revert_doubleRegistration() public {
        vm.startPrank(agentA);
        registry.register("ipfs://card-a");
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.AgentAlreadyRegistered.selector, agentA));
        registry.register("ipfs://card-a-2");
        vm.stopPrank();
    }

    function test_revert_emptyURI() public {
        vm.prank(agentA);
        vm.expectRevert(IdentityRegistry.EmptyTokenURI.selector);
        registry.register("");
    }

    function test_revert_resolveUnknown() public {
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.AgentNotRegistered.selector, agentB));
        registry.resolve(agentB);
    }

    function test_sequentialIds() public {
        vm.prank(agentA);
        uint256 idA = registry.register("ipfs://a");
        vm.prank(agentB);
        uint256 idB = registry.register("ipfs://b");
        assertEq(idA, 1);
        assertEq(idB, 2);
        assertEq(registry.agentById(2), agentB);
    }
}
