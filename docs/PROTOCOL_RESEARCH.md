# Protocol research

Everything below was verified against primary sources — the official documentation, the official
repositories, and in most cases the Solidity or TypeScript source itself. Where a source
contradicted another, the contradiction is recorded rather than resolved silently.

Date of research: **9 September 2026**.

---

## 1. ENSv2

### 1.1 Sources used

| What | Where | Verified how |
|---|---|---|
| Contracts | `github.com/ensdomains/contracts-v2` @ `48b3e2d39513b9dd32ef1850877a29009bc807b9` (3 Jul 2026) | Cloned, compiled, deployed to a local chain, and used as the ProofAds base class |
| Deployments | `docs.ens.domains/learn/deployments` | Fetched 9 Sep 2026 |

ProofAds **compiles against the real ENSv2 sources**, not against an interface transcription.
`AdInventoryRegistry is PermissionedRegistry`, so every EAC behaviour described below is executed
by ENS's own code in our tests.

### 1.2 Enhanced Access Control — how roles actually work

From `contracts/src/access-control/EnhancedAccessControl.sol` and
`libraries/EACBaseRolesLib.sol`:

- The role bitmap is a `uint256` read as **64 nybbles**. Regular roles occupy nybbles 0–31
  (`1 << 4k`); each role's admin counterpart sits 128 bits higher (`role << 128`).
- `ALL_ROLES = 0x1111…1111` — bit 0 of every nybble. `_checkRoleBitmap` reverts on any bitmap with
  bits outside those positions (`EACInvalidRoleBitmap`).
- `hasRoles(resource, bitmap, account)` ORs the account's **root-resource** roles with its
  resource-scoped roles. A holder of `ALL_ROLES` on `ROOT_RESOURCE` therefore satisfies every
  resource check without a per-name grant. *This is why the publisher does not need to grant
  itself `ROLE_SELL_SLOT`.*
- Granting is gated by `_getSettableRoles`. `PermissionedRegistry` overrides it:

  ```solidity
  if (resource != ROOT_RESOURCE && getOwner(resource) == address(0)) return 0;
  uint256 roleBitmap = super._getSettableRoles(resource, account); // withAdminRolesApplied(effective)
  return resource == ROOT_RESOURCE ? roleBitmap : roleBitmap >> 128;
  ```

  Consequences we depend on: a name must be **registered** before any role can be granted on it;
  on a non-root resource only *regular* roles are settable, so an agency holding `ROLE_SELL_SLOT`
  can never sub-delegate it (test: `test_AuthorizedAgencyCannotSubDelegate`).
- Assignee counts are packed 4 bits per role — **maximum 15 holders of a role per resource**
  (`EACMaxAssignees`). Relevant if a publisher ever delegates one slot to more than fifteen
  agencies.

### 1.3 Which nybble ProofAds may use

`contracts/src/registry/libraries/RegistryRolesLib.sol` assigns:

| Nybble | Role |
|---|---|
| 0 | `ROLE_REGISTRAR` |
| 1 | `ROLE_REGISTER_RESERVED` |
| 2 | `ROLE_SET_PARENT` |
| 3 | `ROLE_UNREGISTER` |
| 4 | `ROLE_RENEW` |
| 5 | `ROLE_SET_SUBREGISTRY` |
| 6 | `ROLE_SET_RESOLVER` |
| 8 | `ROLE_WAS_RESERVED` |
| 9 | `ROLE_SET_URI` |
| 30 | `ROLE_CAN_NAME` |
| 31 | `ROLE_UPGRADE` |
| 39 (admin-only) | `ROLE_CAN_TRANSFER_ADMIN` |

**Nybbles 10–29 are unassigned.** ProofAds takes nybble 10:

```solidity
uint256 public constant ROLE_SELL_SLOT       = 1 << 40;    // nybble 10
uint256 public constant ROLE_SELL_SLOT_ADMIN = 1 << 168;   // nybble 42
```

Asserted in `test_RoleSellSlotOccupiesFreeNybbleTen`.

### 1.4 Mutable token ids — the trap

`PermissionedRegistry._onRolesGranted` and `_onRolesRevoked` both call `_regenerate`, which burns
and re-mints the ERC-1155 token with an incremented `tokenVersionId`. **Every grant or revoke
changes the token id.** The EAC *resource* id is unaffected (it uses `eacVersionId`, bumped only on
unregister).

ProofAds therefore keys everything by labelhash, and defines slot identity as
`keccak256(abi.encode(registryAddress, labelhash))`. Asserted in
`test_TokenIdIsRegeneratedOnRoleChangeButLabelhashIsStable` and
`test_AdapterSlotIdIsRegistryScopedAndNotTokenId`, and demonstrated live in the E2E run, where the
token id after the grant is printed alongside the unchanged authorization.

### 1.5 Other API facts we rely on

- `register(label, owner, subregistry, resolver, roleBitmap, expiry)` — expiry is an absolute unix
  timestamp; caller needs `ROLE_REGISTRAR` on root; `LABEL_STORE.setLabel(label)` is called for you,
  so `LabelStore.getLabel(labelhash)` can invert a labelhash back to a string.
- `getOwner(anyId)` returns `address(0)` for an expired name — which is how an expired slot
  automatically stops being sellable (`test_ExpiredSlotHasNoOwnerAndNoSeller`).
- `anyId` accepts a labelhash, a token id or a resource interchangeably; `_entry()` zeroes the low
  32 bits to find the canonical slot.
- `grantRoles` on `ROOT_RESOURCE` reverts (`EACRootResourceNotAllowed`); use `grantRootRoles`.
- `LabelStore(IContractNamer)` accepts `address(0)`. `PermissionedResolver(address namer)` does
  **not** — its constructor grants `ROLE_CAN_NAME` to `namer` and reverts `EACInvalidAccount()` on
  zero. Found the hard way while writing `DeployLocal.s.sol`.
- `PermissionedResolver` disables initializers in its constructor, so it must be deployed behind a
  `VerifiableFactory` proxy: `deployProxy(impl, salt, initialize(admin, ALL_ROLES, []))`.
- `ETHRegistrar` (from `src/registrar/ETHRegistrar.sol`) uses commit/reveal:
  `makeCommitment(label, owner, secret, subregistry, resolver, duration, referrer)` →
  `commit(bytes32)` → wait `MIN_COMMITMENT_AGE` → `register(label, owner, secret, subregistry,
  resolver, duration, paymentToken, referrer)`. Payment is `SafeERC20.safeTransferFrom` of
  `base + premium` from `getRegisterPrice(...)`, in **ENS MockUSDC** on Sepolia, not Circle USDC.

### 1.6 Sepolia address discrepancy — unresolved upstream, handled here

`docs.ens.domains/learn/deployments` and the repo's own
`contracts/deployments/sepolia/*.json` disagree for several contracts:

| Contract | Docs page | Repo JSON |
|---|---|---|
| VerifiableFactory | `0x10dC…d7ef` | `0x118bc31a…` |
| UserRegistryImpl | `0x624a…2050` | `0x840fa461…` |
| LabelStore | `0x532C…8777` | `0xb0352428…` |
| ETHRegistrar | `0xa885…a2Cc` | `0xa4449a0d…` |
| UniversalResolverV2 | `0x4A18…3C70` | `0x85edf8b6…` |

**RESOLVED (10 Sep 2026, on Sepolia).** Every address in the docs-page set was checked with
`cast code` against a live Sepolia RPC and all eleven returned non-empty bytecode:
`LabelStore`, `ETHRegistry`, `ETHRegistrar`, `VerifiableFactory`, `UserRegistryImpl`,
`PermissionedResolverImpl`, `RootRegistry`, `UniversalResolverV2`, ENS `MockUSDC`, Circle `USDC`
and the Chainlink `KeystoneForwarder`. A functional check confirmed it too —
`ETHRegistrar.isAvailable("proofads-pub")` returned `true`, so the registrar is live and
responding, not just a contract with code at an address. **The docs-page set wins; the repo's
`deployments/sepolia/*.json` is stale.** `contracts/script/lib/SepoliaEnsV2.sol` already carries
the docs set, so no override was needed.

**How ProofAds handles it.** `contracts/script/lib/SepoliaEnsV2.sol` carries the docs-page set,
`DeploySepolia.s.sol` asserts `address.code.length > 0` for every one it touches before using it,
and **every address is overridable by an environment variable** (`ENS_LABEL_STORE`,
`ENS_ETH_REGISTRY`, …). The runbook in `DEPLOYMENT_PLAN.md` step 2 makes verifying them the first
action of the deployment. This is a real, current inconsistency in a beta protocol; the honest
engineering answer is to verify at deploy time rather than pick a side in a document.

---

## 2. Chainlink CRE — Confidential Workflows

### 2.1 Sources used

| What | Where |
|---|---|
| SDK | `@chainlink/cre-sdk@1.19.1` from npm — types read directly from `dist/` |
| Templates | `github.com/smartcontractkit/cre-templates` — `hello-confidential-workflows-ts`, `event-reactor-ts`, `keeper-bot-ts` |
| Receiver contracts | `event-reactor-ts/contracts/evm/src/{IReceiver,IERC165,ReceiverTemplate}.sol`, vendored unmodified |

### 2.2 The confidential handler

From `dist/sdk/workflow.d.ts`:

```ts
handlerInTee(trigger, fn: HandlerFn<…, TeeRuntime<TConfig>>, tees: TeeConstraint, hooks?)
```

`TeeRuntime` (`dist/sdk/impl/runtime-impl.d.ts`) offers `config`, `getSecret`, `getSecrets`,
`callCapability`, `log`, `reportFromDon` and `usingTheDons()`. `dist/sdk/tee-constraints.d.ts`
confirms **`nitro` is the only TEE and `us-west-2` the only region** the SDK will accept.

ProofAds' `workflow.ts` follows the official template's shape exactly:

1. `runtime.getSecret({ id: 'PROOFADS_API_TOKEN' })` — released by the Vault DON into the enclave.
2. `new cre.capabilities.HTTPClient().sendRequest(runtime, …)` — the `TeeRuntime` overload, which
   keeps request and response payloads confidential from node operators.
3. Integrity checks and `qualify(...)` — the actual confidential computation.
4. `runtime.usingTheDons()` — everything after this line is public.
5. `receiver.writeReport(donRuntime, abiEncodedAggregate)` — `prepareReportRequest(callData)` then
   `EVMClient.writeReport`, identical to the generated bindings in `keeper-bot-ts`.

### 2.3 What is and is not confidential

The template's own comment is explicit and we repeat it rather than overclaim:

> a confidential workflow, despite running inside the enclave, is part of the binary the Workflow
> DON provides to the enclave — so the binary, including this logic, is revealed. What the enclave
> keeps confidential is the data this logic computes over.

So: **the rules of `qualify.ts` are public** (they are in this repository, deliberately). The
**data** is not — the Vault secret, the HTTP request carrying it, the HTTP response containing every
session id and visibility trace, and every intermediate value.

### 2.4 Report → Forwarder → receiver

`ReceiverTemplate.onReport(bytes metadata, bytes report)` rejects any caller that is not the
configured `KeystoneForwarder`, and optionally validates workflow id / author / name from the
packed metadata. `ProofAdsSettlementReceiver` extends it and `abi.decode`s
`(uint256, uint32, bytes32, uint64, uint64)` before calling `ProofAdsMarket.applyDelivery`, which in
turn accepts only `msg.sender == settlementReceiver`. Two independent gates, both tested
(`test_ReceiverRejectsCallsNotFromForwarder`, `test_OnlySettlementReceiverMaySettle`).

### 2.5 Deployment status — stated plainly

Confidential Workflows are in **private beta for deployment**. Simulation via
`cre workflow simulate` works without Early Access and prints a banner saying the simulator is not
a real TEE. ProofAds says "simulated confidential execution" everywhere and never claims a
production enclave run. `DEPLOYMENT_PLAN.md` §5 has the exact commands.

Because the CRE CLI could not be installed in the environment this build ran in (its download host
is not reachable, and `cre login` needs an account), the repository also ships
`workflows/proofads-delivery/local-harness/` — a synchronous stand-in for the CRE *runtime* that
executes **the same `onSettle` function**, so the vertical slice is provable end to end today. Its
README states exactly what it does and does not stand in for. It is a development aid, not a claim.

---

## 3. USDC

- **Circle Sepolia USDC**: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, 6 decimals, faucet at
  `faucet.circle.com`. This is the ProofAds settlement currency.
- **ENS MockUSDC** on Sepolia: `0x768F42455A2D082E23ceeF7d51e5787C82d67a39`, permissionless `mint`.
  Used **only** to pay `ETHRegistrar` for a test `.eth` name. Confusing the two is an easy and
  expensive mistake; `packages/shared/src/addresses.ts` documents both with that warning.
- Local development uses `contracts/src/testing/MockUSDC.sol`, a 6-decimal ERC-20 with an open
  `mint`, deployed only by `DeployLocal.s.sol`.

## 4. ENS text-record keys used

Two, both metadata and neither authorization:

| Key | Value | Purpose |
|---|---|---|
| `com.proofads.placement` | `homepage-hero` / `homepage-sidebar` | Human-readable placement |
| `com.proofads.domain` | the demo site host | Which website the slot appears on |

Written through `PermissionedResolver.setText`, which is itself EAC-gated
(`ROLE_SET_TEXT`, nybble 1 of `PermissionedResolverLib`). **The domain record is not verified** —
see `OPEN_ITEMS.md`.

## 5. World ID

Not integrated. `WORLD_STATUS.md` explains why, and exactly what already exists in the codebase for
the day access is granted.
