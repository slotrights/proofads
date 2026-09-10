#!/usr/bin/env bash
# Fetches the Foundry dependencies. `contracts/lib/` is gitignored, so run this once after
# cloning. Pinned to the exact contracts-v2 commit ProofAds was researched and built against.
set -euo pipefail
cd "$(dirname "$0")"

CONTRACTS_V2_COMMIT="48b3e2d39513b9dd32ef1850877a29009bc807b9"

mkdir -p lib
if [ ! -f lib/forge-std/src/Test.sol ]; then
  echo "→ forge-std"
  rm -rf lib/forge-std
  git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std
fi

if [ ! -f lib/contracts-v2/contracts/src/registry/PermissionedRegistry.sol ]; then
  echo "→ ensdomains/contracts-v2 @ ${CONTRACTS_V2_COMMIT}"
  rm -rf lib/contracts-v2
  git clone https://github.com/ensdomains/contracts-v2.git lib/contracts-v2
  git -C lib/contracts-v2 checkout "${CONTRACTS_V2_COMMIT}"
fi

if [ ! -f lib/contracts-v2/contracts/lib/solady/src/utils/LibString.sol ]; then
  echo "→ contracts-v2 submodules (this takes a few minutes)"
  git -C lib/contracts-v2 submodule update --init --recursive --depth 1
fi

echo "✓ dependencies ready. Next: forge build && forge test"
