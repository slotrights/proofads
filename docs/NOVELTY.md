# Prior art, and what is actually new

Written after searching for the obvious precedents. The point of this document is to make the
claim small enough to be true.

---

## What already exists

**`ads.txt` / `app-ads.txt` (IAB Tech Lab).** A plaintext file at a domain's root listing authorized
resellers. This is the direct ancestor of ProofAds' authorization layer. It is domain-wide, has no
per-placement granularity, is enforced only by whoever chooses to crawl it, and revocation means
editing a file and waiting. ProofAds does the same job per placement, with revocation that the
relying contract reads at the moment of the transaction.

**`sellers.json` and the SupplyChain Object.** Declare the chain of intermediaries. Same shape of
solution: publish an assertion, hope it is read. Same limitation.

**Blockchain ad networks — AdEx, Adshares, Alkimi, Basic Attention Token.** All predate this and all
are more complete products. They move ad spend on chain, some with escrow and impression
accounting. What none of them does, as far as we found, is make the *right to sell a specific
placement* a first-class, revocable, on-chain capability that a marketplace contract checks per
call — or keep the delivery measurement private while making the payout depend on it.

**NFT-as-ad-space projects.** Several tokenise a billboard or a website slot as an NFT. That is
ownership transfer, not delegation: a holder either owns the slot or does not. There is no "this
agency may sell this slot until I say otherwise, and may never touch the money".

**ENS subname delegation.** Subname registrars, and ENSv2's Enhanced Access Control itself, are the
general mechanism. ProofAds' contribution here is an application-defined role in an unused nybble,
plus the observation that a marketplace should read it live rather than cache it.

**TEE-based ad measurement.** Not new as an idea — several ad-tech vendors run measurement in
enclaves. Doing it through Chainlink CRE so the enclave's output lands on chain as a
consensus-signed report that a settlement contract accepts is, as far as we found, not something
that exists publicly.

## What is different here

1. **Selling rights as a revocable per-placement capability, enforced at call time.** Not a list,
   not a token transfer, not a signature the counterparty may or may not check: a role the contract
   itself reads before it will accept a listing.
2. **The payout address is structurally not the seller's to choose.** It is `registry.getOwner()`,
   read on chain. A delegated seller can sell but can never redirect.
3. **Delivery is verified without being published.** The measurement data is exactly what a public
   chain must not hold. Evaluating it inside an attested enclave and emitting one aggregate is the
   shape of the answer, and the settlement contract accepts nothing else.
4. **The composition.** ENS decides *who may sell*; a confidential workflow decides *what was
   delivered*; escrow decides *what is owed*. Each piece exists somewhere. Wiring them so that
   removing any one breaks the product is the contribution.

## What we are not claiming

- Not the first on-chain advertising marketplace. Not close.
- Not the first use of TEEs in ad measurement.
- Not a new cryptographic primitive, a new auction mechanism, or a new measurement standard — the
  ten-second / 50%-viewable definition is deliberately the boring industry-adjacent one.
- Not a solution to ad fraud. It narrows what a buyer is asked to take on faith; it does not
  eliminate it.
- Not production-ready. `OPEN_ITEMS.md` is the list.
