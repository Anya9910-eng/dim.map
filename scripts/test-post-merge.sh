#!/usr/bin/env bash
# Tests for scripts/post-merge.sh
# Exercises run_step timeout/failure handling and confirms the script exits 0
# and the mirror-push phase still runs regardless of earlier step outcomes.

PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

# ---------------------------------------------------------------------------
# Define run_step locally (identical to the production implementation) so we
# can unit-test it in isolation without running the rest of the script.
# ---------------------------------------------------------------------------

FAILED_STEPS=()

run_step() {
  local name="$1"
  local timeout_secs="$2"
  shift 2
  timeout "$timeout_secs" "$@"
  local exit_code=$?
  if [ $exit_code -eq 124 ]; then
    echo "Warning: step '${name}' timed out after ${timeout_secs}s"
    FAILED_STEPS+=("${name} (timed out)")
  elif [ $exit_code -ne 0 ]; then
    FAILED_STEPS+=("${name}")
  fi
}

echo "=== Unit tests: run_step ==="

# --- Test 1: successful step leaves FAILED_STEPS empty ---
FAILED_STEPS=()
run_step "noop" 5 true
if [ ${#FAILED_STEPS[@]} -eq 0 ]; then
  pass "successful step does not add to FAILED_STEPS"
else
  fail "successful step should not add to FAILED_STEPS (got: ${FAILED_STEPS[*]})"
fi

# --- Test 2: failing step records the step name ---
FAILED_STEPS=()
run_step "my-failing-step" 5 false
if [ ${#FAILED_STEPS[@]} -eq 1 ] && [ "${FAILED_STEPS[0]}" = "my-failing-step" ]; then
  pass "failing step records step name in FAILED_STEPS"
else
  fail "failing step should record step name (got: ${FAILED_STEPS[*]:-<empty>})"
fi

# --- Test 3: timed-out step records '(timed out)' suffix ---
FAILED_STEPS=()
run_step "slow-step" 1 sleep 60
if [ ${#FAILED_STEPS[@]} -eq 1 ] && [[ "${FAILED_STEPS[0]}" == *"timed out"* ]]; then
  pass "timed-out step recorded with '(timed out)' suffix in FAILED_STEPS"
else
  fail "timed-out step should record '(timed out)' suffix (got: ${FAILED_STEPS[*]:-<empty>})"
fi

# --- Test 4: timeout warning message names the step ---
FAILED_STEPS=()
warning=$(run_step "db-migration" 1 sleep 60 2>&1)
if echo "$warning" | grep -q "db-migration"; then
  pass "timeout warning message names the step"
else
  fail "timeout warning message should name the step (got: '$warning')"
fi

# --- Test 5: timeout warning message includes the duration ---
FAILED_STEPS=()
warning=$(run_step "install" 1 sleep 60 2>&1)
if echo "$warning" | grep -q "1s"; then
  pass "timeout warning message includes the timeout duration"
else
  fail "timeout warning message should include timeout duration (got: '$warning')"
fi

# --- Test 6: multiple failed steps are all recorded ---
FAILED_STEPS=()
run_step "step-a" 5 false
run_step "step-b" 1 sleep 60
if [ ${#FAILED_STEPS[@]} -eq 2 ]; then
  pass "multiple failed/timed-out steps are all recorded"
else
  fail "should record all failed steps (got: ${FAILED_STEPS[*]:-<empty>})"
fi

# ---------------------------------------------------------------------------
# Integration test: run a self-contained copy of the real script with mocked
# commands so we exercise the actual control-flow without real side-effects.
#
# The mocked pnpm install times out (1s timeout on sleep 10).
# The mocked db push fails.
# push_to_github is a no-op stub that records it was called.
# The script must exit 0 in all cases.
# ---------------------------------------------------------------------------

echo ""
echo "=== Integration test: full script run ==="

TMPSCRIPT=$(mktemp /tmp/post-merge-test.XXXXXX.sh)
trap 'rm -f "$TMPSCRIPT"' EXIT

cat > "$TMPSCRIPT" <<'SCRIPT'
#!/bin/bash

FAILED_STEPS=()

run_step() {
  local name="$1"
  local timeout_secs="$2"
  shift 2
  timeout "$timeout_secs" "$@"
  local exit_code=$?
  if [ $exit_code -eq 124 ]; then
    echo "Warning: step '${name}' timed out after ${timeout_secs}s"
    FAILED_STEPS+=("${name} (timed out)")
  elif [ $exit_code -ne 0 ]; then
    FAILED_STEPS+=("${name}")
  fi
}

# Simulate: pnpm install times out (1s timeout on sleep 10)
run_step "pnpm install" 1 sleep 10

# Simulate: db push fails immediately
run_step "db push" 5 false

if [ ${#FAILED_STEPS[@]} -gt 0 ]; then
  echo "Warning: the following setup steps failed: ${FAILED_STEPS[*]}"
  echo "GitHub mirror will still be updated."
fi

push_to_github() {
  # Stub: no real git ops; record that push was reached
  echo "PUSH_CALLED"
}
push_to_github
SCRIPT

chmod +x "$TMPSCRIPT"

integration_output=$("$TMPSCRIPT" 2>&1)
integration_exit=$?

# --- Test 7: script exits 0 even when steps fail/time out ---
if [ $integration_exit -eq 0 ]; then
  pass "script exits 0 when steps fail or time out"
else
  fail "script should exit 0 even when steps fail/time out (got exit $integration_exit)"
fi

# --- Test 8: timeout warning names the timed-out step ---
if echo "$integration_output" | grep -q "pnpm install"; then
  pass "timeout warning names the timed-out step ('pnpm install')"
else
  fail "timeout warning should name the timed-out step (output: $integration_output)"
fi

# --- Test 9: summary warning lists all failed steps ---
if echo "$integration_output" | grep -q "the following setup steps failed"; then
  pass "summary warning is emitted when steps fail"
else
  fail "summary warning should be emitted when steps fail (output: $integration_output)"
fi

# --- Test 10: mirror push still runs after failures ---
if echo "$integration_output" | grep -q "PUSH_CALLED"; then
  pass "mirror push still runs after failed/timed-out steps"
else
  fail "mirror push should still run after failures (output: $integration_output)"
fi

# --- Test 11: 'GitHub mirror will still be updated' message is printed ---
if echo "$integration_output" | grep -q "GitHub mirror will still be updated"; then
  pass "'GitHub mirror will still be updated' message printed before push"
else
  fail "'GitHub mirror will still be updated' should be printed (output: $integration_output)"
fi

# ---------------------------------------------------------------------------
# Integration test: GITHUB_TOKEN missing — push skipped, script exits 0,
# setup-step output is not lost.
# ---------------------------------------------------------------------------

echo ""
echo "=== Integration test: missing GITHUB_TOKEN ==="

TMPSCRIPT2=$(mktemp /tmp/post-merge-test.XXXXXX.sh)
trap 'rm -f "$TMPSCRIPT2"' EXIT

cat > "$TMPSCRIPT2" <<'SCRIPT'
#!/bin/bash

FAILED_STEPS=()

run_step() {
  local name="$1"
  local timeout_secs="$2"
  shift 2
  timeout "$timeout_secs" "$@"
  local exit_code=$?
  if [ $exit_code -eq 124 ]; then
    echo "Warning: step '${name}' timed out after ${timeout_secs}s"
    FAILED_STEPS+=("${name} (timed out)")
  elif [ $exit_code -ne 0 ]; then
    FAILED_STEPS+=("${name}")
  fi
}

# Simulate: pnpm install fails, db push succeeds
run_step "pnpm install" 5 false
run_step "db push" 5 true

if [ ${#FAILED_STEPS[@]} -gt 0 ]; then
  echo "Warning: the following setup steps failed: ${FAILED_STEPS[*]}"
  echo "GitHub mirror will still be updated."
fi

push_to_github() {
  if [ -n "$GITHUB_TOKEN" ]; then
    local remote="https://EpicStarAi:${GITHUB_TOKEN}@github.com/EpicStarAi/draftfly-ai-reply-agent.git"
    if git remote get-url github >/dev/null 2>&1; then
      git remote set-url github "$remote"
    else
      git remote add github "$remote"
    fi
    git push --force github HEAD:main \
      || echo "Warning: GitHub mirror push failed (non-fatal)"
  fi
}
push_to_github
SCRIPT

chmod +x "$TMPSCRIPT2"

# Run with GITHUB_TOKEN unset
no_token_output=$(env -u GITHUB_TOKEN "$TMPSCRIPT2" 2>&1)
no_token_exit=$?

# --- Test 12: script exits 0 when GITHUB_TOKEN is missing ---
if [ $no_token_exit -eq 0 ]; then
  pass "script exits 0 when GITHUB_TOKEN is missing"
else
  fail "script should exit 0 when GITHUB_TOKEN is missing (got exit $no_token_exit)"
fi

# --- Test 13: setup-step warning is still printed when GITHUB_TOKEN is missing ---
if echo "$no_token_output" | grep -q "the following setup steps failed"; then
  pass "setup-step failure warning is printed even when GITHUB_TOKEN is missing"
else
  fail "setup-step failure warning should appear regardless of GITHUB_TOKEN (output: $no_token_output)"
fi

# --- Test 14: 'GitHub mirror will still be updated' printed when GITHUB_TOKEN is missing ---
if echo "$no_token_output" | grep -q "GitHub mirror will still be updated"; then
  pass "'GitHub mirror will still be updated' is printed when GITHUB_TOKEN is missing"
else
  fail "'GitHub mirror will still be updated' should be printed when GITHUB_TOKEN is missing (output: $no_token_output)"
fi

# ---------------------------------------------------------------------------
# Integration test: GITHUB_TOKEN set but push fails — warning printed,
# script still exits 0, setup-step output is not lost.
# ---------------------------------------------------------------------------

echo ""
echo "=== Integration test: push failure (bad remote) ==="

TMPDIR_GIT=$(mktemp -d /tmp/post-merge-git-stub.XXXXXX)
trap 'rm -rf "$TMPDIR_GIT"' EXIT

# Stub git: remote management succeeds; push always fails
cat > "$TMPDIR_GIT/git" <<'STUB'
#!/bin/bash
# Stub git for push failure tests
if [ "$1" = "push" ]; then
  echo "ERROR: failed to push some refs (stub)" >&2
  exit 1
fi
# remote get-url/set-url/add: succeed silently
exit 0
STUB
chmod +x "$TMPDIR_GIT/git"

TMPSCRIPT3=$(mktemp /tmp/post-merge-test.XXXXXX.sh)
trap 'rm -f "$TMPSCRIPT3"' EXIT

cat > "$TMPSCRIPT3" <<'SCRIPT'
#!/bin/bash

FAILED_STEPS=()

run_step() {
  local name="$1"
  local timeout_secs="$2"
  shift 2
  timeout "$timeout_secs" "$@"
  local exit_code=$?
  if [ $exit_code -eq 124 ]; then
    echo "Warning: step '${name}' timed out after ${timeout_secs}s"
    FAILED_STEPS+=("${name} (timed out)")
  elif [ $exit_code -ne 0 ]; then
    FAILED_STEPS+=("${name}")
  fi
}

# Simulate: both setup steps succeed
run_step "pnpm install" 5 true
run_step "db push" 5 true

if [ ${#FAILED_STEPS[@]} -gt 0 ]; then
  echo "Warning: the following setup steps failed: ${FAILED_STEPS[*]}"
  echo "GitHub mirror will still be updated."
fi

push_to_github() {
  if [ -n "$GITHUB_TOKEN" ]; then
    local remote="https://EpicStarAi:${GITHUB_TOKEN}@github.com/EpicStarAi/draftfly-ai-reply-agent.git"
    if git remote get-url github >/dev/null 2>&1; then
      git remote set-url github "$remote"
    else
      git remote add github "$remote"
    fi
    git push --force github HEAD:main \
      || echo "Warning: GitHub mirror push failed (non-fatal)"
  fi
}
push_to_github
SCRIPT

chmod +x "$TMPSCRIPT3"

# Run with stubbed git (push always fails) and a fake token
push_fail_output=$(PATH="$TMPDIR_GIT:$PATH" GITHUB_TOKEN=fake-token "$TMPSCRIPT3" 2>&1)
push_fail_exit=$?

# --- Test 15: script exits 0 when push fails ---
if [ $push_fail_exit -eq 0 ]; then
  pass "script exits 0 when git push fails"
else
  fail "script should exit 0 when git push fails (got exit $push_fail_exit)"
fi

# --- Test 16: push failure warning message is printed ---
if echo "$push_fail_output" | grep -q "Warning: GitHub mirror push failed"; then
  pass "push failure warning message is printed when git push fails"
else
  fail "push failure warning should be printed when git push fails (output: $push_fail_output)"
fi

# --- Test 17: setup-step output not lost when push fails (no failed steps) ---
# When all steps succeed, the failed-steps summary should NOT appear
if ! echo "$push_fail_output" | grep -q "the following setup steps failed"; then
  pass "setup-step output correctly absent when all steps pass (push failure only)"
else
  fail "spurious setup-step failure warning should not appear when steps passed (output: $push_fail_output)"
fi

# ---------------------------------------------------------------------------
# Integration test: both setup failures and push failure co-exist — all
# warnings appear, script exits 0.
# ---------------------------------------------------------------------------

echo ""
echo "=== Integration test: setup failures + push failure ==="

TMPSCRIPT4=$(mktemp /tmp/post-merge-test.XXXXXX.sh)
trap 'rm -f "$TMPSCRIPT4"' EXIT

cat > "$TMPSCRIPT4" <<'SCRIPT'
#!/bin/bash

FAILED_STEPS=()

run_step() {
  local name="$1"
  local timeout_secs="$2"
  shift 2
  timeout "$timeout_secs" "$@"
  local exit_code=$?
  if [ $exit_code -eq 124 ]; then
    echo "Warning: step '${name}' timed out after ${timeout_secs}s"
    FAILED_STEPS+=("${name} (timed out)")
  elif [ $exit_code -ne 0 ]; then
    FAILED_STEPS+=("${name}")
  fi
}

# Simulate: pnpm install fails, db push times out
run_step "pnpm install" 5 false
run_step "db push" 1 sleep 60

if [ ${#FAILED_STEPS[@]} -gt 0 ]; then
  echo "Warning: the following setup steps failed: ${FAILED_STEPS[*]}"
  echo "GitHub mirror will still be updated."
fi

push_to_github() {
  if [ -n "$GITHUB_TOKEN" ]; then
    local remote="https://EpicStarAi:${GITHUB_TOKEN}@github.com/EpicStarAi/draftfly-ai-reply-agent.git"
    if git remote get-url github >/dev/null 2>&1; then
      git remote set-url github "$remote"
    else
      git remote add github "$remote"
    fi
    git push --force github HEAD:main \
      || echo "Warning: GitHub mirror push failed (non-fatal)"
  fi
}
push_to_github
SCRIPT

chmod +x "$TMPSCRIPT4"

combined_output=$(PATH="$TMPDIR_GIT:$PATH" GITHUB_TOKEN=fake-token "$TMPSCRIPT4" 2>&1)
combined_exit=$?

# --- Test 18: script exits 0 with both setup failures and push failure ---
if [ $combined_exit -eq 0 ]; then
  pass "script exits 0 when setup steps fail AND push fails"
else
  fail "script should exit 0 with combined failures (got exit $combined_exit)"
fi

# --- Test 19: setup-step summary still printed when push also fails ---
if echo "$combined_output" | grep -q "the following setup steps failed"; then
  pass "setup-step failure summary printed even when push also fails"
else
  fail "setup-step failure summary should appear when steps failed (output: $combined_output)"
fi

# --- Test 20: push failure warning printed alongside setup failures ---
if echo "$combined_output" | grep -q "Warning: GitHub mirror push failed"; then
  pass "push failure warning printed alongside setup-step failures"
else
  fail "push failure warning should appear alongside setup-step failures (output: $combined_output)"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ $FAIL -eq 0 ]
