#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# run-e2e-share-link.sh
#
# Self-contained runner for the share-link-filters Playwright spec.
# Starts the API server + frontend preview + a local proxy, runs the tests,
# then tears everything down.
#
# Prerequisites (must already be set in the environment):
#   DATABASE_URL, SESSION_SECRET — needed by the API server
#
# Usage (from the repo root):
#   bash artifacts/draftfly/scripts/run-e2e-share-link.sh
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRAFTFLY_DIR="$REPO_ROOT/artifacts/draftfly"
API_DIR="$REPO_ROOT/artifacts/api-server"

API_PORT=3001
FE_PORT=5173
PROXY_PORT=4000

PIDS=()

cleanup() {
  echo "[e2e] cleaning up background processes…"
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

# ── 1. Ensure the API server is built ─────────────────────────────────────
echo "[e2e] building API server…"
pnpm --filter @workspace/api-server run build 2>&1 | tail -5

# ── 2. Build the frontend ──────────────────────────────────────────────────
echo "[e2e] building frontend…"
(cd "$DRAFTFLY_DIR" && PORT=$FE_PORT BASE_PATH=/app pnpm run build) 2>&1 | tail -5

# ── 3. Start the API server ────────────────────────────────────────────────
echo "[e2e] starting API server on :$API_PORT…"
PORT=$API_PORT \
  ENABLE_DEV_LOGIN=true \
  NODE_ENV=development \
  node --enable-source-maps "$API_DIR/dist/index.mjs" &
PIDS+=($!)

# ── 4. Start frontend preview (serves dist/public) ────────────────────────
echo "[e2e] starting frontend preview on :$FE_PORT…"
(cd "$DRAFTFLY_DIR" && PORT=$FE_PORT BASE_PATH=/app pnpm run serve) &
PIDS+=($!)

# ── 5. Start the proxy ────────────────────────────────────────────────────
echo "[e2e] starting proxy on :$PROXY_PORT…"
PROXY_PORT=$PROXY_PORT API_PORT=$API_PORT FE_PORT=$FE_PORT \
  node "$DRAFTFLY_DIR/e2e/proxy.mjs" &
PIDS+=($!)

# ── 6. Wait for API to be ready ────────────────────────────────────────────
echo "[e2e] waiting for API server…"
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$API_PORT/api/auth/me" -o /dev/null 2>/dev/null; then
    echo "[e2e] API server ready"
    break
  fi
  # Accept 401 (unauthenticated) — server is up but session not set
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$API_PORT/api/auth/me" 2>/dev/null || echo "000")
  if [ "$STATUS" = "401" ]; then
    echo "[e2e] API server ready (got 401 — expected)"
    break
  fi
  echo "[e2e] waiting… ($i/30) status=$STATUS"
  sleep 2
done

# ── 7. Wait for proxy ─────────────────────────────────────────────────────
echo "[e2e] waiting for proxy…"
for i in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:$PROXY_PORT/api/auth/me" -o /dev/null 2>/dev/null; then
    echo "[e2e] proxy ready"
    break
  fi
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PROXY_PORT/api/auth/me" 2>/dev/null || echo "000")
  if [ "$STATUS" = "401" ]; then
    echo "[e2e] proxy ready (got 401 — expected)"
    break
  fi
  echo "[e2e] waiting… ($i/15)"
  sleep 2
done

# ── 8. Run Playwright tests ───────────────────────────────────────────────
echo "[e2e] running Playwright share-link-filters spec…"
cd "$DRAFTFLY_DIR"
BASE_URL="http://127.0.0.1:$PROXY_PORT" \
  ENABLE_DEV_LOGIN=true \
  node_modules/.bin/playwright test \
    --config playwright.config.ts \
    e2e/share-link-filters.spec.ts \
    --reporter=line

echo "[e2e] all tests passed ✓"
