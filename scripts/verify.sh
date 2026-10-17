#!/usr/bin/env bash
# Verify Paper Golf end to end, once: what the verify-paper-golf skill runs
# (.claude/skills/verify-paper-golf/SKILL.md) in every job's done-when.
#
#   bash scripts/verify.sh [--port N] [--shots DIR] [--no-check]     (or: npm run verify -- ...)
#
# 1. `npm run check` (typecheck, lint, vitest, production build into dist/).
# 2. Playwright against that build, served by `vite preview` on a free port (4318
#    by default, or the next free one up to 4338): desktop Chrome and WebKit as an
#    iPhone 14 play a solo hole to the scorecard, a 3-player turn order, the wind
#    on a windy and a calm hole; every spec fails on a console or page error.
# 3. Cleanup: Playwright stops the server and browsers it started; this checks
#    the port is free and no browser it launched is left, and stops any it finds.
# Prints one PASS/FAIL line per step and exits non-zero on any FAIL.
# --shots DIR: save screenshots, per-step logs and failure traces there (default
#   verify-results/, gitignored).
# --no-check: skip step 1 (only to re-run the browser flows on a fresh dist/).
set -uo pipefail
case "${1:-}" in -h | --help) sed -n '2,17p' "$0"; exit 0 ;; esac

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
port="${VERIFY_PORT:-4318}"
shots="verify-results"
run_check=1
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port="$2"; shift 2 ;;
    --shots) shots="$2"; shift 2 ;;
    --no-check) run_check=0; shift ;;
    *) echo "unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done
mkdir -p "$shots/logs"
shots="$(cd "$shots" && pwd)"

results=()
failed=0
record() { # record <PASS|FAIL|SKIP> <step>
  results+=("$1  $2")
  [ "$1" = FAIL ] && failed=1
  echo "── $1  $2"
}

listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null; }
browsers() { pgrep -f 'playwright_chromiumdev_profile|ms-playwright/webkit' 2>/dev/null | sort; }

# Doctor: the right Node, dependencies, the browsers Playwright needs.
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
[ "$node_major" = 22 ] || { echo "✗ Node 22 is required (.nvmrc), found ${node_major:-none}" >&2; exit 1; }
[ -d node_modules ] || npm install --no-audit --no-fund || { echo "✗ npm install failed" >&2; exit 1; }
[ -d "/Applications/Google Chrome.app" ] || { echo "✗ Google Chrome is required (Playwright channel 'chrome')" >&2; exit 1; }
ls -d "$HOME"/Library/Caches/ms-playwright/webkit-* >/dev/null 2>&1 ||
  { echo "✗ Playwright WebKit is missing: npx playwright install webkit" >&2; exit 1; }

# A free port: the requested one, else the next free one (vite preview runs with --strictPort).
first="$port"
while [ -n "$(listening "$port")" ]; do
  port=$((port + 1))
  [ "$port" -le $((first + 20)) ] || { echo "✗ no free port in $first-$((first + 20))" >&2; exit 1; }
done
echo "→ verify $(git rev-parse --short HEAD 2>/dev/null)$( [ -n "$(git status --porcelain 2>/dev/null)" ] && echo ' (uncommitted changes)') on port $port, evidence in $shots"

before="$(browsers)"

if [ "$run_check" = 1 ]; then
  rm -rf dist # the browser flows must never pass on an older build
  if npm run check 2>&1 | tee "$shots/logs/check.log"; then record PASS "npm run check (typecheck, lint, vitest, build)"
  else record FAIL "npm run check (typecheck, lint, vitest, build): see $shots/logs/check.log"; fi
else
  record SKIP "npm run check (--no-check)"
fi

flow() { # flow <log name> <summary> <spec>...
  local name="$1" what="$2"
  shift 2
  if SMOKE_PORT="$port" VERIFY_SHOTS="$shots" npx playwright test --output "$shots/test-results/$name" "$@" 2>&1 | grep -v -e "NO_COLOR' env is ignored" -e 'node --trace-warnings' | tee "$shots/logs/$name.log"; then
    record PASS "$what"
  else
    record FAIL "$what: see $shots/logs/$name.log"
  fi
}

if [ -f dist/index.html ]; then
  flow journey "solo round: tee off, roll, legal dots, shots to the hole card and scorecard (Chrome + iPhone WebKit)" e2e/journey.spec.ts
  flow boot "start page and one deep-link turn (Chrome)" e2e/smoke.spec.ts
  flow turns "multiplayer turn order: away twice, honour on the next tee (Chrome + iPhone WebKit)" e2e/turnorder.spec.ts
  flow wind "wind: HUD and swirls on a windy hole, none on a calm one (Chrome + iPhone WebKit)" e2e/windfx.spec.ts
else
  record FAIL "browser flows: no production build in dist/ (npm run check did not build)"
fi

# Cleanup: nothing of this run may outlive it.
leftover="$(listening "$port")"
if [ -n "$leftover" ]; then
  # The port was free when the run began, so whatever listens there now is this run's vite preview.
  xargs kill <<<"$leftover" 2>/dev/null
  record FAIL "cleanup: a server was still listening on $port (pid $leftover, stopped)"
else
  record PASS "cleanup: port $port free"
fi
# Browsers that appeared during this run and were orphaned (parent gone) are this run's leftovers.
stray=""
for pid in $(comm -13 <(echo "$before") <(browsers)); do
  [ "$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')" = 1 ] && stray="$stray $pid"
done
if [ -n "$stray" ]; then
  xargs kill <<<"$stray" 2>/dev/null
  record FAIL "cleanup: browser processes left behind (pid$stray, stopped)"
else
  record PASS "cleanup: no browser left running"
fi

echo
echo "verify-paper-golf summary"
for r in "${results[@]}"; do echo "  $r"; done
echo "  evidence: $shots (screenshots, logs/)"
if [ "$failed" = 0 ]; then echo "PASS"; else echo "FAIL"; exit 1; fi
