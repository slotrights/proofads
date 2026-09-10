# Architecture decisions

Format: **decision · why · what it cost**. Where the plan said one thing and reality said another,
the entry records both.

---

### ADR-001 — Selling rights are an application-defined EAC role on a registry that extends `PermissionedRegistry`

`AdInventoryRegistry is PermissionedRegistry`, constructed with `(labelStore, publisher, ALL_ROLES)`,
adding `ROLE_SELL_SLOT = 1 << 40` and a one-line `isAuthorizedSeller` view.

**Why.** It is real Enhanced Access Control doing real work: `grantRoles` / `revokeRoles` /
`hasRoles` are ENS's own functions, the token-regeneration side effects are ENS's own behaviour,
and the marketplace's check is a single external view call. The role's name says what it means.

**Cost.** ProofAds inherits ENSv2 beta semantics wholesale, including mutable token ids (ADR-002)
and the 15-assignees-per-role ceiling.

**Fallbacks that were not needed.** The plan pre-designed two: a stock `UserRegistryImpl` proxy with
the same bit, and a `PermissionedResolver` record capability. Neither was used — the custom
subclass compiled and deployed on the first attempt once `contracts-v2`'s submodule graph was
wired up.

---

### ADR-002 — Slot identity is `keccak256(abi.encode(registry, labelhash))`, never a token id

**Why.** `PermissionedRegistry._onRolesGranted` calls `_regenerate`, which burns and re-mints the
ERC-1155 token with a new id. Any application keyed on token id would lose its state every time a
publisher delegated or revoked — exactly the operation this product is about. Including the
registry address in the identity means two publishers can both have a `hero` without colliding.

**Cost.** The UI cannot use the token id as a stable handle; it displays it as a curiosity instead.

---

### ADR-003 — The publisher and payout address are read from ENS, never supplied by a caller

`adapter.getPublisher(labelhash) == registry.getOwner(labelhash)`, read at listing creation and
again at finalization. `Campaign.publisher` is frozen from the second read.

**Why.** It is the difference between "an agency may sell this slot" and "an agency may sell this
slot and take the money". Tested: `test_AuthorizedAgencyCanListHero` asserts the listing's publisher
is the ENS owner, not the caller.

---

### ADR-004 — Authorization is checked at listing time *and* at finalization; an active campaign survives a later revocation

`finalizeAuction` re-reads `isAuthorizedSeller`. If the role was revoked mid-auction, the listing is
cancelled and every bid becomes withdrawable. Once a campaign is active, revoking the seller's role
does not claw back the advertiser's placement.

**Why.** A publisher must be able to fire an agency at any point before a deal closes. After it
closes, an advertiser has paid and a publisher has committed; unwinding that on a third party's
action would make the escrow meaningless.

---

### ADR-005 — First-price sealed-outcome auction; ties go to the earliest bid

`placeBid` escrows the full budget; `finalizeAuction` picks the highest `unitPrice` and, on a tie,
the lowest bid index. One bid per address per listing. No Vickrey, no bid revision.

**Why.** It is the smallest mechanism that makes escrow, winner selection, and loser refunds all
real. The plan carried a buy-now fallback under time pressure; it was not needed.

**Cost.** Bids are public before the auction ends — a real deployment would want a commit/reveal
round. Named in `OPEN_ITEMS.md`.

---

### ADR-006 — Settlement is cumulative and idempotent

A report carries `cumulativeVerifiedUnits`, not a delta. `applyDelivery` computes
`effective = min(cumulative, target)`, `payoutDelta = effective × unitPrice − paidAmount`, and
reverts on a report lower than the last (`NonMonotonicReport`).

**Why.** Reports can be replayed, delivered out of order, or duplicated by a retry. Cumulative
plus monotonic makes every one of those a no-op instead of a double payment. Tested:
`test_ReplayingTheSameReportPaysZero`, `test_IncrementalDeliveryPaysOnlyTheDelta`,
`test_OverTargetIsCappedAndClosesCampaign`, and asserted again live in the E2E run.

---

### ADR-007 — Cron trigger, not a log trigger

The workflow is registered with `CronCapability`, and the batch to settle is supplied through
workflow config.

**Why.** The cron path needs no on-chain event to exist before the workflow can run, which keeps
the demo one step shorter and the failure modes fewer.

**Cost.** Settlement is scheduled rather than requested. A `SettlementRequested` log trigger is the
first item in `NEXT_PHASE.md`.

---

### ADR-008 — The measurement collector is Fastify + Postgres with immutable batches

Four tables. Events are append-only; the single mutation any event row ever receives is `batch_id`,
written once when a batch closes. Closing twice yields two batches and leaves the first untouched
(`test: leaves the first batch untouched when a second is closed`).

**Why.** The digest the enclave re-verifies is only meaningful if the underlying rows cannot change
after the fact.

---

### ADR-009 — Website binding is **not** implemented

The `com.proofads.domain` text record is metadata. Nothing verifies that the publisher controls
that DNS name.

**Why.** DNSSEC-based binding is a real piece of work and half of it is worse than none — it would
invite the reading that ProofAds proves domain control. The UI never says "ENS-verified domain",
and the README says plainly that domain ownership is not verified.

---

### ADR-010 — Image creatives only, hash-verified before render

The advertiser commits `keccak256(creativeBytes)` on chain at bid time. The SDK fetches the URI,
hashes the bytes it received, and refuses to render on a mismatch.

**Why.** Without it, "the winning creative" would mean "whatever the URI serves today". With it,
swapping the creative after the auction makes the ad disappear rather than silently succeed.

**Cost.** The creative host must send permissive CORS headers, because the browser has to read the
bytes to hash them. Noted in `OPEN_ITEMS.md`.

---

### ADR-011 — Next.js 15 + wagmi + viem; the demo publisher is a route in the same app

**Why.** One deployment instead of two, and the SDK is still consumed as a real workspace package
by that route rather than being inlined.

---

### ADR-011a — Injected wallet connector instead of RainbowKit *(deviation from the plan)*

**Expected.** The plan specified RainbowKit.
**Actual.** `wagmi/connectors`' `injected()` only.
**Reason.** RainbowKit needs a WalletConnect project id and a large dependency tree for a demo
driven from one browser wallet on one machine.
**Replacement.** `apps/web/lib/wagmi.ts` is the only file that would change.
**Impact.** Mobile wallets cannot connect. Irrelevant to the demo; noted in `OPEN_ITEMS.md`.

---

### ADR-012 — One `.eth` name (`proofads-pub.eth`); the agency is an address

**Why.** The prize-critical mechanism is the per-slot role, not the number of names. A second name
for the agency would cost registration time and demonstrate nothing extra.

---

### ADR-013 — Delivery decisions use collector-stamped **chain time**, never the browser's clock *(added during the build)*

Every accepted event is stamped `observedAt` from the latest block timestamp. `qualify` uses
`observedAt` for the campaign-window check; `clientTime` is stored for the record and used by no
rule. `observedAt` is part of the canonical digest projection, so it is covered by the batch hash.

**Why it exists.** The first real-browser run settled zero units: the browser's `Date.now()` and
the chain's timestamp disagreed, and the qualification rule was reading the browser's clock. The
cheap fix would have been a tolerance window. The correct fix is that a viewer must not be able to
move a view into a campaign window by changing the clock on their own machine.

**Cost.** One RPC read per event upload. Tested in `qualify.test.ts` ("ignores the browser-supplied
clock entirely") and in the collector suite ("stamps every event with chain time, overwriting
whatever the browser sent").

---

### ADR-014 — A local CRE harness exists alongside the real workflow *(added during the build)*

`workflows/proofads-delivery/local-harness/` executes the real `onSettle` with a synchronous
stand-in for the CRE runtime: the secret from an env var, HTTP via `curl`, the report delivered by
`cast send` from a designated forwarder key.

**Why.** The CRE CLI could not be installed in the build environment, and a vertical slice that
cannot be run is not a vertical slice. The harness imports the handler rather than reimplementing
it, so the code the judges review is the code the demo runs.

**What it is not.** Not a TEE, not consensus, not attestation. Its README says so in a table, and
nothing in the repository describes a harness run as a confidential execution.

---

### ADR-016 — The settled total comes from the contract, and batches are deduplicated by digest *(added during the build)*

Two changes made together:

- `ProofAdsMarket` records `batchApplied[campaignId][batchDigest]`. A report carrying a digest the
  campaign has already applied is an explicit no-op — it emits `DeliveryAlreadyApplied` and
  returns, **before** the campaign-status check, so a Forwarder retry never reverts even after the
  campaign closed.
- The workflow no longer takes "how much has already been paid" from the measurement collector. It
  reads `market.verifiedUnitsOf(campaignId)` through the DON and adds only this batch's count.

**Why it exists.** The first version stamped `previouslySettledUnits` onto the batch when the
collector closed it. Close two batches before either settles and the second carries a stale figure
and under-reports — a real bug in a perfectly ordinary operating mode, not a theoretical one. It
also put the party ProofAds trusts least in charge of the arithmetic that decides payment.

**What it buys.** Ordering no longer matters, retries no longer matter, and the collector cannot
influence how much is owed — only how much was *observed*. Tested:
`test_TwoDistinctBatchesEachCountOnce`, `test_RetryingAnAppliedBatchAfterCloseIsANoOp`,
`test_DecreasingReportFromANewBatchReverts`, and in the workflow suite
`"ignores the collector's claim about what has already been paid"`.

**Cost.** One extra on-chain read per settlement, and a second hand-written CRE binding
(`contracts/evm/ts/generated/ProofAdsMarket.ts`).

---

### ADR-015 — No `cancelListing`; an unbid listing is cancelled at finalization *(minor deviation)*

**Expected.** The plan said a listing with no bids "simply expires unfinalized".
**Actual.** `finalizeAuction` on a listing with no bids marks it `CANCELLED` and frees the slot.
**Reason.** Leaving the slot permanently blocked by a dead listing is a worse outcome than one
extra branch. Tested: `test_NoBidsCancelsListingAndFreesSlot`.
