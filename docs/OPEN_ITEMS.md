# Open items — everything incomplete, unverified or under-specified

Written to be uncomfortable rather than reassuring. If a judge or a reviewer finds a gap that is
not on this list, the list is wrong.

---

## A. Not implemented at all

| # | Item | Why it matters | Effort |
|---|---|---|---|
| A1 | **Domain binding.** Nothing verifies that the publisher controls the DNS name in `com.proofads.domain`. | Without it, ProofAds proves who may sell an *ENS name*, not who may sell *a website's* inventory. This is the gap between ProofAds and a real `ads.txt` replacement. | Signed `/.well-known/proofads.json` challenge: ~4h and weak. DNSSEC/ENS DNS binding: ~2 days and real. |
| A2 | **World Selfie Check.** Access-gated, not granted. See `WORLD_STATUS.md`. | The premium metric is inert. | ~1 day once access exists; the enum, `qualify` branch, DB table and SDK gate are already written. |
| A3 | **Log-trigger settlement.** Settlement is scheduled by cron with the batch id in workflow config. | An operator currently decides *when* a batch settles and *which* batch. A `SettlementRequested` event would make that on-chain and permissionless. | ~2h; ADR-007. |
| A4 | **Bid privacy.** Bids are public before the auction closes. | Late bidders can undercut by one unit. | Commit/reveal round: ~1 day. |
| A5 | **Multi-publisher discovery.** The UI reads one inventory registry, configured at build time. | Nothing about the contracts is single-publisher — only the UI is. | ~1 day plus an indexer. |
| A6 | **Video creatives.** Image only (ADR-010). | Halves the addressable inventory in practice. | Measurement definition work, not plumbing. |
| A7 | **Mobile wallets.** Injected connector only (ADR-011a). | Cannot demo from a phone. | ~1h with WalletConnect. |

## B. Implemented but not verified on a public network

| # | Item | State |
|---|---|---|
| B1 | **Everything on Sepolia.** The entire slice is proven on a local Anvil chain running the *real* ENSv2 contracts, plus a real browser. Nothing has been deployed to Sepolia, because the build environment has no egress to any Sepolia RPC. | `DEPLOYMENT_PLAN.md` is the runbook. Expect 60–90 minutes including the `.eth` registration wait. |
| B2 | **`cre workflow simulate`.** The workflow typechecks and its unit tests pass against the real SDK, and the real handler runs end to end under the local harness. It has never been executed by the CRE CLI, because that CLI could not be installed here. | The single highest-value thing to do next. `DEPLOYMENT_PLAN.md` §5. |
| B3 | **ENSv2 Sepolia addresses.** Two official sources disagree (`PROTOCOL_RESEARCH.md` §1.6). The scripts assert bytecode exists and allow env overrides, but which set is live is unverified. | First step of the runbook. |
| B4 | **KeystoneForwarder address.** `0x15fC…9F88` comes from the CRE starter-template READMEs, not from a first-party address page. | Verify before deploying the receiver; it is a constructor argument and cannot be changed except by `setForwarderAddress`. |
| B5 | **Etherscan verification.** `--verify` is in the runbook but has never been exercised for these contracts. | Low risk, unproven. |
| B6 | **`.eth` registration flow.** `register-eth-name.ts` was written from the `ETHRegistrar` source, and never run. | Registering in the Sepolia ENS app is the lower-risk path; the script is the fallback. |

## C. Known weaknesses in what *is* implemented

| # | Item | Detail |
|---|---|---|
| C1 | **The collector is trusted.** It can fabricate events. The digest makes post-hoc tampering detectable, not fabrication impossible. This is the single largest hole in the trust story and is stated as assumption 1 in `TRUST_MODEL.md`. |
| C2 | **Creative fetch needs CORS.** The SDK reads the creative's bytes to hash them, so the host must send `Access-Control-Allow-Origin`. A creative served without it renders nothing rather than rendering unverified — the right failure, but a deployment footgun. |
| C3 | **`outstandingLiabilities()` is O(listings × bids).** It exists for test assertions and would be unusable at scale. It is a view, so it costs no gas on chain, but do not call it from a contract. |
| C4 | **`withdrawBid` scans the bid array.** Fine for a handful of bidders; linear in bids per listing. |
| C5 | **15 assignees per EAC role per resource** is an ENSv2 ceiling. A publisher cannot delegate one slot to more than fifteen agencies. Untested here. |
| C6 | **No pause, no upgrade path, no admin recovery.** Deliberate for a hackathon; unacceptable for production custody of real USDC. |
| C7 | **Rounding.** `unitPrice × units` in 6-decimal USDC; no fee, no rounding remainder. If a protocol fee is added, revisit. |
| C8 | **`campaignDuration` is a `uint32` in seconds** (max ~136 years) but `deadline = startTime + duration` is `uint64`; no overflow, but no sanity ceiling on duration either. |
| C9 | **Session TTL is one hour, fixed.** A viewer who leaves a tab open longer will be told their session expired and stop being measured. |
| C10 | **The batch-close endpoint is operator-triggered.** Nothing schedules it. In a real deployment it would be a cron on the collector. |
| C11 | **No rate limiting on the collector.** `POST /events` accepts anything from a valid session. |
| C12 | **Batch closing is not idempotent at the API layer.** Closing twice creates two batches (by design — the first stays immutable), but an operator who closes twice by accident produces an empty-ish second batch. Harmless, untidy. |

## D. Product questions still open

- **What is a unit worth?** The demo prices a 10-second view at 0.20 USDC because the number is
  legible, not because it is defensible.
- **Who runs the collector?** If it is the publisher, assumption 1 is much weaker. If it is a
  neutral third party, ProofAds needs a business model for it. If it is decentralised, that is a
  different project.
- **What happens when a campaign under-delivers because the publisher's traffic collapsed** — is a
  partial refund really the right answer, or does the advertiser want a make-good?
- **Should the seller take a cut?** There is no fee mechanism at all right now: the publisher
  receives 100% of `verifiedUnits × unitPrice`, and the agency that sold the slot receives nothing
  on chain. Real agencies are paid; the model is silent on how.
