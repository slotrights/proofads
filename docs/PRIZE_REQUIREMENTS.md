# Sponsor requirements → evidence

Requirements are quoted from the ETHOnline 2026 prize pages (fetched 9 September 2026). Each row
names the file, test or artefact that satisfies it.

---

## ENS — Best Use of ENSv2 ($4,500)

> Build on ENSv2 beta (Sepolia testnet) featuring hierarchical registry, wildcard resolution,
> Enhanced Access Control, and Permissioned Resolvers.

| Requirement | How ProofAds meets it | Evidence |
|---|---|---|
| **Built on ENSv2 (Sepolia)** | `AdInventoryRegistry` *extends* `PermissionedRegistry` from `ensdomains/contracts-v2` @48b3e2d — not an interface copy. Sepolia scripts use ENS's deployed `LabelStore`, `ETHRegistry`, `VerifiableFactory`, `UserRegistryImpl` and `PermissionedResolverImpl`. | `contracts/src/AdInventoryRegistry.sol`, `contracts/script/DeploySepolia.s.sol`, `contracts/script/SetupInventorySepolia.s.sol` |
| **Hierarchical registry** | `root → "eth" → ETHRegistry → "proofads-pub" → UserRegistry → "ads" → AdInventoryRegistry → "hero"/"sidebar"`, with `setParent` wired so the hierarchy is traversable both ways. | `contracts/script/DeployLocal.s.sol`, `packages/ens-client/src/registry.ts::resolveRegistryPath` |
| **Enhanced Access Control, central to the product** | The right to sell a slot **is** an EAC role: `ROLE_SELL_SLOT = 1 << 40`, granted and revoked with ENS's own `grantRoles`/`revokeRoles`, checked with ENS's own `hasRoles` at the moment of every marketplace call. Remove EAC and the product has no authorization model at all. | `AdInventoryRegistry.sol`, `ENSv2AuthorizationAdapter.sol`, `ProofAdsMarket.createListing` / `finalizeAuction`; 19 tests in `AdInventoryRegistry.t.sol` |
| **Permissioned Resolvers** | Slot metadata lives in `PermissionedResolver` text records (`com.proofads.placement`, `com.proofads.domain`), written through its EAC-gated `setText` and read by the UI. | `DeployLocal.s.sol::_setTextRecords`, `apps/web/lib/chain.ts::useSlots` |
| **Functional demo with no hardcoded values** | Every authorization badge, owner, expiry, listing, bid and campaign field in the UI is a live contract read. `apps/web/lib/config.ts` holds only addresses, injected from the deployment JSON at build time. After a grant or revoke the UI refetches from chain rather than updating optimistically. | `apps/web/lib/chain.ts`, `apps/web/components/TxButton.tsx`, screenshots in `docs/evidence/` |
| **Open-source code** | MIT, whole repository. | `LICENSE` |
| **Video or live demo** | Live deployment, plus a recorded walkthrough of grant → revoke → list → bid → finalize → measured delivery → settlement. | Submission page; screenshots in `docs/evidence/` |

**The ENS demonstration in one paragraph.** An agency is granted `ROLE_SELL_SLOT` on `hero` and
nothing else. It lists `hero` successfully. The identical call against `sidebar` reverts with
`SellerNotAuthorized`. The publisher revokes; the same call against `hero` now reverts too. The
publisher re-grants; it works again. All four outcomes are decided inside ENSv2, and the same four
appear in `docs/evidence/e2e-run.txt` as on-chain transactions.

---

## Chainlink — Best Confidential Workflow ($2,000)

> Build privacy-preserving applications using Chainlink Runtime Environment (CRE) Confidential
> Workflows with hardware-isolated Trusted Execution Environments.

| Requirement | How ProofAds meets it | Evidence |
|---|---|---|
| **Uses a confidential TEE handler (`handlerInTee`, TypeScript)** | `cre.handlerInTee(cronTrigger.trigger({schedule}), onSettle, [{ tee: 'nitro', regions: ['us-west-2'] }])` | `workflows/proofads-delivery/my-workflow/workflow.ts`; `workflow.test.ts` asserts `requirements` is present, which only `handlerInTee` sets |
| **Processes at least one sensitive input, secret, confidential API response, private parameter or intermediate value inside the enclave** | All four. A Vault DON **secret** (`PROOFADS_API_TOKEN`); a **confidential API response** (the raw batch: session ids, visibility ratios, per-session liveness flags, timings); **private parameters** (the campaign's target and previously-settled counts); and **intermediate values** (per-session dedup state, per-reason rejection counts) that never leave. | `workflow.ts` steps 1–4, `qualify.ts` |
| **Meaningfully integrated into core functionality** | It is the only thing that can release money. `ProofAdsMarket.applyDelivery` reverts for every caller except the forwarder-gated receiver. Delete the workflow and no publisher is ever paid. | `ProofAdsMarket.sol`, `test_OnlySettlementReceiverMaySettle` |
| **Evidence via demo video, terminal output, execution logs or deployment details** | Terminal output of the handler run, the report bytes, the settlement transaction and the resulting USDC movement. | `docs/evidence/e2e-run.txt`, `docs/evidence/browser-settlement-run.txt` |

**The privacy boundary, stated precisely.**

| Crosses **into** the enclave (confidential) | Crosses **out** (public, DON-signed) |
|---|---|
| `PROOFADS_API_TOKEN` from the Vault DON | `campaignId` |
| The authenticated HTTP request carrying it | `cumulativeVerifiedUnits` |
| The HTTP response: every event, session id, visibility ratio, `observedAt`, origin | `batchDigest` |
| Per-session dedup state, per-reason rejection counts | `windowStart`, `windowEnd` |

Asserted, not just claimed: `workflow.test.ts` serialises everything handed to `usingTheDons()` and
fails if it contains the token, a session id, a visibility ratio, or an origin.

**Honesty about deployment.** Confidential Workflows are in private beta for deployment.
`cre workflow simulate` is what the demo shows, and the simulator prints its own banner saying it
is not a real TEE. The repository says "simulated confidential execution" everywhere and never
claims a production enclave run. The local harness (`local-harness/README.md`) states in a table
exactly which parts of CRE it stands in for.

---

## World — Selfie Check ($3,500)

**Not claimed.** Selfie Check is access-gated and access was not granted. The premium metric
`SELFIE_CHECKED_VIEW_10_SECONDS` exists in the enum, the qualification logic, the database schema
and the SDK's refusal path — and is switched off. Nothing about it is simulated or faked. See
`WORLD_STATUS.md`. **Do not select this prize on the submission.**
