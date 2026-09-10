# STATUS

Last updated at the end of the build. Honest ticks only — an item is checked when a command, a test
or a transaction proved it, not when the code was written.

## Completed

- **ENSv2 inventory.** `AdInventoryRegistry` extends the real `PermissionedRegistry` from
  `ensdomains/contracts-v2` @ `48b3e2d`, adding `ROLE_SELL_SLOT = 1 << 40` in a verified-free nybble.
  19 tests.
- **Authorization adapter.** Stateless; derives the publisher and the live selling right from ENS on
  every call.
- **Marketplace.** Listing, first-price auction with escrow, tie→earliest, seller re-check at
  finalization, loser refunds, cumulative idempotent settlement, digest-based replay protection,
  deadline close and refund. 55 tests.
- **Settlement receiver.** Extends Chainlink's own `ReceiverTemplate`; forwarder-gated; decodes the
  five-scalar report into `applyDelivery`.
- **Local ENSv2 world.** `DeployLocal.s.sol` stands up `LabelStore`, three `PermissionedRegistry`
  instances, a `PermissionedResolver` behind a `VerifiableFactory` proxy, the full
  `hero.ads.proofads-pub.eth` hierarchy and two text records — all upstream ENS code.
- **Measurement collector.** Fastify + Postgres, five routes, append-only events, immutable
  digest-committed batches, bearer-gated enclave endpoint, chain-stamped observation time. 20 tests.
- **Measurement SDK.** Pure qualification clock (10s at ≥50% viewport on a foregrounded tab, once per
  session), creative hash verification before render, slot mounting from on-chain campaign state.
  11 tests.
- **Confidential workflow.** `cre.handlerInTee` on AWS Nitro, Vault secret, in-enclave authenticated
  fetch, digest re-verification, `qualify`, on-chain read of the settled total, five-scalar report
  through the Forwarder. 43 tests against the real `@chainlink/cre-sdk@1.19.1`.
- **Web app.** Inventory, publisher dashboard (grant/revoke with live badges), advertiser
  (bid/finalize/withdraw), campaign detail, and "The Sepolia Times" demo publisher page. Every value
  read from chain; `Technical details` on every screen.
- **End-to-end proof.** 35/35 assertions on a local chain, plus a real Chromium run that renders the
  hash-verified creative, produces one qualifying view, and settles through the confidential handler
  to a 0.20 USDC payout.
- **Documentation.** Research, ADRs, trust model, prize mapping, novelty, demo script, deployment
  runbook, presentation plan, next phase, and a deliberately uncomfortable open-items register.

## Working

Everything above, on a local Anvil chain, reproducible with the commands in the README.

**155 automated tests**: 74 Foundry, 43 bun (workflow), 20 vitest (collector), 11 vitest (SDK),
7 vitest (ENS helpers). Plus **35 end-to-end assertions** against a live chain and collector, and
one real-browser check.

## Broken

Nothing known. If something is wrong it is in `docs/OPEN_ITEMS.md` §C as a weakness rather than a
failure.

## Blocked

| What | Why | Unblocked by |
|---|---|---|
| Sepolia deployment | The build environment has no network route to any Sepolia RPC | Running `docs/DEPLOYMENT_PLAN.md` on a normal machine (~60–90 min) |
| `cre workflow simulate` | The CRE CLI's download host is unreachable here, and `cre login` needs an account | Installing the CLI and running Phase 6 of the plan |
| World Selfie Check | Access-gated; not granted | `docs/WORLD_STATUS.md` |

## Next

1. `docs/DEPLOYMENT_PLAN.md` Phases 1–4 — get it onto Sepolia and capture the four ENS demonstration
   transaction hashes.
2. Phase 6 — one real `cre workflow simulate --broadcast`, and save the whole terminal output.
3. Record the video from `docs/PRESENTATION.md`.
4. Fill in `docs/DEPLOYMENTS.md` and submit, selecting **ENS** and **Chainlink** only.

## Definition of done

| Item | Status |
|---|---|
| Current ENSv2 documentation researched | ✅ `PROTOCOL_RESEARCH.md`, read from source, not just docs |
| ENSv2 Sepolia contracts verified | ⚠️ Two official sources disagree; scripts assert bytecode and allow overrides. Verify at deploy time. |
| Publisher namespace exists | ✅ locally · ⬜ Sepolia |
| Hero slot exists | ✅ locally · ⬜ Sepolia |
| Sidebar slot exists | ✅ locally · ⬜ Sepolia |
| Delegated hero seller authorization works | ✅ |
| Sidebar authorization rejection works | ✅ |
| Revocation works | ✅ |
| Marketplace reads authorization on chain | ✅ |
| Official Sepolia test USDC used | ✅ wired (`MockUSDC` locally, Circle USDC on Sepolia) · ⬜ moved on Sepolia |
| Advertisers can bid | ✅ |
| Winner selected | ✅ |
| Losing bidder refunded | ✅ |
| Winner funds remain escrowed | ✅ |
| Winning creative appears on a real publisher page | ✅ verified in Chromium |
| Visibility measurement works | ✅ |
| 10-second qualification works | ✅ |
| Immutable measurement batch created | ✅ |
| CRE Confidential Workflow processes the batch | ✅ code + 43 tests · ⚠️ executed via the repo's harness, not yet via `cre simulate` |
| Meaningful logic runs in the confidential handler | ✅ |
| Successful CRE simulation recorded | ⬜ blocked — Phase 6 |
| CRE result reaches the settlement path | ✅ Forwarder → receiver → `applyDelivery` → USDC |
| Partial publisher payout occurs | ✅ 0.20 of 0.40 |
| Unused advertiser refund occurs | ✅ 0.20 returned |
| World Selfie Check flow works | ⬜ not attempted — access-gated, not claimed |
| All smart-contract tests pass | ✅ 74 |
| Backend tests pass | ✅ 20 |
| Frontend can complete the demo | ✅ |
| Deployed addresses documented | ✅ local · ⬜ Sepolia |
| Transaction hashes preserved | ✅ local · ⬜ Sepolia |
| Trust model documented | ✅ |
| Novelty documented | ✅ |
| README complete | ✅ |
| Demo script rehearsed | ⬜ rehearse once before recording |
| No core success state is hardcoded | ✅ |
