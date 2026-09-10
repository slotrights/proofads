# Deployment plan — everything you have to do

The whole system is proven on a local chain running the real ENSv2 contracts. Nothing has been
deployed to Sepolia yet, because the machine this was built on has no route to a Sepolia RPC.
This is the runbook that closes that gap. Budget **60–90 minutes**, most of it waiting.

Legend: **[you]** needs a human (an account, a faucet, a wallet click). **[cmd]** is a command.

---

## Phase 0 — Accounts and funds (~20 min, mostly waiting on faucets)

- [ ] **[you]** Create a Chainlink CRE account at `cre.chain.link`, install the CRE CLI from
      `docs.chain.link/cre`, then `cre login` and `cre account access`.
      *Simulation works without Early Access; only deployment needs it. Request it anyway — it
      costs nothing and the reply may arrive before judging.*
- [ ] **[you]** Get a Sepolia RPC URL (Alchemy/Infura free tier) and an Etherscan API key.
- [ ] **[cmd]** Generate five keys and record the **public** addresses in `docs/DEMO.md`:
      ```bash
      for role in deployer publisher agency advertiserA advertiserB; do
        echo "$role: $(cast wallet new | tail -2 | head -1)"
      done
      ```
- [ ] **[you]** Fund all five with Sepolia ETH (≥0.2 for the deployer, ≥0.05 each for the rest).
- [ ] **[you]** Get **Circle** Sepolia USDC from `faucet.circle.com` into advertiser A and B
      (≥2 USDC each). Verify:
      ```bash
      cast call 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 "balanceOf(address)(uint256)" $ADV_A --rpc-url $SEPOLIA_RPC_URL
      cast call 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 "decimals()(uint8)" --rpc-url $SEPOLIA_RPC_URL   # must be 6
      ```
- [ ] **[cmd]** `cp .env.example .env` and fill it in. **Do not commit it.**

## Phase 1 — Verify the ENSv2 beta addresses (~10 min) ⚠️ do not skip

`docs.ens.domains` and the `contracts-v2` repo currently disagree (see `PROTOCOL_RESEARCH.md` §1.6).

- [ ] **[cmd]** Confirm each address in `contracts/script/lib/SepoliaEnsV2.sol` has bytecode:
      ```bash
      for a in 0x532CD0CC4AC0793d838F71A67d29B2D790D18777 \
               0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2 \
               0x10dC6333CDFe1FCEf624c6e0a8221b91804Cd7ef \
               0x624a25d67B59D587752EbEc8DdeD8827dAe52050 \
               0x9EAe5C2730a7dD16BDD1DeE6421a1B91e3B0365e \
               0xa88553F454b77203B0D036A05c894d555EAAa2Cc; do
        printf "%s %s\n" "$a" "$(cast code $a --rpc-url $SEPOLIA_RPC_URL | head -c 12)"
      done
      ```
- [ ] **[you]** If any is empty, take that address from
      `contracts-v2/contracts/deployments/sepolia/*.json` instead and set the matching
      `ENS_*` override in `.env`. Record which set won in `PROTOCOL_RESEARCH.md` §1.6.
- [ ] **[cmd]** Verify the Chainlink Forwarder the same way:
      `cast code 0x15fC6ae953E024d975e77382eEeC56A9101f9F88 --rpc-url $SEPOLIA_RPC_URL`

## Phase 2 — Register the publisher's `.eth` name (~10 min, includes a commit wait)

- [ ] **[you]** Easiest path: register `proofads-pub.eth` in the ENSv2 Sepolia app with the
      **publisher** wallet.
- [ ] **[cmd]** Or scripted (commit/reveal, paid in ENS MockUSDC which mints permissionlessly):
      ```bash
      PUBLISHER_PRIVATE_KEY=… SEPOLIA_RPC_URL=… \
        pnpm --filter @proofads/ens-client register-name proofads-pub
      ```
- [ ] **[cmd]** Confirm ownership:
      ```bash
      cast call $ENS_ETH_REGISTRY "getOwner(uint256)(address)" $(cast keccak proofads-pub) --rpc-url $SEPOLIA_RPC_URL
      ```

## Phase 3 — Deploy the ProofAds contracts (~5 min)

- [ ] **[cmd]**
      ```bash
      cd contracts
      forge script script/DeploySepolia.s.sol:DeploySepolia \
        --rpc-url $SEPOLIA_RPC_URL --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY
      ```
      Writes `contracts/deployments/sepolia.json`. The script asserts bytecode exists at the
      LabelStore, USDC and Forwarder before deploying, and hardcodes `DEV_MODE = false`.
- [ ] **[cmd]** Put the registry address in `.env`: `AD_INVENTORY_REGISTRY=0x…`
- [ ] **[cmd]** Record every address and tx hash in `docs/DEPLOYMENTS.md`.

## Phase 4 — Hang the inventory off the name (~5 min)

- [ ] **[cmd]**
      ```bash
      forge script script/SetupInventorySepolia.s.sol:SetupInventorySepolia \
        --rpc-url $SEPOLIA_RPC_URL --broadcast
      ```
      Deploys the publisher's `UserRegistry` and `PermissionedResolver` through ENS's
      `VerifiableFactory`, points `proofads-pub.eth` at them, registers `ads`, `hero` and
      `sidebar`, sets `setParent`, and writes the two text records. All signed by the publisher.
- [ ] **[cmd]** Merge `userRegistry` and `publisherResolver` from the console output into
      `contracts/deployments/sepolia.json`.
- [ ] **[cmd]** Prove the ENS story on the real network:
      ```bash
      REG=$(jq -r .adInventoryRegistry contracts/deployments/sepolia.json)
      HERO=$(cast keccak hero); SIDEBAR=$(cast keccak sidebar)
      cast call $REG "isAuthorizedSeller(uint256,address)(bool)" $HERO $AGENCY --rpc-url $SEPOLIA_RPC_URL   # false
      cast send $REG "grantRoles(uint256,uint256,address)" $HERO $((1<<40)) $AGENCY \
        --private-key $PUBLISHER_PRIVATE_KEY --rpc-url $SEPOLIA_RPC_URL
      cast call $REG "isAuthorizedSeller(uint256,address)(bool)" $HERO $AGENCY --rpc-url $SEPOLIA_RPC_URL   # true
      cast call $REG "isAuthorizedSeller(uint256,address)(bool)" $SIDEBAR $AGENCY --rpc-url $SEPOLIA_RPC_URL # false
      ```
      **Keep these four transaction hashes.** They are the ENS prize evidence.

## Phase 5 — Collector and UI (~15 min)

- [ ] **[you]** Provision Postgres and deploy `apps/api` somewhere with a **public HTTPS URL** —
      Railway, Render or Fly. The Chainlink enclave has to reach it from the public internet.
      Required env: `DATABASE_URL`, `PROOFADS_API_TOKEN` (long random), `RPC_URL`,
      `MARKET_ADDRESS`, `CHAIN_ID=11155111`.
- [ ] **[cmd]** Smoke-test the auth boundary:
      ```bash
      curl -i $API_PUBLIC_URL/health                                             # 200
      curl -i $API_PUBLIC_URL/internal/batches/x                                 # 403
      curl -i -H "Authorization: Bearer $PROOFADS_API_TOKEN" $API_PUBLIC_URL/internal/batches/x   # 404
      ```
- [ ] **[cmd]** Point the UI at the deployment and ship it:
      ```bash
      API_PUBLIC_URL=https://… WEB_RPC_URL=$SEPOLIA_RPC_URL node scripts/write-web-env.mjs sepolia
      pnpm --filter @proofads/web build
      vercel deploy --prod          # or any static/Node host
      ```
- [ ] **[you]** ⚠️ The creative host **must** send `Access-Control-Allow-Origin` — the SDK reads the
      creative's bytes to verify its hash. Vercel does this for `/public` by default; check it.
- [ ] **[cmd]** Update `DEMO_DOMAIN` and re-run Phase 4's text-record step if the demo host changed.

## Phase 6 — The Chainlink Confidential Workflow (~15 min) — highest-value step

- [ ] **[cmd]** `cd workflows/proofads-delivery && cp .env.example .env`, then set
      `CRE_ETH_PRIVATE_KEY` (a funded Sepolia key) and `SECRET_PROOFADS_API_TOKEN` (**identical**
      to the collector's `PROOFADS_API_TOKEN`).
- [ ] **[cmd]** `cd my-workflow && bun install && bun test` → 43 passing.
- [ ] **[cmd]** Run one real campaign on Sepolia through the UI: grant, list, two bids, finalize,
      loser withdraws. Then open the demo publisher page in a browser and watch the hero slot for
      more than ten seconds.
- [ ] **[cmd]** Close the batch:
      ```bash
      curl -X POST $API_PUBLIC_URL/internal/batches/close \
        -H "Authorization: Bearer $PROOFADS_API_TOKEN" -H 'content-type: application/json' \
        -d '{"campaignId": 1}'
      ```
- [ ] **[cmd]** Fill in `my-workflow/config.staging.json`: `apiBaseUrl`, `batchId`, `campaignId`,
      `receiverAddress`, `marketAddress`.
- [ ] **[cmd]** Dry run, then the real thing:
      ```bash
      cre workflow simulate my-workflow --target staging-settings --non-interactive --trigger-index 0
      cre workflow simulate my-workflow --target staging-settings --non-interactive --trigger-index 0 --broadcast
      ```
      Save the **whole terminal output**, including the "the simulator is not a real TEE" banner,
      to `docs/evidence/cre-simulate.txt`. That file is the Chainlink prize evidence.
- [ ] **[cmd]** Pin the workflow author on the receiver once the first simulation reveals it:
      ```bash
      cast send $RECEIVER "setExpectedAuthor(address)" $CRE_AUTHOR \
        --private-key $DEPLOYER_PRIVATE_KEY --rpc-url $SEPOLIA_RPC_URL
      ```
- [ ] **[cmd]** Confirm the money moved: the Forwarder tx on Etherscan, the `DeliveryApplied` event,
      and the publisher's USDC balance up by `unitPrice`.
- [ ] **[cmd]** After the campaign deadline, `closeCampaign` from the UI and confirm the advertiser's
      refund.

## Phase 7 — Submission (~20 min)

- [ ] **[cmd]** `docs/DEPLOYMENTS.md` complete: every address, tx hash, ENS name, workflow name,
      commit hash and API URL.
- [ ] **[you]** Record the demo video from `docs/PRESENTATION.md` (2–4 min, ≥720p) and upload it
      unlisted.
- [ ] **[cmd]** Repo hygiene:
      ```bash
      git log -p | grep -iE "private_key|0x[a-f0-9]{64}" | head      # must be empty
      git tag v0.1.0-ethonline && git push --tags
      ```
- [ ] **[you]** ETHGlobal project page: title, tagline (README §1), description, **public** repo
      link, video link, live demo URL.
- [ ] **[you]** Select prizes: **ENS → Best Use of ENSv2** and **Chainlink → Best Confidential
      Workflow**. Nothing else. Do **not** select World.
- [ ] **[you]** Log out and re-open the submission page to confirm both links resolve publicly.

---

## If something goes wrong

| Symptom | Most likely cause | Do this |
|---|---|---|
| `no bytecode at ENS LabelStore` | The docs address set is stale | Phase 1; use the repo JSON set via `ENS_*` overrides |
| `publisher does not own <label>.eth` | Registered from the wrong wallet | Re-run Phase 2 with the publisher key |
| `EACCannotGrantRoles` on a grant | Not the slot owner, or the slot isn't registered yet | Phase 4 must complete before any grant |
| `SellerNotAuthorized` when you expected success | The grant tx hasn't confirmed | Wait a block; the contract reads live state, not your intent |
| Enclave can't reach the collector | Collector is not publicly reachable, or the token differs | `curl` it from outside your network; compare `SECRET_PROOFADS_API_TOKEN` to `PROOFADS_API_TOKEN` |
| `Batch digest mismatch` | Events changed after the batch closed | Should be impossible — investigate the collector; do **not** work around it |
| Creative renders nothing | Hash mismatch, or missing CORS on the creative host | Browser console prints both hashes |
| `cre` refuses to deploy | Confidential Workflows are private beta | Expected. Simulate and say so. |
