#!/usr/bin/env bash
#
# Brings the whole local ProofAds stack up from nothing: chain, database, contracts, collector,
# web app. Idempotent — safe to re-run. Everything it starts logs to $LOG_DIR.
#
#   ./scripts/dev-stack.sh          # start everything and deploy
#   ./scripts/dev-stack.sh --e2e    # ...then run the end-to-end proof
#
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
LOG_DIR="${LOG_DIR:-$ROOT/.devstack}"
mkdir -p "$LOG_DIR"

export PATH="$HOME/.foundry/bin:/usr/lib/postgresql/16/bin:$PATH"
# Foundry otherwise reaches out to sourcify to decorate traces; keep the local stack offline.
export FOUNDRY_OFFLINE=true
set -a; . ./.env.local.example; set +a

API_PORT="${API_PORT:-8787}"
WEB_PORT="${WEB_PORT:-3000}"
PGPORT="${PGPORT:-5433}"
PGDATA="${PGDATA:-$HOME/pgdata}"
export DATABASE_URL="${DATABASE_URL:-postgres://proofads@127.0.0.1:$PGPORT/proofads}"
export PROOFADS_API_TOKEN="${PROOFADS_API_TOKEN:-local-dev-token}"

say() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

# ── Postgres ────────────────────────────────────────────────────────────
say "Postgres on :$PGPORT"
if ! pg_isready -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1; then
  [ -d "$PGDATA" ] || initdb -D "$PGDATA" -U proofads --auth=trust >/dev/null
  pg_ctl -D "$PGDATA" -l "$LOG_DIR/postgres.log" -o "-p $PGPORT -k $PGDATA" start
  sleep 2
  createdb -h 127.0.0.1 -p "$PGPORT" -U proofads proofads 2>/dev/null || true
  createdb -h 127.0.0.1 -p "$PGPORT" -U proofads proofads_test 2>/dev/null || true
fi
pg_isready -h 127.0.0.1 -p "$PGPORT" || { echo "postgres failed to start"; exit 1; }

# ── Anvil ───────────────────────────────────────────────────────────────
say "Anvil on :8545"
if ! cast block-number --rpc-url "$LOCAL_RPC_URL" >/dev/null 2>&1; then
  setsid nohup anvil --host 127.0.0.1 --port 8545 --block-time 1 \
    > "$LOG_DIR/anvil.log" 2>&1 < /dev/null &
  sleep 4
fi
cast block-number --rpc-url "$LOCAL_RPC_URL" >/dev/null || { echo "anvil failed to start"; exit 1; }

# ── Contracts ───────────────────────────────────────────────────────────
say "Deploying ENSv2 + ProofAds"
( cd contracts && forge script script/DeployLocal.s.sol:DeployLocal \
    --rpc-url "$LOCAL_RPC_URL" --broadcast --slow > "$LOG_DIR/deploy.log" 2>&1 ) \
  || { tail -20 "$LOG_DIR/deploy.log"; exit 1; }
MARKET=$(python3 -c "import json;print(json.load(open('contracts/deployments/local.json'))['market'])")
echo "  market $MARKET"

API_PUBLIC_URL="http://127.0.0.1:$API_PORT" node scripts/write-web-env.mjs local

# ── Collector ───────────────────────────────────────────────────────────
say "Measurement collector on :$API_PORT"
for pid in $(pgrep -f "tsx src/server.ts" 2>/dev/null); do kill "$pid" 2>/dev/null; done
sleep 1
MARKET_ADDRESS="$MARKET" RPC_URL="$LOCAL_RPC_URL" PORT="$API_PORT" \
  setsid nohup pnpm --filter @proofads/api start > "$LOG_DIR/api.log" 2>&1 < /dev/null &
for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null || { tail -20 "$LOG_DIR/api.log"; exit 1; }

# ── Web ─────────────────────────────────────────────────────────────────
say "Web app on :$WEB_PORT"
pnpm --filter @proofads/web build > "$LOG_DIR/web-build.log" 2>&1 \
  || { tail -20 "$LOG_DIR/web-build.log"; exit 1; }
for pid in $(pgrep -f "next start" 2>/dev/null); do kill "$pid" 2>/dev/null; done
sleep 1
( cd apps/web && setsid nohup ./node_modules/.bin/next start -p "$WEB_PORT" \
    > "$LOG_DIR/web.log" 2>&1 < /dev/null & )
sleep 6

say "Ready"
cat <<EOF
  chain      $LOCAL_RPC_URL
  collector  http://127.0.0.1:$API_PORT
  web        http://127.0.0.1:$WEB_PORT
  demo page  http://127.0.0.1:$WEB_PORT/demo-publisher
  logs       $LOG_DIR

  Seed a campaign:  WEB_URL=http://127.0.0.1:$WEB_PORT pnpm --filter @proofads/e2e seed
  Full proof:       API_URL=http://127.0.0.1:$API_PORT pnpm --filter @proofads/e2e start
EOF

if [ "${1:-}" = "--e2e" ]; then
  say "End-to-end proof"
  API_URL="http://127.0.0.1:$API_PORT" WEB_URL="http://127.0.0.1:$WEB_PORT" \
    pnpm --filter @proofads/e2e start
fi
