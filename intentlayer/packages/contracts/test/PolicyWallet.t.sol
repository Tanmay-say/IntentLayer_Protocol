// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyWallet} from "../src/PolicyWallet.sol";

contract Sink {
    uint256 public lastValue;
    bytes public lastData;

    function ping(uint256 x) external payable returns (uint256) {
        lastValue = msg.value;
        lastData = abi.encode(x);
        return x * 2;
    }
}

contract Reverter {
    error Boom();

    function fail() external pure {
        revert Boom();
    }
}

contract FalseToken {
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}

contract PolicyWalletTest is Test {
    PolicyWallet wallet;
    Sink sink;
    uint256 agentPk = 0xA11CE;
    address agent;
    bytes32 policyHash = keccak256("policy-v1");

    function setUp() public {
        agent = vm.addr(agentPk);
        wallet = new PolicyWallet(agent, policyHash);
        sink = new Sink();
        vm.deal(address(wallet), 10 ether);
    }

    function _makeProof(uint256 nonce, uint256 expiry, uint256 value)
        internal
        view
        returns (PolicyWallet.IntentProof memory)
    {
        return PolicyWallet.IntentProof({
            intentId: keccak256(abi.encode(nonce)),
            fromAgent: agent,
            toAgent: address(0xBEEF),
            action: 1,
            target: address(sink),
            value: value,
            data: abi.encodeCall(Sink.ping, (42)),
            nonce: nonce,
            expiry: expiry,
            policyHash: policyHash
        });
    }

    function _makeProofFor(uint256 nonce, address target, bytes memory data)
        internal
        view
        returns (PolicyWallet.IntentProof memory)
    {
        PolicyWallet.IntentProof memory p = _makeProof(nonce, block.timestamp + 1 hours, 0);
        p.target = target;
        p.data = data;
        return p;
    }

    function _sign(PolicyWallet.IntentProof memory p) internal view returns (bytes memory) {
        bytes32 digest = wallet.hashIntent(p);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_happyPath() public {
        PolicyWallet.IntentProof memory p = _makeProof(1, block.timestamp + 1 hours, 1 ether);
        bytes memory sig = _sign(p);
        bytes memory ret = wallet.execute{value: 1 ether}(p, sig);
        assertEq(abi.decode(ret, (uint256)), 84);
        assertEq(sink.lastValue(), 1 ether);
        assertTrue(wallet.usedNonces(1));
    }

    function test_revert_valueMismatch() public {
        PolicyWallet.IntentProof memory p = _makeProof(1, block.timestamp + 1 hours, 1 ether);
        bytes memory sig = _sign(p);
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.ValueMismatch.selector, 1 ether, 0));
        wallet.execute(p, sig);
    }

    function test_revert_replay() public {
        PolicyWallet.IntentProof memory p = _makeProof(1, block.timestamp + 1 hours, 0);
        bytes memory sig = _sign(p);
        wallet.execute(p, sig);
        vm.expectRevert(abi.encodeWithSelector(PolicyWallet.NonceUsed.selector, uint256(1)));
        wallet.execute(p, sig);
    }

    function test_revert_expired() public {
        PolicyWallet.IntentProof memory p = _makeProof(1, block.timestamp + 1, 0);
        bytes memory sig = _sign(p);
        vm.warp(block.timestamp + 10);
        vm.expectRevert();
        wallet.execute(p, sig);
    }

    function test_revert_wrongPolicy() public {
        PolicyWallet.IntentProof memory p = _makeProof(1, block.timestamp + 1 hours, 0);
        p.policyHash = keccak256("other");
        bytes memory sig = _sign(p);
        vm.expectRevert();
        wallet.execute(p, sig);
    }

    function test_revert_wrongSigner() public {
        PolicyWallet.IntentProof memory p = _makeProof(1, block.timestamp + 1 hours, 0);
        bytes32 digest = wallet.hashIntent(p);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xDEADBEEF, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        vm.expectRevert(PolicyWallet.InvalidSignature.selector);
        wallet.execute(p, sig);
    }

    function test_revert_wrongAgent() public {
        PolicyWallet.IntentProof memory p = _makeProof(1, block.timestamp + 1 hours, 0);
        p.fromAgent = address(0xCAFE);
        bytes memory sig = _sign(p);
        vm.expectRevert();
        wallet.execute(p, sig);
    }

    function test_revert_callFailed() public {
        Reverter reverter = new Reverter();
        PolicyWallet.IntentProof memory p =
            _makeProofFor(1, address(reverter), abi.encodeCall(Reverter.fail, ()));
        bytes memory sig = _sign(p);
        vm.expectRevert();
        wallet.execute(p, sig);
    }

    function test_domainSeparatorAndHashIntentAreStable() public {
        PolicyWallet.IntentProof memory p = _makeProof(1, block.timestamp + 1 hours, 0);
        assertEq(wallet.hashIntent(p), wallet.hashIntent(p));
        assertTrue(wallet.domainSeparator() != bytes32(0));
    }

    function test_erc20FalseReturnDoesNotRevertGenericCall() public {
        FalseToken token = new FalseToken();
        PolicyWallet.IntentProof memory p =
            _makeProofFor(1, address(token), abi.encodeCall(FalseToken.transfer, (address(0xBEEF), 1)));
        bytes memory sig = _sign(p);
        bytes memory ret = wallet.execute(p, sig);
        assertEq(abi.decode(ret, (bool)), false);
    }
}
