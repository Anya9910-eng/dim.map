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

run_step "pnpm install" 120 pnpm install --frozen-lockfile

run_step "db push" 90 pnpm --filter db push

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
