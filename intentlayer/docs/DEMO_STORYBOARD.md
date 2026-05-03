# IntentLayer — Hackathon Demo Storyboard (Phase C)

> Live walkthrough script for judges. Target run-time **≤ 4 minutes**.
> Pre-record the full happy path 3× as fallback (see § 4).

---

## 1. Pre-flight checklist (do **before** going live)

- [ ] Three real AXL daemons running (`pnpm axl:real`) — verify via
  `curl :7701/topology`, `:7702/topology`, `:7703/topology` (each lists the
  other two as peers).
- [ ] All Phase A bug fixes deployed (no `STEALTH_GAS_TOPUP_WEI`, no
  `STEALTH_DIRECT_SWEEP_FALLBACK`, no `sweepStealthUSDCViaEoa`).
- [ ] `apps/admin-web` open at `http://127.0.0.1:3000`. Env-readiness panel
  green for the 13 mandatory keys.
- [ ] `agent-b` + `observer-agent` running in background.
- [ ] PolicyWallet has ≥ 1 USDC funded on Base Sepolia.
- [ ] BaseScan tab open + queued to **Agent A's address**.
- [ ] Tenderly project tab open (proves the gate is real).

---

## 2. Live storyboard (single take)

| Time | Action | What the judge sees |
|------|--------|---------------------|
| 0:00 | Open dashboard (`admin-web`) | 3 AXL nodes online, contracts deployed on Base Sepolia, env-readiness all green. |
| 0:30 | Click **"Start Live A2A Payment"** | Stage timeline begins: `HEARTBEAT → STEALTH_DERIVED → PROOF_BUILT`. |
| 1:00 | Network tab → show signed AXL envelope payload | EIP-712 signature visible inside `payload.signature`; envelope has its own EIP-191 sig. |
| 1:30 | Policy + Gemini + Tenderly evaluation | Three rows in the timeline turn green: `POLICY_ACCEPTED`, Gemini ACCEPT, `SIMULATION_APPROVED`. |
| 2:00 | `PolicyWallet.execute` mined | BaseScan link opens — show `PolicyWallet → USDC.transfer(stealthAddr)`. **Note**: only one outbound tx from agent-a's EOA in this whole flow. |
| 2:15 | `StealthAnnouncement.announce` mined | Show emitted event with `schemeId=1`, ephemeral pubkey, metadata. |
| 2:30 | Agent B scanner detects, Pimlico sweep | UserOp hash → tx hash, **paid by paymaster in USDC**, no ETH ever touched the stealth address. |
| 3:00 | **Backtrace test** — open agent-a's BaseScan page; try to find stealthAddr | Cannot. No outbound ETH transfer from agent-a to stealthAddr. (Phase A.1 fix). |
| 3:30 | **Block-malicious test** — click "Demo: Reject by Tenderly" | Dashboard shows `SIMULATION_REJECTED` for the sweep, **no Pimlico call, no on-chain tx**. (Phase A.2 fix). |

---

## 3. Talking points (verbal overlay)

1. **"Five EIPs in one payment."**
   ERC-8004 (identity) + EIP-712 (proof) + EIP-191 (envelope) + ERC-5564
   (stealth) + ERC-4337 (gasless sweep). All composed correctly.

2. **"AXL is the only transport."**
   No HTTP, no WebSocket, no shared queue between agents. Each agent talks
   only to its own local AXL daemon — three independent OS processes.

3. **"Tenderly is a hard gate."**
   Both before `PolicyWallet.execute` *and* before the stealth sweep. Failure
   ⇒ no broadcast. **Fail-closed**, not fail-open. (Phase A.2)

4. **"No on-chain link from payer to payee."**
   The PolicyWallet calls `USDC.transfer(stealthAddr, X)`. The stealth
   address has no ETH, no history, no link back to agent-a. Pimlico's
   token-paymaster pays the sweep gas in USDC. (Phase A.1)

5. **"Replay-safe."**
   Every AXL envelope is EIP-191 signed. `STEALTH_CLAIM_NOTIFY` envelopes
   are dedup'd by `(envelopeId | from)`. (Phase A.4)

---

## 4. Pre-recorded fallback

If the live demo fails, fall back to the recording. Required artefacts:

- `demo/recordings/happy-path.mp4` — 3 successful end-to-end runs.
- `demo/recordings/blocked-by-tenderly.mp4` — Phase A.2 gate in action.
- `demo/recordings/no-on-chain-link.png` — BaseScan side-by-side proof.

Each recording must include the corresponding tx hash overlay so judges
can verify on BaseScan after the talk.

---

## 5. After the demo

- Hand the judge the **README → Architecture diagram** (mermaid).
- Point them at `FEEDBACK.md` (the Gensyn-mandated submission appendix).
- Offer the `Phase.txt` log + `v6phase.md` log as proof of methodical
  delivery.
