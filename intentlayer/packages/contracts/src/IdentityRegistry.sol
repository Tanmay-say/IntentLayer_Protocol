// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IntentLayer ERC-8004 Identity Registry (minimal reference)
/// @notice Maps agent EOAs to a sequential agentId and a tokenURI pointing
///         to the off-chain Agent Card JSON. Lookup-only after registration;
///         tokenURI is immutable per agent to prevent mid-demo spoofing.
contract IdentityRegistry {
    struct Agent {
        uint256 agentId;
        address agentAddress;
        string tokenURI;
        uint64 registeredAt;
    }

    error AgentAlreadyRegistered(address agent);
    error AgentNotRegistered(address agent);
    error EmptyTokenURI();
    error NotSelfRegistration();

    uint256 public nextAgentId = 1;
    mapping(address => Agent) private _agents;
    mapping(uint256 => address) public agentById;

    event AgentRegistered(uint256 indexed agentId, address indexed agentAddress, string tokenURI);

    /// @notice Register the calling EOA as an agent. tokenURI must be non-empty
    ///         and points to the canonical ERC-8004 Agent Card JSON.
    /// @param  tokenURI off-chain URI (https/ipfs) for the Agent Card
    /// @return agentId  newly assigned sequential agent id (>=1)
    function register(string calldata tokenURI) external returns (uint256 agentId) {
        if (bytes(tokenURI).length == 0) revert EmptyTokenURI();
        if (_agents[msg.sender].agentId != 0) revert AgentAlreadyRegistered(msg.sender);

        agentId = nextAgentId++;
        _agents[msg.sender] =
            Agent({agentId: agentId, agentAddress: msg.sender, tokenURI: tokenURI, registeredAt: uint64(block.timestamp)});
        agentById[agentId] = msg.sender;
        emit AgentRegistered(agentId, msg.sender, tokenURI);
    }

    /// @notice Resolve an agent's full record by its EOA.
    function resolve(address agent) external view returns (Agent memory) {
        Agent memory a = _agents[agent];
        if (a.agentId == 0) revert AgentNotRegistered(agent);
        return a;
    }

    /// @notice Convenience: return only the tokenURI (Agent Card location).
    function cardURI(address agent) external view returns (string memory) {
        Agent memory a = _agents[agent];
        if (a.agentId == 0) revert AgentNotRegistered(agent);
        return a.tokenURI;
    }

    /// @notice True iff `agent` has been registered.
    function isRegistered(address agent) external view returns (bool) {
        return _agents[agent].agentId != 0;
    }
}
