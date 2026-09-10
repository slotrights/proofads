# Trust model

Two lists. The first is what the protocol enforces — if it is wrong, there is a bug. The second is
what the protocol trusts — if it is wrong, the protocol is wrong, and no amount of code fixes it.

---

## Enforced by contracts (verifiable by anyone, at any time)

| Property | Mechanism | Proof |
|---|---|---|
| Only an ENS-authorized account may list a slot | `ProofAdsMarket.createListing` → `adapter.isAuthorizedSeller` → `registry.hasRoles(labelhash, ROLE_SELL_SLOT, seller)` | `test_UnauthorizedAgencyCannotListHero`, `test_AgencyAuthorizedForHeroCannotListSidebar` |
| Authorization is per slot, not per publisher | The EAC resource is the name's resource | `test_GrantIsPerSlotNotPerPublisher` |
| Revocation takes effect immediately | Nothing is cached; every call re-reads | `test_RevokedAgencyCannotListHero`, and live in the E2E run |
| A revocation mid-auction cancels the sale and refunds everyone | `finalizeAuction` re-checks and cancels | `test_RevokedSellerCancelsListingAndRefundsEveryone` |
| A delegated seller can never redirect payment | `Campaign.publisher = registry.getOwner(labelhash)`, read on chain | `test_AuthorizedAgencyCanListHero` |
| A delegated seller cannot sub-delegate | ENSv2 `_getSettableRoles` returns regular roles only on a non-root resource | `test_AuthorizedAgencyCannotSubDelegate` |
| An expired slot is unsellable | `getOwner` returns zero past expiry | `test_ExpiredSlotHasNoOwnerAndNoSeller` |
| Advertiser funds are escrowed, not held by a party | `safeTransferFrom` into the marketplace at bid time | `test_BidEscrowsRealUsdc` |
| The highest bid wins; ties go to the earliest | `finalizeAuction` | `test_HighestBidWins`, `test_TieGoesToEarliestBid` |
| Losing bidders recover their escrow in full, once | `withdrawBid` | `test_LoserGetsFullRefund`, `test_LoserCannotWithdrawTwice` |
| The winner cannot withdraw | `withdrawBid` | `test_WinnerCannotWithdraw` |
| Only the Chainlink receiver can move settlement | `applyDelivery` is `msg.sender == settlementReceiver` | `test_OnlySettlementReceiverMaySettle`, and live in the E2E run |
| Only the Chainlink Forwarder can reach the receiver | `ReceiverTemplate.onReport` | `test_ReceiverRejectsCallsNotFromForwarder` |
| A replayed report pays nothing | Cumulative + monotonic settlement | `test_ReplayingTheSameReportPaysZero` |
| A lower report is rejected outright | `NonMonotonicReport` | `test_DecreasingReportRevertsWhileActive` |
| Payment never exceeds the target | `effective = min(cumulative, target)` | `test_OverTargetIsCappedAndClosesCampaign` |
| The undelivered remainder returns to the advertiser | `closeCampaign` after the deadline | `test_CloseRefundsTheUndeliveredRemainder` |
| `paid + refund == budget`, always | Explicit invariant assertions | `test_Invariant_PaidPlusRefundEqualsBudget` |
| The contract is never insolvent | Balance vs `outstandingLiabilities()` at every stage | `test_Invariant_ContractBalanceCoversLiabilities` |
| The rendered creative is the one that was bought | SDK hashes fetched bytes, compares to on-chain `creativeHash`, refuses on mismatch | `packages/sdk/src/slot.ts`; live in `browser-check` |
| A viewer's clock cannot move a view into a campaign window | Collector stamps `observedAt` from the chain; `clientTime` is used by no rule | `qualify.test.ts` "ignores the browser-supplied clock entirely" |
| A batch altered after closing is rejected | The enclave recomputes the digest over the bytes it received | `workflow.test.ts` "refuses a batch whose digest does not match its events" |
| Nothing confidential crosses to the DON | Only five scalars are encoded | `workflow.test.ts` "the report carries only the five public scalars" |

## Trusted (assumptions, stated so they can be argued with)

1. **The measurement collector reports what it observed.** It is a normal server run by whoever
   operates ProofAds. A dishonest collector could invent view events. What limits the damage: the
   batch is immutable and digest-committed once closed, the digest reaches the chain in every
   settlement, and the enclave rejects any payload whose digest does not match. That makes
   tampering *after* the fact detectable; it does not make fabrication *before* the fact impossible.
   Removing this assumption is the largest open problem in the design — see `NEXT_PHASE.md`.
2. **The browser SDK is not the security boundary.** Anything running in a viewer's browser can be
   scripted. The SDK's rules are a measurement definition, not an attestation. A single session can
   earn at most one unit, which bounds the value of scripting one browser but not of scripting many.
3. **The enclave is an enclave.** ProofAds relies on AWS Nitro attestation and Chainlink's
   verification of it. We do not verify attestation documents ourselves.
4. **The Chainlink DON and Forwarder behave as specified.** A compromised Forwarder could deliver
   arbitrary reports. The receiver additionally supports pinning the workflow author, id and name —
   configure `setExpectedAuthor` after the first simulation.
5. **The publisher's ENS name is the publisher's.** ProofAds inherits ENS's ownership model whole.
   If a name is transferred or its controller compromised, so is the ad inventory.
6. **The `com.proofads.domain` text record is unverified.** It says which website a slot claims to
   be on. Nothing checks it. Do not read it as proof of domain control.
7. **ENSv2 on Sepolia is a beta.** Its contracts are explicitly "not yet final", and its two
   published address sets currently disagree (see `PROTOCOL_RESEARCH.md` §1.6).
8. **Creative URIs are fetched over plain HTTPS from wherever the advertiser pointed.** Availability
   is the advertiser's problem; integrity is covered by the hash check, but a URI that stops
   resolving simply stops earning.
9. **`DEV_MODE` must be false in any public deployment.** `DeploySepolia.s.sol` hardcodes `false`;
   `devApplyDelivery` reverts with `DevModeDisabled` when it is
   (`test_DevPathIsCompiledOutWhenDevModeFalse`).

## Explicitly out of scope

Bot detection; cross-device identity; viewability standards beyond the single 10-second definition;
brand-safety or content moderation; any claim about a human being present.
