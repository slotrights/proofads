# Presenting ProofAds to the judges

Two audiences read the same submission differently. The ENS judge wants to know whether ENSv2 is
load-bearing or decorative. The Chainlink judge wants to know whether anything genuinely
confidential happens, or whether a TEE was bolted on for the prize. The plan below answers both in
the first thirty seconds and then proves it.

---

## 1. The one-sentence pitch

> ProofAds turns advertising inventory into a programmable, revocable rights hierarchy on ENSv2,
> and lets advertisers pay only for measurable attention whose raw measurement data is evaluated
> privately inside a Chainlink Confidential Workflow before USDC settles on Ethereum.

If you only get one more sentence: *"ads.txt, but per-placement, revocable, and enforced by a
contract that re-reads ENS on every call — paired with delivery measurement that stays private."*

## 2. The video (3:00, ≥720p)

Record from a clean browser profile. Say the numbers out loud; judges often watch muted first and
then re-watch with sound.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:20 | The Sepolia Times demo page | "Two things in advertising are assertions nobody can check: who may sell this space, and what was actually delivered. Both are fixable, and they need different tools." |
| 0:20–0:55 | `/publisher`, both slots, badges live | "Every ad slot is an ENSv2 name. The right to sell one is an Enhanced Access Control role — nybble 10, unused by ENS itself. I grant it on `hero` to this agency." *(grant tx confirms; the badge flips after a refetch from chain, not optimistically)* |
| 0:55–1:15 | Agency lists `sidebar` → wallet error | "Same agency, same publisher, different slot. `SellerNotAuthorized`. This is ENS deciding, not our database." |
| 1:15–1:30 | Revoke, retry `hero` → same revert, then re-grant | "Revocation is immediate. There is no cache to invalidate — the contract asks ENS at the moment of the call." |
| 1:30–1:50 | `/advertiser`: two bids, Etherscan escrow, finalize, loser withdraws | "0.15 and 0.20 USDC per verified view, both escrowed on chain. Highest wins; the loser takes their money back in full." |
| 1:50–2:10 | Demo page, hero renders, ten-second timer | "The SDK asks the marketplace which campaign owns this ENS slot, fetches the creative, hashes the bytes, and refuses to render if the hash doesn't match what the advertiser committed to." |
| 2:10–2:40 | `cre workflow simulate … --broadcast` terminal | "This is the Chainlink Confidential Workflow. Inside the enclave: a Vault DON secret, an authenticated fetch of the raw batch — every session id, every visibility trace — and the qualification logic. **This is a simulation; deployment is private beta.** What crosses back out is five numbers." |
| 2:40–2:55 | Forwarder tx → `DeliveryApplied` → publisher +0.20 USDC | "One of two units delivered. The publisher is paid 0.20. The other 0.20 is still escrowed." |
| 2:55–3:00 | `closeCampaign` → advertiser +0.20 USDC | "ENS defines who may sell. Chainlink privately determines what was delivered. The contract pays only for that." |

**Must appear on screen:** a real wallet revert for `SellerNotAuthorized`; the escrow balance on
Etherscan; the CRE simulator's own "not a real TEE" banner; the Forwarder transaction; both USDC
balance changes.

**Never say:** "trustless advertising", "proves a human saw it", "eliminates ad fraud",
"ENS-verified domain", or "ran in a production enclave".

## 3. What to lead with, per judge

**ENS judge — open with the revert, not the architecture.** Diagrams are cheap; a wallet refusing a
transaction because a role was revoked forty seconds ago is not. Then, in order:

1. `AdInventoryRegistry is PermissionedRegistry` — we extend ENS's contract, we do not reimplement
   an interface. `forge test` runs ENS's own EAC code.
2. `ROLE_SELL_SLOT = 1 << 40` is nybble 10, and `PROTOCOL_RESEARCH.md` §1.3 shows the table of
   which nybbles `RegistryRolesLib` already uses and why 10–29 are free.
3. The mutable-token-id trap: ENSv2 regenerates the ERC-1155 token id on *every* role change, so
   ProofAds keys everything by labelhash. We found that in `_onRolesGranted → _regenerate` and
   there is a test named after it.
4. Nothing in the UI is hardcoded, including the badges — that requirement is explicit on the
   prize page and `PRIZE_REQUIREMENTS.md` maps it to the file.

**Chainlink judge — open with the boundary table.** The question they are really asking is "would
this project work without the TEE?" Answer: yes, but only by publishing a viewing log, which is the
thing it exists to avoid.

1. The four categories of confidential input the prize asks for — a secret, a confidential API
   response, private parameters, intermediate values — and ProofAds has all four. Name them.
2. The five scalars that leave. Then: `workflow.test.ts` serialises everything handed to
   `usingTheDons()` and **fails the build** if it contains the token, a session id, a visibility
   ratio or an origin. The privacy claim is a test, not a comment.
3. Meaningful integration: `applyDelivery` reverts for every caller except the forwarder-gated
   receiver. Delete the workflow and nobody is ever paid.
4. Say the deployment status before they ask.

## 4. Questions you will be asked

**"Does this prove a human saw the ad?"**
No, and we never say it does. It proves a browser rendered a specific image, at least half in the
viewport, on a foregrounded tab, for ten seconds. The README's "does not claim" list is the first
thing under the architecture.

**"What stops the measurement collector from making up views?"**
Nothing, and that is assumption 1 in `TRUST_MODEL.md`. What the design does buy: once a batch is
closed it is immutable and digest-committed; the digest goes on chain with every settlement; and
the enclave recomputes it over the bytes it received, so tampering *after* the fact is detectable.
Fabrication before the fact is the honest open problem, and it is the first item in `NEXT_PHASE.md`.

**"Why does this need a blockchain?"**
For the authorization, because revocation needs to be enforceable by the party relying on it rather
than announced to it. For the settlement, because the escrow has to be releasable by neither the
buyer nor the seller. Notice what is *not* on chain: the measurement data — which is exactly why
the confidential workflow is doing real work rather than decorating.

**"Why does this need a TEE rather than a ZK proof?"**
A ZK proof of "these events qualify" is a better long-term answer and is in `NEXT_PHASE.md`. It is
also a research project. The TEE gets the same property today with an attestation assumption we
state plainly.

**"Is the Chainlink part actually running?"**
The workflow is real code with 43 tests against the real SDK, and the same `onSettle` function runs
end to end in the repository's own harness. `cre workflow simulate` is what a live demo shows.
Deployment is private beta and we do not claim otherwise.

**"What's the business model?"**
There isn't one yet, and `OPEN_ITEMS.md` §D says so — including the awkward part, which is that the
agency that sold the slot currently earns nothing on chain.

## 5. What to show if you get exactly sixty seconds

1. `/publisher` — grant on `hero`, badge flips (5s).
2. Agency lists `sidebar` — wallet reverts `SellerNotAuthorized` (10s).
3. Revoke — the same `hero` listing now reverts too (10s).
4. Terminal: `cre workflow simulate --broadcast`, point at the "not a real TEE" banner and at the
   line showing counts only, no session ids (20s).
5. Etherscan: Forwarder → `DeliveryApplied(campaign, 1, 1, 200000)` → publisher balance (15s).

## 6. Submission checklist

- [ ] Public repo, MIT, real commit history (not one squashed commit)
- [ ] Video 2–4 min, ≥720p, unlisted link that resolves logged out
- [ ] Live demo URL
- [ ] Description covers: the problem → ENS → Chainlink → settlement → what is not claimed
- [ ] Prizes selected: **ENS — Best Use of ENSv2**, **Chainlink — Best Confidential Workflow**. Nothing else.
- [ ] AI attribution present (README, last section)
- [ ] `docs/DEPLOYMENTS.md` filled in with real Sepolia hashes
- [ ] Tag `v0.1.0-ethonline`
