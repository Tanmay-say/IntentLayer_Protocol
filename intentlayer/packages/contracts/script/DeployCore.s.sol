// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PolicyWallet} from "../src/PolicyWallet.sol";
import {IntentNoteRegistry} from "../src/IntentNoteRegistry.sol";
import {StealthAnnouncement} from "../src/StealthAnnouncement.sol";

contract DeployCore is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address agentA = vm.envAddress("AGENT_A_ADDRESS");
        address agentB = vm.envAddress("AGENT_B_ADDRESS");
        bytes32 policyHash = vm.envBytes32("POLICY_HASH");

        vm.startBroadcast(pk);
        PolicyWallet pwA = new PolicyWallet(agentA, policyHash);
        PolicyWallet pwB = new PolicyWallet(agentB, policyHash);
        IntentNoteRegistry notes = new IntentNoteRegistry();
        StealthAnnouncement stealth = new StealthAnnouncement();
        vm.stopBroadcast();

        console2.log("PolicyWallet (A)        :", address(pwA));
        console2.log("PolicyWallet (B)        :", address(pwB));
        console2.log("IntentNoteRegistry      :", address(notes));
        console2.log("StealthAnnouncement     :", address(stealth));
    }
}
