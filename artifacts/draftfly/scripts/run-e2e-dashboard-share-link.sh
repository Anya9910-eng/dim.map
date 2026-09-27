#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# run-e2e-dashboard-share-link.sh
#
# Self-contained runner for the dashboard-share-link Playwright spec.
# Verifies that opening the dashboard via a share link (trendClientId +
# trendCampaignId URL params) pre-selects the correct dropdowns and that
# changing filters updates the URL correctly.
#
# Starts the API server + frontend preview + a local proxy, runs the tests,
# then tears everything down.
#
# Prerequisites (must already be set in the environment):
#   DATABASE_URL, SESSION_SECRET — needed by the API server
#
# Usage (from the repo root):
#   bash artifacts/draftfly/scripts/run-e2e-dashboard-share-link.sh
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
# Skip if dist/index.mjs already exists AND no source files are newer than it.
# Set FORCE_REBUILD=1 to always rebuild regardless of timestamps.
API_DIST="$API_DIR/dist/index.mjs"
if [ "${FORCE_REBUILD:-0}" = "1" ] || [ ! -f "$API_DIST" ] || find "$API_DIR/src" -name "*.ts" -newer "$API_DIST" | grep -q .; then
  echo "[e2e] building API server…"
  pnpm --filter @workspace/api-server run build 2>&1 | tail -5
else
  echo "[e2e] API server dist is up to date — skipping rebuild"
fi

# ── 2. Build the frontend ──────────────────────────────────────────────────
# Skip if dist/public/index.html exists AND no source files are newer than it.
# Set FORCE_REBUILD=1 to always rebuild regardless of timestamps.
FE_DIST="$DRAFTFLY_DIR/dist/public/index.html"
if [ "${FORCE_REBUILD:-0}" = "1" ] || [ ! -f "$FE_DIST" ] \
   || find "$DRAFTFLY_DIR/src" -name "*.ts" -newer "$FE_DIST" | grep -q . \
   || find "$DRAFTFLY_DIR/src" -name "*.tsx" -newer "$FE_DIST" | grep -q .; then
  echo "[e2e] building frontend…"
  (cd "$DRAFTFLY_DIR" && PORT=$FE_PORT BASE_PATH=/app pnpm run build) 2>&1 | tail -5
else
  echo "[e2e] frontend dist is up to date — skipping rebuild"
fi

# ── 3. Ensure Playwright browsers are installed ───────────────────────────
CHROMIUM_CACHE="${HOME}/.cache/ms-playwright"
if ! find "$CHROMIUM_CACHE" -name "chrome-headless-shell" -type f 2>/dev/null | grep -q .; then
  echo "[e2e] installing Playwright browsers…"
  (cd "$DRAFTFLY_DIR" && node_modules/.bin/playwright install chromium) 2>&1 | tail -5
else
  echo "[e2e] Playwright browsers already installed — skipping"
fi

# ── 4. Start the API server ────────────────────────────────────────────────
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
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$API_PORT/api/auth/me" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ] || [ "$STATUS" = "401" ]; then
    echo "[e2e] API server ready (status=$STATUS)"
    break
  fi
  echo "[e2e] waiting… ($i/30) status=$STATUS"
  sleep 2
done

# ── 7. Wait for proxy ─────────────────────────────────────────────────────
echo "[e2e] waiting for proxy…"
for i in $(seq 1 15); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PROXY_PORT/api/auth/me" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ] || [ "$STATUS" = "401" ]; then
    echo "[e2e] proxy ready (status=$STATUS)"
    break
  fi
  echo "[e2e] waiting… ($i/15)"
  sleep 2
done

# ── 8. Ensure at least one client + campaign exists (seed if needed) ──────
echo "[e2e] ensuring seed data exists…"
SEED_RESPONSE=$(curl -s -X POST "http://127.0.0.1:$API_PORT/api/dev/seed-e2e-client" \
  -H "Content-Type: application/json" 2>/dev/null || echo '{"ok":false}')
echo "[e2e] seed response: $SEED_RESPONSE"

SEED_OK=$(echo "$SEED_RESPONSE" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const o=JSON.parse(d);process.stdout.write(o.ok?'true':'false');}catch{process.stdout.write('false');}})")
SEEDED=$(echo "$SEED_RESPONSE" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const o=JSON.parse(d);process.stdout.write(o.seeded?String(o.clientId):'');}catch{process.stdout.write('');}})")

if [ "$SEED_OK" != "true" ]; then
  echo "[e2e] WARNING: seed endpoint returned non-ok — tests may be skipped if DB is empty"
fi
if [ -n "$SEEDED" ]; then
  echo "[e2e] seeded new E2E client (clientId=$SEEDED) — will clean up after tests"
fi

# ── 9. Run Playwright tests ───────────────────────────────────────────────
echo "[e2e] running Playwright dashboard-share-link spec…"
cd "$DRAFTFLY_DIR"
PLAYWRIGHT_EXIT=0
BASE_URL="http://127.0.0.1:$PROXY_PORT" \
  ENABLE_DEV_LOGIN=true \
  node_modules/.bin/playwright test \
    --config playwright.config.ts \
    e2e/dashboard-share-link.spec.ts \
    --reporter=line,html || PLAYWRIGHT_EXIT=$?

# ── 10. Clean up seeded data ──────────────────────────────────────────────
if [ -n "$SEEDED" ]; then
  echo "[e2e] cleaning up seeded E2E client (clientId=$SEEDED)…"
  curl -s -X DELETE "http://127.0.0.1:$API_PORT/api/dev/seed-e2e-client/$SEEDED" \
    -H "Content-Type: application/json" > /dev/null 2>&1 || true
fi

if [ "$PLAYWRIGHT_EXIT" -ne 0 ]; then
  echo "[e2e] Playwright exited with code $PLAYWRIGHT_EXIT"
  exit "$PLAYWRIGHT_EXIT"
fi

echo "[e2e] all tests passed ✓"
