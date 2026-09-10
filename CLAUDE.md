# ProofAds — working agreement

- **Chain**: Ethereum Sepolia (`11155111`) for the public deployment; a local Anvil chain carrying
  the real ENSv2 contracts for development. Payment token: Circle USDC, 6 decimals.
- **Never hardcode an address in app code.** Import from `packages/shared/src/addresses.ts`, or read
  it from the generated `apps/web/.env.local` / `contracts/deployments/*.json`.
- **Never hardcode protocol state.** Authorization, ownership, campaign data and balances are read
  from chain on every query. Configuration (slot labels, RPC URLs) may be static.
- **Never fake a sponsor integration.** No `authorized = true` in the frontend, no constant returned
  from a TEE handler, no database value pretending to be a Chainlink report.
- **Never commit secrets.** `.env*` is gitignored except the two `.example` files.
- **Slot identity** is `keccak256(abi.encode(registryAddress, labelhash))`. Never an ENS token id —
  ENSv2 regenerates token ids on every role change.
- **Delivery decisions never depend on a clock the viewer controls.** The collector stamps
  `observedAt` from the latest block; `clientTime` is advisory and is excluded from every rule.

## Commands

```bash
cd contracts && forge test            # after every contract change
cd workflows/proofads-delivery/my-workflow && bun test   # after every workflow change
pnpm -r typecheck                     # before every commit
pnpm -r test                          # TypeScript suites
pnpm --filter @proofads/e2e start     # full vertical slice on the local chain
```

## Claims

See README "What ProofAds does not claim". Wording rules: "liveness-checked", never "unique human";
"simulated confidential execution", never "ran in a production enclave" unless it did.

## MVP rule

Write the simplest code that satisfies the requirement and its test. No abstractions for a single
call site, no generic patterns, no proxies of our own, no indexer, no queues, no caching unless
something is measurably slow, no fuzz suites where explicit assertions do the job.
