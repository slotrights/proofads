# Local CRE harness

`cre workflow simulate` is the real thing and is what the submission demonstrates. This
directory exists so the **same** `onSettle` handler can also be executed end to end on a
machine that does not have the CRE CLI — for example in CI, or while developing against a
local Anvil chain.

It is **not** a TEE and does not claim to be. It is a stand-in for the CRE *runtime*:

| Real CRE                                                  | This harness                                   |
|-----------------------------------------------------------|------------------------------------------------|
| Vault DON releases the secret into an attested enclave     | reads `SECRET_PROOFADS_API_TOKEN` from the env |
| `HTTPClient.sendRequest` runs inside the enclave           | a synchronous `curl` from this process         |
| DON reaches consensus and the Forwarder submits the report | `cast send` from a designated forwarder key    |

What is identical in both: `workflow.ts`, `qualify.ts`, the digest re-verification, the ABI
encoding of the report, and the receiver + marketplace contracts that consume it. The harness
imports the handler; it does not reimplement it.

```bash
bun install
SECRET_PROOFADS_API_TOKEN=... API_BASE_URL=http://127.0.0.1:8787 \
BATCH_ID=... CAMPAIGN_ID=1 RECEIVER_ADDRESS=0x... \
RPC_URL=http://127.0.0.1:8545 FORWARDER_PRIVATE_KEY=0x... \
bun run run.ts
```
