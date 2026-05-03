// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";

contract DeployIdentity is Script {
    function run() external returns (IdentityRegistry registry) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        registry = new IdentityRegistry();
        vm.stopBroadcast();
        console2.log("IdentityRegistry deployed at", address(registry));
    }
}
