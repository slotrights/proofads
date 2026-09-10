# World Selfie Check — why it is not claimed

## Status: **not integrated, not submitted for**

World's Selfie Check is access-gated. Enabling it requires emailing
`developers@toolsforhumanity.com` (or a World contact) to have the feature flag turned on for a
specific app id, and the Sandbox app is distributed through TestFlight or a private Play link.
That access was not granted for this build.

The rule we set ourselves at the start and kept: **a sponsor integration is either real or absent.**
There is no mock Selfie Check flow, no "I am human" checkbox standing in for a credential, no
simulated verification payload, and no World prize selected on the submission.

## What is already in the codebase

The premium metric was designed in from the beginning so that enabling it is a switch, not a
refactor:

| Piece | Where | State |
|---|---|---|
| `MetricType.SELFIE_CHECKED_VIEW_10_SECONDS = 1` | `packages/shared/src/enums.ts` | Present, selectable in the type system |
| Qualification branch requiring verified liveness | `workflows/…/my-workflow/qualify.ts` | Implemented and tested — a session without a verified credential is rejected with `WORLD_ELIGIBILITY_MISSING` |
| Tests for both outcomes | `qualify.test.ts` | "premium metric rejects a session with no verified liveness credential" / "…counts a session whose liveness credential was verified" |
| `world_verifications` table — nullifier as `NUMERIC(78,0)`, unique per (campaign, session) and per (campaign, nullifier) | `apps/api/src/db/{schema,migrate}.ts` | Created, never written to |
| Per-session `worldEligible` boolean in the enclave payload | `apps/api/src/app.ts` | Present, always `false` today |
| SDK refusal path | `packages/sdk/src/slot.ts` | A campaign with the premium metric renders an explanatory placeholder instead of measuring an ineligible view |
| Privacy boundary | `apps/api` | The nullifier never leaves the collector — the enclave receives a boolean. Asserted in `api.test.ts`: "reports only booleans about World eligibility, never a nullifier" |

## What turning it on would take (~1 day)

1. Create the app and action in the World Developer Portal; obtain `app_id` and `rp_id`; get the
   Selfie Check flag enabled and the Sandbox app installed.
2. Read `docs.world.org/world-id/idkit/integrate`, `/world-id/credentials/11` and
   `/world-id/sandbox/testing-selfie-check`, and record the **exact** preset identifier, IDKit
   version and response shape. Do not assume the World ID 3.0 shape.
3. Collector: `POST /world/request` (sign with `signRequest({ signingKeyHex, action })`,
   `signal = sessionId`) and `POST /world/verify` (forward the IDKit payload unchanged to
   `POST https://developer.world.org/api/v4/verify/{rp_id}`, store the nullifier, reject duplicates
   per campaign).
4. Demo page: an IDKit state-machine card (Not checked → Checking… → Liveness verified / Failed /
   Expired). The SDK starts counting only after `world_verified`.
5. Write `WORLD_FEEDBACK.md` **while** integrating — the prize asks for a feedback document, and it
   is worthless if written afterwards from memory.

## Wording, if it is ever enabled

"Liveness verified", "Selfie Check complete". **Never** "unique human", "verified person" or "proof
of personhood". Selfie Check is a medium-assurance liveness and facial-similarity signal. Its honest
role in ProofAds is exactly what the prize describes — a low-friction risk and eligibility signal
that lets an advertiser pay a premium for inventory which cleared a bot filter — not an identity
claim.
