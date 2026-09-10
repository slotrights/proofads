# Phase 2

Ordered by how much each item changes what ProofAds can honestly claim, not by effort.

---

## Tier 1 — closes a hole in the trust story

### 1. Make the collector accountable (the big one)

Today the collector is trusted to report what it observed (`TRUST_MODEL.md` assumption 1). Three
increasingly strong answers:

- **Multi-collector attestation** (~1 week). Two or three independent collectors observe the same
  slot; the enclave receives all their batches and counts a unit only where they agree. Turns
  "trust the operator" into "trust that not all operators collude" — the move `ads.txt` never made.
- **Publisher counter-signature** (~2 days). The publisher signs each closed batch digest; the
  enclave rejects an unsigned batch. Cheap, and it means the collector cannot invent delivery for a
  publisher who did not agree it happened.
- **Client-side receipts** (~1 week). The SDK signs each qualifying event with a per-session
  ephemeral key derived from a server nonce. Does not defeat a scripted browser, but makes
  server-side fabrication require forging signatures rather than inserting rows.

### 2. Settlement requested on chain, not scheduled off it

Add `ProofAdsMarket.requestSettlement(campaignId, batchId)` emitting `SettlementRequested`, and a
second `cre.handlerInTee` on that log trigger (`--evm-tx-hash … --evm-event-index 0`). Removes the
operator's discretion over *when* and *which batch* settles. ~2h — ADR-007 already anticipates it.

### 3. Domain binding

The `com.proofads.domain` record is currently decorative (ADR-009). Options, weakest first: a
signed `/.well-known/proofads.json` challenge (~4h); DNSSEC proof through ENS's DNS registrar
(~2 days). Until one exists, ProofAds is an ENS-name marketplace, not an `ads.txt` replacement —
and that gap is the difference between an interesting demo and a product.

## Tier 2 — makes it usable by someone other than us

### 4. Multi-publisher discovery

The contracts are already publisher-agnostic; the UI is not. Needs an inventory index — either a
registry-of-registries contract, or a subgraph. ~1 week with the indexer.

### 5. Sealed bids

Commit/reveal on `unitPrice` so late bidders cannot undercut by one unit (ADR-005, `OPEN_ITEMS` A4).
~1 day.

### 6. Agency economics

Right now the publisher receives 100% and the agency that did the selling receives nothing on chain
(`OPEN_ITEMS` §D). A `sellerFeeBps` on the listing, frozen into the campaign at finalization and
paid out of each `payoutDelta`, is a day's work and makes the model coherent.

### 7. World Selfie Check

The premium metric is built and switched off. Once access lands: the IDKit v4 flow on the demo page,
`POST /world/request` and `/world/verify` on the collector, nullifier storage as `NUMERIC(78,0)`,
and `WORLD_FEEDBACK.md` written **while** integrating. ~1 day. See `WORLD_STATUS.md`.

### 8. Operational hardening

Rate limiting on `/events`; scheduled batch closing; a pause switch on the marketplace; metrics; a
real migration tool instead of idempotent DDL.

## Tier 3 — research

### 9. Replace the TEE with a proof

A ZK circuit over the batch that proves "these events satisfy these rules" without an attestation
assumption. Strictly better than a TEE for this exact shape of problem — a fixed rule set over a
bounded batch — and strictly harder. The confidential workflow is the pragmatic version of the same
idea and would remain the fallback path.

### 10. Richer metrics

Video completion, scroll depth, interaction. Each is a new measurement definition, a new
qualification branch and a new set of arguments about what counts. The architecture takes them; the
industry consensus does not exist.

### 11. Cross-chain settlement

Publishers on one chain, advertisers on another, via CCIP. Deliberately out of scope for the
hackathon (single-chain rule) and a real ask from anyone operating at scale.

---

## What we would *not* do

- **A token.** Nothing in the design needs one, and adding one would make the escrow worse.
- **An on-chain measurement log.** It is the exact thing the confidential workflow exists to avoid.
- **Claiming human attention.** Everything above stays inside "a browser rendered this for this
  long". The moment ProofAds claims more, its distinguishing feature — being checkable — is gone.
