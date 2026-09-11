# ProofAds

**Advertising inventory as a revocable ENSv2 rights hierarchy, settled against delivery that is
verified privately inside a Chainlink Confidential Workflow.**

> ProofAds turns advertising inventory into a programmable, revocable rights hierarchy on ENSv2,
> and lets advertisers pay only for measurable attention whose raw measurement data is evaluated
> privately inside a Chainlink Confidential Workflow before USDC settles on Ethereum.

Positioning: *ads.txt-style seller authorization, but granular, revocable, programmable, and
enforced per ad slot by ENSv2.*

## Live demo

**<https://proofads.charmine.xyz>**

Running against the Ethereum Sepolia deployment in [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md).
Bring a wallet on Sepolia; every value on every screen is read from chain.

| Page | What it shows |
|---|---|
| [/](https://proofads.charmine.xyz) | The inventory — each ad slot, its ENS name, its owner and who may sell it |
| [/publisher](https://proofads.charmine.xyz/publisher) | Grant and revoke `ROLE_SELL_SLOT`; the authorization badge flips on the next block |
| [/advertiser](https://proofads.charmine.xyz/advertiser) | Bid with escrowed USDC, finalize, withdraw a losing bid |
| [/demo-publisher](https://proofads.charmine.xyz/demo-publisher) | "The Sepolia Times" — a real page carrying the winning creative. Keep the slot in view for ten seconds and it earns a measured unit. |

---

## The problem

Two load-bearing pieces of the advertising supply chain are assertions that nobody can enforce:

1. **Who may sell this inventory.** `ads.txt` is a plaintext file at the root of a domain listing
   authorized resellers. It is domain-wide, not per-placement; revoking a seller means editing a
   file and waiting for crawlers; and nothing checks it at the moment of a transaction.
2. **What was actually delivered.** The buyer pays against a number produced by a party with an
   interest in that number being large, computed over data the buyer never sees.

Putting the measurement data on a blockchain does not fix (2) — it publishes a viewing log. That
is the tension ProofAds is built around: delivery must be *verifiable* without being *public*.

## What ProofAds does

| Layer | Mechanism |
|---|---|
| **Who may sell** | Each ad slot is an ENSv2 name (`hero.ads.proofads-pub.eth`) in a registry that extends `PermissionedRegistry`. The right to sell it is `ROLE_SELL_SLOT`, an application-defined Enhanced Access Control role. The marketplace calls `hasRoles(...)` at the moment of the transaction — never a cached copy. |
| **Who gets paid** | The payout address is `registry.getOwner(labelhash)`, read on chain at listing time and again at finalization. A delegated seller can sell the slot but can never redirect the money. |
| **What money does** | An advertiser's winning bid escrows `unitPrice × targetUnits` of USDC in the marketplace contract. It is released only as delivery is verified, and the undelivered remainder is refunded. |
| **What was delivered** | Raw view events are evaluated inside an AWS Nitro enclave by a Chainlink CRE Confidential Workflow. Sessions, visibility timelines and the collector's API token stay inside. One aggregate — `(campaignId, cumulativeVerifiedUnits, batchDigest, windowStart, windowEnd)` — crosses back out, is signed by the DON, and reaches the marketplace through the Chainlink Forwarder. |

## What ProofAds does *not* claim

These lines are load-bearing; the project is careful about them everywhere, including in the UI.

- It does **not** prove a human being looked at an advertisement. It proves a browser rendered a
  specific image, at least half in the viewport, on a foregrounded tab, for ten seconds.
- It does **not** eliminate fraud. A determined operator can run browsers.
- It does **not** verify that the publisher controls the DNS domain in the ENS text record. Domain
  binding is not implemented — see [OPEN_ITEMS.md](docs/OPEN_ITEMS.md).
- It is **not** "trustless advertising". The measurement collector is trusted to report what it
  observed; the enclave is trusted to be an enclave. [TRUST_MODEL.md](docs/TRUST_MODEL.md) is the
  full list.
---

## Architecture

```
                    ENSv2 (Sepolia beta)                          ProofAds
  ┌───────────────────────────────────────────┐    ┌──────────────────────────────────┐
  │ RootRegistry ──"eth"──▶ ETHRegistry       │    │  ENSv2AuthorizationAdapter       │
  │                    │                      │    │   getPublisher(labelhash)        │
  │           "proofads-pub"                  │◀───┤   isAuthorizedSeller(label,who)  │
  │                    ▼                      │    └───────────────┬──────────────────┘
  │              UserRegistry                 │                    │ live reads
  │                    │                      │                    ▼
  │                 "ads"                     │    ┌──────────────────────────────────┐
  │                    ▼                      │    │  ProofAdsMarket                  │
  │      AdInventoryRegistry                  │    │   createListing / placeBid       │
  │        (PermissionedRegistry              │    │   finalizeAuction / withdrawBid  │
  │         + ROLE_SELL_SLOT = 1<<40)         │    │   applyDelivery / closeCampaign   │
  │            │            │                 │    └───────▲──────────────┬───────────┘
  │         "hero"      "sidebar"             │            │ onlyReceiver │ USDC
  └───────────────────────────────────────────┘            │              ▼
                                                 ┌─────────┴─────────┐  publisher / advertiser
                                                 │ SettlementReceiver │
                                                 │  (forwarder-gated) │
                                                 └─────────▲─────────┘
                                                           │ signed report
                    ┌──────────────────────────────────────┴───────────────────────┐
                    │        Chainlink CRE — cre.handlerInTee (AWS Nitro)          │
                    │  ┌────────────────── inside the enclave ──────────────────┐  │
   browser SDK      │  │ Vault secret ─▶ authenticated GET /internal/batches/:id │  │
   ─────────▶ collector │ recompute digest ─▶ qualify(sessions, visibility, …)   │  │
   10s in view      │  └──────────────────────────┬─────────────────────────────┘  │
                    │        usingTheDons() ──────┘ only the aggregate leaves      │
                    └──────────────────────────────────────────────────────────────┘
```

## Repository layout

```
contracts/                    Foundry. AdInventoryRegistry, adapter, market, receiver, scripts.
  lib/contracts-v2/           ensdomains/contracts-v2 @48b3e2d (fetched by contracts/setup-deps.sh)
apps/api/                     Measurement collector: Fastify + Postgres, immutable batches.
apps/web/                     Next.js 15 UI + "The Sepolia Times" demo publisher page.
apps/e2e/                     End-to-end proof on a local chain, plus a real-browser check.
packages/shared/              ABIs, addresses, enums, zod schemas, the batch digest.
packages/sdk/                 @proofads/sdk — browser measurement and slot mounting.
packages/ens-client/          viem helpers for ENSv2, and the .eth registration script.
workflows/proofads-delivery/  CRE TypeScript project: qualify.ts, workflow.ts, tests, harness.
docs/                         Research, ADRs, trust model, demo script, deployment plan, evidence.
```

## Quick start (local, no testnet needed)

Everything below runs against a **local Anvil chain carrying the real ENSv2 contracts**, compiled
from `ensdomains/contracts-v2`. Nothing about ENS is mocked.

```bash
# prerequisites: node ≥20, pnpm ≥9, bun, foundry, postgres
pnpm install
./contracts/setup-deps.sh          # clones contracts-v2 @48b3e2d + submodules

./scripts/dev-stack.sh --e2e
```

That one script starts Postgres and Anvil, deploys the full ENSv2 hierarchy plus ProofAds, points
the collector and the web app at the fresh deployment, and then runs the end-to-end proof —
35 assertions covering grant → revocation-revert → listing → escrowed bids → finalization →
refund → 10-second measurement → immutable batch → confidential handler → forwarder → USDC payout →
close → refund. Output is kept in [`docs/evidence/e2e-run.txt`](docs/evidence/e2e-run.txt).

Then open http://127.0.0.1:3000/demo-publisher, and:

```bash
# put a fresh campaign on the hero slot and watch a real browser earn a unit
WEB_URL=http://127.0.0.1:3000 pnpm --filter @proofads/e2e seed
node apps/e2e/browser/browser-check.mjs
```

Step by step instead of the one script: `pnpm deploy:local`, `node scripts/write-web-env.mjs local`,
`pnpm --filter @proofads/api start`, `pnpm --filter @proofads/web build && … start`,
`pnpm --filter @proofads/e2e start`.

## Testing

| Suite | Command | Count |
|---|---|---|
| Contracts (Foundry) | `cd contracts && forge test` | 74 |
| Confidential workflow (bun) | `cd workflows/proofads-delivery/my-workflow && bun test` | 43 |
| Collector (vitest, real Postgres) | `pnpm --filter @proofads/api test` | 20 |
| Measurement SDK (vitest) | `pnpm --filter @proofads/sdk test` | 11 |
| ENS helpers (vitest) | `pnpm --filter @proofads/ens-client test` | 7 |
| End-to-end on chain | `pnpm --filter @proofads/e2e start` | 35 assertions |
| Real browser | `node apps/e2e/browser/browser-check.mjs` | pass/fail |

`pnpm -r typecheck` covers every TypeScript package.

## Deployments

Four contracts on **Ethereum Sepolia** (`11155111`), block 11674651, all verified on Etherscan.

| Contract | Address | What it is |
|---|---|---|
| `AdInventoryRegistry` | [`0x9c85fd2E…9dA6a`](https://sepolia.etherscan.io/address/0x9c85fd2E10298504B468E685012B66DE2dB9dA6a) | The inventory. Extends ENS's `PermissionedRegistry`; each ad slot is a real ENSv2 name, and `ROLE_SELL_SLOT` is the right to sell it. |
| `ENSv2AuthorizationAdapter` | [`0x051EBAB1…82975`](https://sepolia.etherscan.io/address/0x051EBAB12B02F27693e0D0E271308Fd64f482975) | Stateless reads of ENS: who owns a slot, and who may sell it *right now*. Caches nothing. |
| `ProofAdsMarket` | [`0x60e462CD…eaeDd`](https://sepolia.etherscan.io/address/0x60e462CD627A162a3213ae6159e6850977CeaeDd) | Listings, first-price auction, USDC escrow, settlement and refunds. Pays the slot's ENS owner, never the caller. |
| `ProofAdsSettlementReceiver` | [`0x2dd6236E…8FF54`](https://sepolia.etherscan.io/address/0x2dd6236E42266Cf61B2a14109C40b0DB8E58FF54) | The only door into settlement. Forwarder-gated; decodes the confidential workflow's signed report into `applyDelivery`. |

The publisher's `UserRegistry` and `PermissionedResolver` are ENS implementations behind
`VerifiableFactory` proxies. Circle USDC, the ENSv2 beta contracts and the Chainlink
`KeystoneForwarder` were already on Sepolia and are only referenced.

See [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md) for every address, the transaction hashes behind
each claim, and the commit they were deployed from.

## Documentation

- [ARCHITECTURE_DECISIONS.md](docs/ARCHITECTURE_DECISIONS.md) — the ADRs and where reality forced a change
- [NOVELTY.md](docs/NOVELTY.md) — prior art, and what is and is not new here
- [OPEN_ITEMS.md](docs/OPEN_ITEMS.md) — every incomplete or under-specified area, named
- [NEXT_PHASE.md](docs/NEXT_PHASE.md) — what phase 2 is

