# reason-codes.md

## ActionType (uint8 in IntentProof)
| Value | Name          | Description                              |
|-------|---------------|------------------------------------------|
| 0     | NONE          | invalid / placeholder                    |
| 1     | PAY_ERC20     | direct ERC20 transfer                    |
| 2     | PAY_STEALTH   | ERC-5564 stealth payment (Phase 4)       |
| 3     | UNISWAP_SWAP  | Uniswap swap via PolicyWallet (Phase 5)  |
| 4     | NOTE_ONLY     | record IntentNote without execution      |

## Policy reject codes (off-chain)
- `POLICY_HASH_MISMATCH` — proof.policyHash != PolicyWallet.policyHash
- `PROOF_EXPIRED` — proof.expiry <= now
- `PROOF_NOT_YET_VALID` — expiry too far in future (TTL guard)
- `VALUE_OVER_TX_CAP` — proof.value > policy.maxValuePerTx
- `VALUE_OVER_DAILY_BUDGET` — cumulative spend would exceed dailyBudget
- `TARGET_SELECTOR_NOT_ALLOWED` — (target,selector) not in allowlist
- `REPLAYED_NONCE` — nonce already consumed
- `BAD_DATA_LENGTH` — calldata not 0x-prefixed even-length hex
