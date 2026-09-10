# Deployments

## Ethereum Sepolia (11155111) — DEPLOYED

Deployed by `contracts/script/DeploySepolia.s.sol` at commit `3e06fb4`, block 11674651
(2026-09-09). Deployer, publisher and slot owner are the same wallet:
`0x0552AF1e9645A26309092f1E3aA014AbafAA7B80`. All four contracts are verified on Etherscan.

| Contract | Address | Deploy tx |
|---|---|---|
| `AdInventoryRegistry` | `0x9c85fd2E10298504B468E685012B66DE2dB9dA6a` | `0xd1c0797f76b0832fb9b37be10b9b334b69561b9eecdb853b9b0acc09c9527d3c` |
| `ENSv2AuthorizationAdapter` | `0x051EBAB12B02F27693e0D0E271308Fd64f482975` | `0xa5a3bbf54c5231a7f9fdbe1911dce2fff10d31efa4241cdd47694bb17d28664c` |
| `ProofAdsMarket` (`DEV_MODE = false`) | `0x60e462CD627A162a3213ae6159e6850977CeaeDd` | `0x7f7e41f9af759bd35abff5eda925532f4dd8fe461448ac590fb2171687f5a427` |
| `ProofAdsSettlementReceiver` | `0x2dd6236E42266Cf61B2a14109C40b0DB8E58FF54` | `0x01641409107af98936bc06244a3b7b27230dd94ceb23f2b8085b9b12587fcc61` |
| Publisher `UserRegistry` (proxy) | `0xed98dE1ee4e1ca1FB5500B31e466A5C73e3a7e72` | via `VerifiableFactory`, `0xef518654dcd0e1c8fdd024aa0a6c118d5ed692531c4ae4fc56c049b447ad40dd` |
| Publisher `PermissionedResolver` (proxy) | `0x16E9F3F133b4cf67Ccae34837Bd41c4c1fEA9aCF` | via `VerifiableFactory`, `0x85a32b41b8dc014152e746ae372abe9b500f7a90bbcb8dfedd50745e2602b197` |

`market.setSettlementReceiver(...)`, the one-shot wiring that makes the receiver the only door
into settlement: `0x9b94223e9651b104ae3ac748d610f37422e881f96919d7de3d02b730bbe24812`.

### Pre-existing contracts used (verify before trusting — `PROTOCOL_RESEARCH.md` §1.6)

| What | Address | Source |
|---|---|---|
| ENS `LabelStore` | `0x532CD0CC4AC0793d838F71A67d29B2D790D18777` | docs.ens.domains, 9 Sep 2026 |
| ENS `RootRegistry` | `0x8115186E8f2E0B0281e86ab91f0f48Ba90364354` | docs.ens.domains |
| ENS `ETHRegistry` | `0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2` | docs.ens.domains |
| ENS `ETHRegistrar` | `0xa88553F454b77203B0D036A05c894d555EAAa2Cc` | docs.ens.domains |
| ENS `VerifiableFactory` | `0x10dC6333CDFe1FCEf624c6e0a8221b91804Cd7ef` | docs.ens.domains |
| ENS `UserRegistryImpl` | `0x624a25d67B59D587752EbEc8DdeD8827dAe52050` | docs.ens.domains |
| ENS `PermissionedResolverImpl` | `0x9EAe5C2730a7dD16BDD1DeE6421a1B91e3B0365e` | docs.ens.domains |
| ENS `UniversalResolverV2` | `0x4A1817d13E9cF196f471725176355C1234b63C70` | docs.ens.domains |
| ENS `MockUSDC` (pays for `.eth` names only) | `0x768F42455A2D082E23ceeF7d51e5787C82d67a39` | docs.ens.domains |
| **Circle USDC** (settlement currency, 6 dp) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | developers.circle.com |
| Chainlink `KeystoneForwarder` | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` | CRE starter-template READMEs |

### ENS names

Registered on the ENSv2 Sepolia beta, all owned by `0x0552…7B80`.

`proofads-pub.eth` itself was registered through the ENSv2 `ETHRegistrar` commit/reveal flow
before the setup script ran; the hashes below are the **wiring** transactions from
`SetupInventorySepolia.s.sol` (blocks 11674737–11674750) — attaching each subregistry and
resolver — not the `.eth` registration itself.

| Name | Registry | Setup tx |
|---|---|---|
| `proofads-pub.eth` | `ETHRegistry` `0xBDC8…F0E2` | `0xa170391cf15561a6cbb8b4f5505f8594da512a3717566d5326753529b6c769d2` |
| `ads.proofads-pub.eth` | publisher `UserRegistry` `0xed98…a7e72` | `0x336a7ae6f463f002d4fac48e781c372b06d300abd8d907ed99682faccc570894` |
| `hero.ads.proofads-pub.eth` | `AdInventoryRegistry` `0x9c85…dA6a` | `0x1fca25d9f1acd6e727158d750b1069bd711fea809654be77cd28ba5c4de6637b` |
| `sidebar.ads.proofads-pub.eth` | `AdInventoryRegistry` `0x9c85…dA6a` | `0x033d8d7ea7fb12a44cc1f937cb2a2a78d9bfd71403dcafbe17ea9c91330ec7d4` |

Text records on the publisher's `PermissionedResolver`:
`0x8f1a5fcf…`, `0x8015d632…`, `0xe38f8be0…`, `0x7fccd14a…`.

### Demonstration transactions

Run `./scripts/harvest-sepolia-evidence.sh` to regenerate this from chain logs — it derives event
names from the compiled ABI, so it cannot drift from the contracts.

| What | Tx hash |
|---|---|
| Confidential workflow settlement, campaign 1 | `0x7068177d302a2e2c9e0cc8e85bf32e0c11b0837d6a1f15f9cbe5bd716d1d106f` |
| Confidential workflow settlement, campaign 2 — **failed, kept deliberately** | `0xf50c335068be3d3942362c29a4f7f382e04de7ff98c0b21e98268ec1b6450e9f` |
| Confidential workflow settlement, campaign 2 — succeeded | `0x320ea411dca80ff25cc457cd52995eb50fa4a6f16fde05e8c711deac3536e29b` |
| `createListing` / `placeBid` / `finalizeAuction` / `DeliveryApplied` / `CampaignClosed` | *(harvest with the script above)* |

**The settlement that worked.** `0x320ea411…36e29b`, the same batch and the same report as the
failed attempt, re-run after ADR-017 raised the gas limit. One unit of verified attention:

| | Before | After |
|---|---|---|
| `verifiedUnitsOf(2)` | 0 | 1 |
| Publisher USDC | 18.000000 | 18.110000 |
| Marketplace escrow | 0.220000 | 0.110000 |

Campaign 2 was listed by a **delegated seller** (`0x5cAE3014bE16BB9EE74127D36b9cF1683Ec25207`)
holding `ROLE_SELL_SLOT` on `hero`, while the payout address is the slot's ENSv2 owner
(`0x0552AF1e9645A26309092f1E3aA014AbafAA7B80`). The agency sold the inventory; the money went to
the publisher. That separation is the ENS claim, demonstrated on a public network rather than
asserted.

Twenty raw measurement events entered the enclave; one unit came out. The nineteen rejections are
visibility heartbeats within a single browsing session — a session earns at most one unit, and the
session ids, visibility traces and client timestamps that prove it never left the enclave.

The failed settlement is kept in this table on purpose. It is a transaction with
`status 1 (success)` that paid nobody: `applyDelivery` reverted `OutOfGas` inside Circle's
`FiatTokenV2_2.transfer`, and the Chainlink Forwarder caught the revert and recorded
`ReportProcessed(result: false)`. It is the evidence behind ADR-017 and the reason
`contracts/test/SettlementGasBudget.t.sol` exists.

### Off-chain

| What | Value |
|---|---|
| Measurement collector | `http://127.0.0.1:8787` (local; the CRE simulator runs the workflow locally, so no tunnel is required) |
| Web app | `http://127.0.0.1:3000` |
| CRE workflow name | `proofads-delivery-staging` |
| CRE CLI | v1.32.0 |
| Confidential Workflow deployment | private beta; not granted. Everything here is `cre workflow simulate`, including `--broadcast`. |

---

## Local Anvil (31337) — fully working, this is what the evidence files show

Deployed by `contracts/script/DeployLocal.s.sol`, which stands up the **real ENSv2 contracts**
(`LabelStore`, `PermissionedRegistry` ×3, `PermissionedResolver` behind a `VerifiableFactory` proxy)
compiled from `ensdomains/contracts-v2` @ `48b3e2d`, and then ProofAds on top.

Addresses from the most recent `./scripts/dev-stack.sh` run (deterministic — a cold run of that
script reproduces them exactly):

| Contract | Address |
|---|---|
| `LabelStore` (ENSv2) | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| `VerifiableFactory` (ENSv2) | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| Root `PermissionedRegistry` | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| `.eth` `PermissionedRegistry` | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |
| Publisher `UserRegistry` | `0x948B3c65b89DF0B4894ABE91E6D02FE579834F8F` |
| **`AdInventoryRegistry`** | `0x712516e61C8B383dF4A63CFe83d7701Bce54B03e` |
| Publisher `PermissionedResolver` (proxy) | `0x13137042E4A02D4cFDeC3DB5934d8D6C97D86509` |
| `ENSv2AuthorizationAdapter` | `0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` |
| `ProofAdsMarket` (`DEV_MODE = false`) | `0x8A791620dd6260079BF849Dc5567aDC3F2FdC318` |
| `ProofAdsSettlementReceiver` | `0x610178dA211FEF7D417bC0e6FeD39F05609AD788` |
| `MockUSDC` (6 dp) | `0xa513E6E4b8f2a923D98304ec87F64353C4D5C853` |
| Forwarder stand-in (local only) | `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` |

Addresses are regenerated on every `pnpm deploy:local`; the current set always lives in
`contracts/deployments/local.json`, and `node scripts/write-web-env.mjs local` copies it into the
web app's build environment. Roles: publisher `0x7099…79C8`, agency `0x3C44…93BC`, advertiser A
`0x90F7…b906`, advertiser B `0x15d3…6A65` (Anvil's well-known keys — no value on any real network).

### Evidence in this repository

| File | What it is |
|---|---|
| `evidence/e2e-run.txt` | The full vertical slice, 35/35 assertions, every step a real transaction or HTTP call |
| `evidence/browser-check.txt` | A real Chromium rendering the hash-verified creative and producing one qualifying view |
| `evidence/browser-settlement-run.txt` | The confidential handler settling that browser-measured campaign; publisher balance 0.20 → 0.40 USDC |
| `evidence/local-harness-browser-run.txt` | An earlier run, kept because it shows the enclave **correctly rejecting** a view whose client clock disagreed with chain time — the observation that produced ADR-013 |
| `evidence/demo-publisher.png` | The demo publisher page as the browser check saw it |
| `evidence/ui-*.png` | Every screen, with all "Technical details" panels expanded |
