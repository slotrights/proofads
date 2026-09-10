# ProofAds — build report

What was built, how it was verified, what it costs you to finish, and where it is weak.

---

## 1. What exists

A working vertical slice of an advertising marketplace in which **ENSv2 decides who may sell an ad
placement** and **a Chainlink Confidential Workflow decides what was delivered**, with USDC escrow
in between.

The slice runs end to end today, on a local chain carrying the **real ENSv2 contracts** compiled
from `ensdomains/contracts-v2` @ `48b3e2d`. It has been driven both by a script and by a real
Chromium browser. Nothing about ENS, USDC or the Chainlink report path is mocked; the only stand-in
anywhere is a documented replacement for the CRE *runtime* (not the workflow), which exists because
the CRE CLI could not be installed in the build environment.

### The eleven steps that run, in order

1. The publisher owns `hero.ads.proofads-pub.eth` and `sidebar.ads.…` in an ENSv2 registry.
2. The publisher grants `ROLE_SELL_SLOT` on `hero` — and only `hero` — to an agency.
3. The agency's attempt to list `sidebar` reverts `SellerNotAuthorized`. So does `hero` after a
   revoke. Both succeed again after a re-grant.
4. The agency lists `hero`. The contract derives the publisher from ENS, not from the caller.
5. Two advertisers bid; each escrows `unitPrice × targetUnits` in real ERC-20 USDC.
6. The auction finalizes: highest unit price wins, ENS authorization is re-read at that instant, and
   a revocation mid-auction cancels the sale and makes every bid withdrawable.
7. The loser withdraws in full; the winner's budget stays locked.
8. A browser loads the publisher page. The SDK reads the active campaign from chain, fetches the
   creative, hashes the bytes, and renders only if the hash matches what the advertiser committed
   to. It then measures ten seconds at ≥50% viewport on a foregrounded tab.
9. The collector stamps each event with **chain time**, stores it append-only, and closes an
   immutable batch committed by a keccak digest.
10. The confidential handler fetches that batch from inside an enclave using a Vault DON secret,
    recomputes the digest over the bytes it received, qualifies the events, reads the already-settled
    total from the marketplace, and emits five scalars. The Forwarder delivers them; the receiver
    calls `applyDelivery`; the publisher receives 0.20 USDC for one delivered unit of two.
11. After the deadline anyone closes the campaign and the advertiser gets the undelivered 0.20 back.

## 2. How it was verified

| Suite | Command | Result |
|---|---|---|
| Contracts | `cd contracts && forge test` | **74 passed** |
| Confidential workflow | `cd workflows/proofads-delivery/my-workflow && bun test` | **43 passed** |
| Collector (real Postgres) | `pnpm --filter @proofads/api test` | **20 passed** |
| Measurement SDK | `pnpm --filter @proofads/sdk test` | **11 passed** |
| ENS helpers | `pnpm --filter @proofads/ens-client test` | **7 passed** |
| End-to-end on chain | `pnpm --filter @proofads/e2e start` | **35/35 assertions** |
| Real browser | `node apps/e2e/browser/browser-check.mjs` | **PASS** |
| Types | `pnpm -r typecheck` | clean |

The tests that matter most are the ones that would be easy to fake and are not:

- `workflow.test.ts` serialises everything handed to `usingTheDons()` and **fails** if it contains
  the enclave secret, a session id, a visibility ratio or an origin. The privacy claim is enforced
  by the build, not asserted in a comment.
- `qualify.test.ts` "ignores the browser-supplied clock entirely" — a viewer setting their clock to
  1970 or to next year changes nothing.
- `test_Invariant_ContractBalanceCoversLiabilities` checks the marketplace's USDC balance against the
  sum of every outstanding obligation at four different points in a campaign's life.
- The E2E script asserts the *reverts* as carefully as the successes, including that the deployer
  cannot call `applyDelivery`.

## 3. Two things changed during the build because testing found real problems

**The viewer's clock was load-bearing, and should not have been (ADR-013).** The first real-browser
run settled zero units: the browser's `Date.now()` and the chain's timestamp disagreed and the
campaign-window rule was reading the browser's clock. The cheap fix was a tolerance window. The
correct fix is that the collector stamps every event with the latest block timestamp, that stamp is
covered by the batch digest, and the qualification rules never look at `clientTime` at all.

**The collector was doing arithmetic it should not be trusted with (ADR-016).** "How much has
already been paid" was stamped onto the batch by the collector at close time. Close two batches
before either settles and the second under-reports — a real bug in an ordinary operating mode. Now
the marketplace records which batch digests it has applied (so retries and out-of-order reports are
no-ops), and the workflow reads the settled total from the contract itself. The collector defines
what was *observed*; the chain defines what was *paid*.

Both are recorded as ADRs rather than quietly fixed, because "we found this by running it" is the
part of a hackathon build that is worth showing.

## 4. What you must do to finish

Full runbook: **`docs/DEPLOYMENT_PLAN.md`**. Roughly 60–90 minutes, most of it waiting.

| # | Task | Needs a human? | ~Time |
|---|---|---|---|
| 1 | Chainlink CRE account, `cre login`, `cre account access` | yes | 10 min |
| 2 | Sepolia RPC + Etherscan key; five funded wallets; Circle USDC into two of them | yes | 20 min |
| 3 | **Verify the ENSv2 Sepolia addresses** — two official sources disagree | yes | 10 min |
| 4 | Register `proofads-pub.eth` (ENS app, or the included script) | yes | 10 min |
| 5 | `forge script DeploySepolia` then `SetupInventorySepolia` | no | 10 min |
| 6 | Deploy the collector somewhere with a **public HTTPS URL** + Postgres | yes | 15 min |
| 7 | Deploy the web app; check the creative host sends CORS | yes | 10 min |
| 8 | One real `cre workflow simulate --broadcast`; save the terminal output | no | 10 min |
| 9 | Record the video (`docs/PRESENTATION.md` has the shot list) | yes | 30 min |
| 10 | Fill in `docs/DEPLOYMENTS.md`; submit selecting **ENS** and **Chainlink** only | yes | 15 min |

Step 3 is the one people skip and regret: `docs.ens.domains` and the `contracts-v2` repository
currently publish different Sepolia addresses for the same contracts. The scripts assert bytecode
exists and accept `ENS_*` overrides, so this is a five-minute check rather than a redeploy — if you
do it first.

Step 8 is the highest-value remaining action. Everything else has been demonstrated in some form;
a real CRE simulation is the one piece of Chainlink evidence that only a machine with the CLI can
produce.

## 5. Where it is weak

Full list: **`docs/OPEN_ITEMS.md`**. The three that a judge will find:

1. **The collector can fabricate views.** Immutability and the digest make tampering *after* a batch
   closes detectable. Fabrication *before* is the open problem, stated as assumption 1 in the trust
   model, with three concrete remedies in `NEXT_PHASE.md`.
2. **Domain binding does not exist.** ProofAds proves who may sell an *ENS name*, not who may sell
   *a website's* inventory. Until that gap closes it is an ENS-name marketplace rather than an
   `ads.txt` replacement, and the README says so.
3. **Nothing is on Sepolia yet.** The environment had no route to one. The local chain runs the real
   ENS contracts, which is closer than it sounds, but it is not a public deployment.

And one that is not a weakness but reads like one until explained: `cre workflow simulate` has never
run. The workflow is real code with 43 tests against the real SDK, and the same `onSettle` function
executes end to end in the repository's own harness — whose README states in a table exactly which
parts of CRE it stands in for. Nothing in the repository describes a harness run as a confidential
execution.

## 6. Judgement on prize fit

**ENS — Best Use of ENSv2.** Strong. The requirement is that ENSv2 features be *central, not
cosmetic*, and here the product has no authorization model at all without Enhanced Access Control.
`AdInventoryRegistry` extends ENS's own `PermissionedRegistry`, so the tests exercise ENS's code.
The demonstration is a revert, which is more convincing than any diagram. The "no hardcoded values"
requirement is met deliberately and visibly — every badge in the UI is a fresh contract read, and
after a grant the page refetches rather than updating optimistically.

**Chainlink — Best Confidential Workflow.** Strong on substance, with one honest gap. All four
categories of confidential input the prize names are present; the integration is load-bearing
(nobody is paid without it); and the privacy boundary is enforced by a test rather than claimed in
prose. The gap is that a live `cre workflow simulate` run has not happened yet — thirty minutes of
work on a machine with the CLI, and it is Phase 6 of the plan.

**World — Selfie Check.** Not claimed, and should not be. Access was never granted. The premium
metric is built, tested and switched off, which is the honest position and the one the sponsor would
respect.

## 7. Where everything is

| | |
|---|---|
| Start here | `README.md` |
| How to finish | `docs/DEPLOYMENT_PLAN.md` |
| How to present it | `docs/PRESENTATION.md`, `docs/DEMO.md` |
| Why it is built this way | `docs/ARCHITECTURE_DECISIONS.md` |
| What was verified against sources | `docs/PROTOCOL_RESEARCH.md` |
| What is enforced vs trusted | `docs/TRUST_MODEL.md` |
| Prize requirement → evidence | `docs/PRIZE_REQUIREMENTS.md` |
| Everything incomplete | `docs/OPEN_ITEMS.md` |
| What phase 2 is | `docs/NEXT_PHASE.md` |
| Proof it runs | `docs/evidence/` |
