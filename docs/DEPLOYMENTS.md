# Deployments

## Ethereum Sepolia (11155111) — NOT YET DEPLOYED

The environment this was built in has no network route to any Sepolia RPC, so nothing has been
deployed to a public network. `DEPLOYMENT_PLAN.md` is the runbook; fill this table in as you go and
do not let a hash go unrecorded.

| Contract | Address | Deploy tx | Deployer | Commit | Timestamp |
|---|---|---|---|---|---|
| `AdInventoryRegistry` | | | | | |
| `ENSv2AuthorizationAdapter` | | | | | |
| `ProofAdsMarket` (`DEV_MODE = false`) | | | | | |
| `ProofAdsSettlementReceiver` | | | | | |
| Publisher `UserRegistry` (proxy) | | | | | |
| Publisher `PermissionedResolver` (proxy) | | | | | |

### Pre-existing contracts used (verify before trusting — `PROTOCOL_RESEARCH.md` §1.6)

| What | Address | Source |
|---|---|---|
| ENS `LabelStore` | `0x532CD0CC4AC0793d838F71A67d29B2D790D18777` | docs.ens.domains, 9 Sep 2026 |
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

| Name | Owner | Registration tx |
|---|---|---|
| `proofads-pub.eth` | publisher wallet | |
| `ads.proofads-pub.eth` | publisher wallet | |
| `hero.ads.proofads-pub.eth` | publisher wallet | |
| `sidebar.ads.proofads-pub.eth` | publisher wallet | |

### Demonstration transactions to keep

| What | Tx hash |
|---|---|
| `grantRoles(hero, ROLE_SELL_SLOT, agency)` | |
| Agency lists `sidebar` → reverts `SellerNotAuthorized` | |
| `revokeRoles(hero, …)` | |
| Agency lists `hero` after revoke → reverts | |
| `grantRoles` again | |
| `createListing(hero)` | |
| `placeBid` advertiser A (0.15) | |
| `placeBid` advertiser B (0.20) | |
| `finalizeAuction` | |
| `withdrawBid` advertiser A | |
| Chainlink Forwarder → `onReport` → `DeliveryApplied` | |
| `closeCampaign` → advertiser refund | |
| Direct `applyDelivery` → reverts `NotSettlementReceiver` | |

### Off-chain

| What | Value |
|---|---|
| Measurement collector (public HTTPS) | |
| Web app | |
| CRE workflow name | `proofads-delivery-staging` |
| CRE workflow author address | |
| Repository commit at submission | |

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
