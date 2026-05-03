// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PolicyWallet — gates every outbound call by a signed EIP-712 IntentProof
/// @notice Bound to a single owning agent (the EOA registered via ERC-8004).
///         Refuses any execute() unless the supplied IntentProof:
///           1. matches this contract's chainId+address (EIP-712 domain)
///           2. is signed by the bound agent
///           3. has unused nonce
///           4. has expiry > now
///           5. policyHash matches the immutable hash committed at deploy
contract PolicyWallet is EIP712, ReentrancyGuard {
    struct IntentProof {
        bytes32 intentId;
        address fromAgent;
        address toAgent;
        uint8 action;
        address target;
        uint256 value;
        bytes data;
        uint256 nonce;
        uint256 expiry;
        bytes32 policyHash;
    }

    bytes32 private constant INTENT_PROOF_TYPEHASH = keccak256(
        "IntentProof(bytes32 intentId,address fromAgent,address toAgent,uint8 action,address target,uint256 value,bytes data,uint256 nonce,uint256 expiry,bytes32 policyHash)"
    );

    address public immutable agent;
    bytes32 public immutable policyHash;

    mapping(uint256 => bool) public usedNonces;

    error WrongAgent(address expected, address got);
    error NonceUsed(uint256 nonce);
    error ProofExpired(uint256 expiry, uint256 now_);
    error PolicyMismatch(bytes32 expected, bytes32 got);
    error InvalidSignature();
    error ValueMismatch(uint256 expected, uint256 got);
    error CallFailed(bytes returnData);

    event IntentExecuted(
        bytes32 indexed intentId,
        address indexed fromAgent,
        address indexed target,
        uint8 action,
        uint256 value,
        uint256 nonce
    );

    constructor(address agent_, bytes32 policyHash_) EIP712("PolicyWallet", "1") {
        agent = agent_;
        policyHash = policyHash_;
    }

    /// @notice Execute the action described by `proof` after verifying its
    ///         EIP-712 signature against the bound agent.
    /// @dev    chainId is bound implicitly via _hashTypedDataV4 -> domain separator,
    ///         which OZ rebuilds when chainid changes. This is the canonical guard
    ///         against cross-chain replay.
    function execute(IntentProof calldata proof, bytes calldata signature)
        external
        payable
        nonReentrant
        returns (bytes memory)
    {
        if (proof.fromAgent != agent) revert WrongAgent(agent, proof.fromAgent);
        if (proof.expiry <= block.timestamp) revert ProofExpired(proof.expiry, block.timestamp);
        if (proof.policyHash != policyHash) revert PolicyMismatch(policyHash, proof.policyHash);
        if (usedNonces[proof.nonce]) revert NonceUsed(proof.nonce);
        if (msg.value != proof.value) revert ValueMismatch(proof.value, msg.value);

        bytes32 digest = _hashTypedDataV4(_structHash(proof));
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != agent) revert InvalidSignature();

        usedNonces[proof.nonce] = true;

        (bool ok, bytes memory ret) = proof.target.call{value: proof.value}(proof.data);
        if (!ok) revert CallFailed(ret);

        emit IntentExecuted(
            proof.intentId, proof.fromAgent, proof.target, proof.action, proof.value, proof.nonce
        );
        return ret;
    }

    /// @notice Public helper for off-chain signers / tests.
    function hashIntent(IntentProof calldata proof) external view returns (bytes32) {
        return _hashTypedDataV4(_structHash(proof));
    }

    /// @notice Public domain separator (matches off-chain viem `getDomain`).
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _structHash(IntentProof calldata p) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                INTENT_PROOF_TYPEHASH,
                p.intentId,
                p.fromAgent,
                p.toAgent,
                p.action,
                p.target,
                p.value,
                keccak256(p.data),
                p.nonce,
                p.expiry,
                p.policyHash
            )
        );
    }

    receive() external payable {}
}
