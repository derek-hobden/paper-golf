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
# Chrome: CHROME_PATH if set, else /Applications/Google Chrome.app, then
#   /usr/bin/google-chrome, then google-chrome-stable and chromium on PATH.
# WebKit: ~/Library/Caches/ms-playwright or ~/.cache/ms-playwright.
# --print-chrome: print the browser the doctor would pick and exit.
# --doctor: run the doctor only and exit.
set -uo pipefail
case "${1:-}" in -h | --help) sed -n '2,22p' "$0"; exit 0 ;; esac

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
port="${VERIFY_PORT:-4318}"
shots="verify-results"
run_check=1
print_chrome=0
doctor_only=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port="$2"; shift 2 ;;
    --shots) shots="$2"; shift 2 ;;
    --no-check) run_check=0; shift ;;
    --print-chrome) print_chrome=1; shift ;;
    --doctor) doctor_only=1; shift ;;
    *) echo "unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done

results=()
failed=0
record() { # record <PASS|FAIL|SKIP> <step>
  results+=("$1  $2")
  [ "$1" = FAIL ] && failed=1
  echo "── $1  $2"
}

listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null; }
browsers() { pgrep -f 'playwright_chromiumdev_profile|ms-playwright/webkit' 2>/dev/null | sort; }

# First usable Chrome. CHROME_PATH wins. Otherwise the macOS app, then
# /usr/bin/google-chrome, then google-chrome-stable and chromium on PATH.
# VERIFY_CHROME_APP and VERIFY_CHROME_USR stand in for those two absolute
# paths so the order can be tested without the machine's real browser.
resolve_chrome() {
  if [ -n "${CHROME_PATH:-}" ]; then
    if [ -d "$CHROME_PATH" ] || [ -x "$CHROME_PATH" ]; then
      printf '%s\n' "$CHROME_PATH"
      return 0
    fi
    echo "✗ CHROME_PATH is set but not found: $CHROME_PATH" >&2
    return 1
  fi
  local app="${VERIFY_CHROME_APP:-/Applications/Google Chrome.app}"
  local usr="${VERIFY_CHROME_USR:-/usr/bin/google-chrome}"
  local bin
  if [ -d "$app" ]; then
    printf '%s\n' "$app"
    return 0
  fi
  if [ -x "$usr" ]; then
    printf '%s\n' "$usr"
    return 0
  fi
  bin="$(command -v google-chrome-stable 2>/dev/null || true)"
  if [ -n "$bin" ]; then
    printf '%s\n' "$bin"
    return 0
  fi
  bin="$(command -v chromium 2>/dev/null || true)"
  if [ -n "$bin" ]; then
    printf '%s\n' "$bin"
    return 0
  fi
  echo "✗ Google Chrome is required (Playwright channel 'chrome')" >&2
  return 1
}

# Path Playwright should launch, or empty to keep channel 'chrome'.
# A CHROME_PATH file and chromium are launched by path. The macOS app and
# Google Chrome stay on the channel, which finds those builds itself.
chrome_executable() {
  local chosen="$1"
  if [ -n "${CHROME_PATH:-}" ] && [ -x "$CHROME_PATH" ] && [ ! -d "$CHROME_PATH" ]; then
    printf '%s\n' "$CHROME_PATH"
    return 0
  fi
  case "$(basename "$chosen")" in
    chromium | chromium-browser) printf '%s\n' "$chosen" ;;
  esac
}

webkit_ready() {
  local root dir
  for root in "$HOME/Library/Caches/ms-playwright" "${XDG_CACHE_HOME:-$HOME/.cache}/ms-playwright"; do
    for dir in "$root"/webkit-*; do
      [ -d "$dir" ] && return 0
    done
  done
  return 1
}

if [ "$print_chrome" = 1 ]; then
  chosen="$(resolve_chrome)" || exit 1
  printf 'chosen=%s\n' "$chosen"
  exec_path="$(chrome_executable "$chosen")"
  if [ -n "$exec_path" ]; then printf 'launch=%s\n' "$exec_path"; else printf 'launch=channel\n'; fi
  exit 0
fi

# Doctor: the right Node, dependencies, the browsers Playwright needs.
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
[ "$node_major" = 22 ] || { echo "✗ Node 22 is required (.nvmrc), found ${node_major:-none}" >&2; exit 1; }
[ -d node_modules ] || npm install --no-audit --no-fund || { echo "✗ npm install failed" >&2; exit 1; }
chosen="$(resolve_chrome)" || exit 1
exec_path="$(chrome_executable "$chosen")"
if [ -n "$exec_path" ]; then export CHROME_PATH="$exec_path"; fi
webkit_ready || { echo "✗ Playwright WebKit is missing: npx playwright install webkit" >&2; exit 1; }
if [ "$doctor_only" = 1 ]; then exit 0; fi

mkdir -p "$shots/logs"
shots="$(cd "$shots" && pwd)"

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
  flow builder "course builder: draw a hole, share it, open the link and play it (Chrome + iPhone WebKit)" e2e/builder.spec.ts
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
