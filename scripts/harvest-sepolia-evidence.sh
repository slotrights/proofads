#!/usr/bin/env bash
#
# Harvests the demonstration transactions from Sepolia into a markdown table, so that
# docs/DEPLOYMENTS.md is filled in from the chain rather than from memory.
#
# Event names are derived from the compiled ABI, not hardcoded, so this cannot drift
# from src/*.sol.
#
#   ./scripts/harvest-sepolia-evidence.sh
#   FROM_BLOCK=11674651 ./scripts/harvest-sepolia-evidence.sh
#
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
set -a; . ./.env; set +a

MARKET=$(jq -r .market contracts/deployments/sepolia.json)
RECEIVER=$(jq -r .settlementReceiver contracts/deployments/sepolia.json)
REGISTRY=$(jq -r .adInventoryRegistry contracts/deployments/sepolia.json)
FROM_BLOCK="${FROM_BLOCK:-11674651}"

[ -d contracts/out ] || ( cd contracts && forge build >/dev/null )

# topic0 -> event name, straight from the build artifacts.
MAP=$(mktemp)
for artifact in contracts/out/ProofAdsMarket.sol/ProofAdsMarket.json \
                contracts/out/ProofAdsSettlementReceiver.sol/ProofAdsSettlementReceiver.json \
                contracts/out/AdInventoryRegistry.sol/AdInventoryRegistry.json; do
  [ -f "$artifact" ] || continue
  jq -r '.abi[] | select(.type=="event") | .name + "(" + ([.inputs[].type] | join(",")) + ")"' "$artifact" \
  | while read -r sig; do
      printf '%s %s\n' "$(cast sig-event "$sig")" "${sig%%(*}"
    done
done | sort -u > "$MAP"

emit_table() { # <label> <address>
  local who="$1" addr="$2"
  cast logs --from-block "$FROM_BLOCK" --to-block latest --address "$addr" \
       --rpc-url "$SEPOLIA_RPC_URL" --json 2>/dev/null \
  | jq -r '.[] | [(.topics[0]), (.blockNumber), (.transactionHash)] | @tsv' \
  | while IFS=$'\t' read -r topic blk tx; do
      name=$(awk -v t="$topic" '$1==t {print $2}' "$MAP")
      printf '| %s | `%s` | %s | %s |\n' "$who" "${name:-unknown($topic)}" "$tx" "$((blk))"
    done
}

echo "| Contract | Event | Tx hash | Block |"
echo "|---|---|---|---|"
emit_table "ProofAdsMarket"     "$MARKET"
emit_table "SettlementReceiver" "$RECEIVER"
emit_table "AdInventoryRegistry" "$REGISTRY"
rm -f "$MAP"
