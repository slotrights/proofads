# Demo script

Click-by-click. Rehearse once from a clean browser profile before recording. Public addresses only —
never show a private key, a `.env`, or the collector's bearer token.

## Cast

| Role | Wallet | What they do |
|---|---|---|
| **Publisher** | A | Owns `proofads-pub.eth` and every ad slot under it. Grants and revokes selling rights. Gets paid. |
| **Agency** | B | Authorized to sell `hero` and nothing else. Never touches the money. |
| **Advertiser A** | C | Bids 0.15 USDC per verified view. Loses. Withdraws. |
| **Advertiser B** | D | Bids 0.20. Wins. Pays for one delivered view, gets the rest back. |

Record the four public addresses here before recording:

```
publisher    0x…
agency       0x…
advertiserA  0x…
advertiserB  0x…
```

## Before you start

- Four wallets funded; C and D holding ≥2 Circle USDC each.
- Collector reachable over public HTTPS; web app deployed; `hero` and `sidebar` registered.
- Two browser profiles side by side is easier than switching accounts mid-recording.
- Set the auction to **3 minutes** and the campaign to **20 minutes** so nothing runs long on camera.

---

## Act 1 — ENS decides who may sell (≈60s)

1. **`/`** — the inventory. Point out that `hero.ads.proofads-pub.eth` and
   `sidebar.ads.proofads-pub.eth` are ENS names, and that the owner column is read from the registry.
2. **`/publisher`**, connected as the **publisher**. Paste the **agency**'s address into "Agency
   address". Both badges read *not authorized*.
3. Click **Grant SELL** on `hero`. Confirm in the wallet. When the receipt lands, the badge flips to
   *ROLE_SELL_SLOT held*.
   > Say: "That badge is a fresh `hasRoles` call, not local state. Nothing here is optimistic."
4. Expand **Technical details**: show `labelhash`, `ROLE_SELL_SLOT = 0x10000000000 (1 << 40)`, and
   the ERC-1155 token id.
   > Say: "ENSv2 regenerates that token id every time a role changes, which is why nothing in this
   > protocol is keyed by it."

## Act 2 — the revert is the demo (≈50s)

5. Switch to the **agency** wallet. On `/publisher`, scroll to the **`sidebar`** card and click
   **Create listing**.
   → The wallet rejects it. Show the error: **`SellerNotAuthorized`**.
   > Say: "Same agency, same publisher, different slot."
6. Back as the **publisher**, click **Revoke SELL** on `hero`. Badge flips back.
7. As the **agency**, try to list **`hero`**. → **`SellerNotAuthorized`** again.
   > Say: "Revocation is immediate. There is no cache to invalidate."
8. As the **publisher**, **Grant SELL** on `hero` once more.
9. As the **agency**, **Create listing** on `hero`: target 2, reserve 0.10, auction 3 min, campaign
   20 min. It succeeds.
10. Expand **Technical details** on the new listing: the *publisher* field is the ENS owner, not the
    caller.
    > Say: "The agency can sell the slot. It can never redirect the payment."

## Act 3 — escrow (≈45s)

11. **`/advertiser`** as **advertiser A**: pick Creative A, unit price 0.15, **Approve + bid**.
12. As **advertiser B**: Creative B, 0.20, **Approve + bid**.
13. Open the marketplace address on Etherscan and show its USDC balance: **0.70 USDC**
    (0.15×2 + 0.20×2).
14. Wait for the auction to end, then **Finalize auction**.
15. As **advertiser A**, **Withdraw bid** → 0.30 USDC back. The marketplace now holds 0.40.

## Act 4 — measurement (≈35s)

16. **`/demo-publisher`** — The Sepolia Times. The hero slot renders **Creative B**, the winner's.
    > Say: "The SDK asked the marketplace which campaign owns this ENS slot, fetched the creative,
    > hashed the bytes, and compared them to the hash the advertiser committed to on chain. A
    > swapped creative renders nothing."
17. Leave the slot in view for **more than ten seconds**. Do not switch tabs.
18. **`/campaign/1`** — raw events climbing, one distinct session, one qualifying view.
    > Say: "Counts only. The events themselves never leave the collector."

## Act 5 — the confidential workflow (≈45s)

19. Terminal. Close the batch:
    ```bash
    curl -X POST $API_PUBLIC_URL/internal/batches/close \
      -H "Authorization: Bearer $PROOFADS_API_TOKEN" -H 'content-type: application/json' \
      -d '{"campaignId": 1}'
    ```
    Show the returned digest.
20. Show that the batch is unreadable without the enclave's secret:
    ```bash
    curl -i $API_PUBLIC_URL/internal/batches/<id>     # 403
    ```
21. Put the batch id into `config.staging.json`, then:
    ```bash
    cre workflow simulate my-workflow --target staging-settings --non-interactive --trigger-index 0 --broadcast
    ```
22. On screen, point at, in order: the **"the simulator is not a real TEE"** banner; the enclave log
    line showing **counts only**; the report.
    > Say: "Inside the enclave: a Vault DON secret, an authenticated fetch of the raw batch — every
    > session id and visibility trace — and the qualification rules. Out of it: five numbers.
    > This is a simulation; deploying Confidential Workflows is still private beta."

## Act 6 — the money (≈30s)

23. Etherscan: the Forwarder transaction → `SettlementReportReceived` → `DeliveryApplied(1, 1, 1,
    200000)`.
24. Publisher's USDC balance: **+0.20**.
    > Say: "One of two units delivered, so one unit paid."
25. Show the direct-call rejection:
    ```bash
    cast send $MARKET "applyDelivery(uint256,uint32,bytes32)" 1 2 0x00 --private-key $DEPLOYER_PRIVATE_KEY
    # reverts NotSettlementReceiver
    ```
26. After the campaign deadline, **`/campaign/1`** → **Close campaign**. Advertiser B: **+0.20**.
27. Closing line:
    > "ENS defines who may sell. Chainlink privately determines what was delivered. The contract
    > pays only for that."

---

## Fastest local rehearsal

```bash
anvil --block-time 1 &
pnpm deploy:local && node scripts/write-web-env.mjs local
pnpm --filter @proofads/api start &
pnpm --filter @proofads/web build && pnpm --filter @proofads/web start &
pnpm --filter @proofads/e2e seed        # grant → list → 2 bids → finalize, prints the campaign id
open http://127.0.0.1:3000/demo-publisher
```

`pnpm --filter @proofads/e2e start` runs the whole story unattended and asserts every step — useful
for checking the environment is healthy before you start recording.
