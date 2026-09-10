#!/usr/bin/env bash
#
# Runs every suite; commits the ADR-017 work only if all of them pass.
# Nothing is committed on a red run.
#
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$HOME/.bun/bin:$PATH"

fail=0
say() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

say "contracts (forge)"
( cd contracts && forge test ) || fail=1

say "confidential workflow (bun)"
( cd workflows/proofads-delivery/my-workflow && bun test ) || fail=1

say "typecheck"
pnpm -r typecheck || fail=1

if [ "$fail" -ne 0 ]; then
  printf '\n\033[1;31m✗ suites failed — nothing committed\033[0m\n'
  exit 1
fi

say "all green — committing"
git add -A contracts/src/testing/CostlyUSDC.sol \
           contracts/test/SettlementGasBudget.t.sol \
           contracts/test/ProofAdsFixture.sol \
           workflows/proofads-delivery/my-workflow/workflow.ts \
           workflows/proofads-delivery/my-workflow/workflow.test.ts \
           workflows/proofads-delivery/my-workflow/config.staging.json \
           workflows/proofads-delivery/my-workflow/config.production.json \
           docs/ARCHITECTURE_DECISIONS.md docs/OPEN_ITEMS.md docs/DEPLOYMENTS.md \
           docs/evidence/cre-simulate-sepolia.txt \
           scripts/harvest-sepolia-evidence.sh scripts/verify-and-commit.sh

git commit -F - <<'MSG'
fix(settlement): request an explicit gas limit, and never claim an unverified settlement

The first settlement of campaign 2 on Sepolia (0xf50c3350…50e9f) is a transaction
with status 1 that paid nobody. applyDelivery reverted OutOfGas inside Circle's
FiatTokenV2_2.transfer; the Chainlink Forwarder caught the revert and recorded
ReportProcessed(result: false); and the workflow printed "Settled campaign 2 at 1
verified units" over it, because its guard was skipped when the runtime reported
no receiver execution status.

Two independent defects, fixed together:

- The workflow now requests an explicit gas limit for the Forwarder's call into
  the receiver (settlementGasLimit, default 900_000). The SDK default is sized
  for a bare ERC-20; Circle's USDC is a proxy with pause and blacklist checks and
  costs several times more.
- An absent receiverContractExecutionStatus is now treated as UNKNOWN rather than
  as success: it is logged as a warning and marked UNVERIFIED in the returned
  summary, instead of being reported as a settlement.

Every existing suite was green while this bug shipped, because all of them settle
against MockUSDC. contracts/test/SettlementGasBudget.t.sol closes that gap with
CostlyUSDC — a token whose transfer costs more than Circle's — and pins that a
starved settlement fails cleanly without consuming the batch digest, so the
report stays retryable. That property is what made the Sepolia recovery a re-run
rather than a lost batch.

Also: DEPLOYMENTS.md filled in with the real Sepolia addresses and hashes (the
failed transaction kept deliberately, as the evidence behind ADR-017);
OPEN_ITEMS B1/B2/B5/B6 closed; C13–C15 added; scripts/harvest-sepolia-evidence.sh
regenerates the demonstration-transaction table from chain logs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qz8x778sWLx22byDCHKkGj
MSG

printf '\n\033[1;32m✓ committed\033[0m\n'
git log -1 --stat | head -25
