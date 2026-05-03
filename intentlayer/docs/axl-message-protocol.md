# AXL Message Protocol (IntentLayer profile)

All inter-agent traffic is wrapped in `AxlEnvelope` (see axl-transport/src/index.ts):

```
{ v: 1, id, from, to, type, ts, payload, signature? }
```

`signature` is `personal_sign` over canonical JSON of the envelope sans
`signature`, with stable key ordering. Verifier recovers the signer and
matches against the sender's ERC-8004-registered EOA.

## Message types

| type                  | direction | payload schema                                  |
|-----------------------|-----------|-------------------------------------------------|
| HEARTBEAT             | bidir     | `{ ping: number, sentBy: string }`              |
| POLICY_QUERY          | A → B     | `{ requesting: address }`                       |
| POLICY_RESPONSE       | B → A     | `{ policyHash: bytes32, summary: object }`      |
| INTENT_PROOF_REQUEST  | A → B     | `{ proof: IntentProof, signature: bytes }`      |
| INTENT_PROOF_ACK      | B → A     | `{ intentId: bytes32, decision, reason? }`      |
| STEALTH_CLAIM_NOTIFY  | A → B     | `{ stealthAddr, ephemeralPub, viewTag, txHash }`|

`IntentProof` numerics (value, nonce, expiry) are serialized as **decimal
strings** in JSON to avoid 53-bit precision loss; agent-b parses with `BigInt`.
