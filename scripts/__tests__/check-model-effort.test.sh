#!/usr/bin/env bash
# Tests .claude/hooks/check-model-effort.sh. A curl stub on PATH proves it sends nothing, drift or not.
# Run: bash scripts/__tests__/check-model-effort.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; H="$ROOT/.claude/hooks/check-model-effort.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cat > "$T/curl" <<'C'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$CURL_OUT"
printf 200
C
chmod +x "$T/curl"
unset CLAUDE_EFFORT ANTHROPIC_MODEL
export PATH="$T:$PATH" CURL_OUT="$T/body" CLAUDE_PROJECT_DIR="$ROOT" CLAUDE_CODE_EFFORT_LEVEL=high CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000
pass=0 fail=0
ok() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }
run() { rm -f "$T/body"; out=$(printf '%s' "$1" | bash "$H" 2>"$T/err"); rc=$?; }
run '{"hook_event_name":"SessionStart","source":"startup","model":"claude-opus-5-5"}'
ok "right model+effort: exit 0" '[ $rc = 0 ]'
ok "right: sends nothing, no output" '[ ! -f "$T/body" ] && [ -z "$out" ] && [ ! -s "$T/err" ]'
run '{"hook_event_name":"SessionStart","source":"startup","model":"claude-opus-5-5[1m]"}'
ok "1m variant counts as Opus 5.5" '[ $rc = 0 ] && [ ! -f "$T/body" ] && [ -z "$out" ] && [ ! -s "$T/err" ]'
run '{"hook_event_name":"SessionStart","source":"startup","model":"claude-opus-5"}'
ok "wrong model: exit 0" '[ $rc = 0 ]'
ok "wrong model: sends nothing" '[ ! -f "$T/body" ]'
ok "wrong model: stderr warning" 'grep -q "MODEL DRIFT: model is claude-opus-5" "$T/err"'
ok "wrong model: additionalContext" '[[ "$(jq -r .hookSpecificOutput.additionalContext <<<"$out")" == *"MODEL DRIFT"* ]]'
CLAUDE_CODE_EFFORT_LEVEL=xhigh run '{"hook_event_name":"SessionStart","source":"startup","model":"claude-opus-5-5"}'
ok "wrong effort: exit 0" '[ $rc = 0 ]'
ok "wrong effort: sends nothing" '[ ! -f "$T/body" ]'
ok "wrong effort: stderr" 'grep -q "effort is xhigh" "$T/err"'
CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 run '{"model":"claude-opus-5-5"}'
ok "wrong compact window: stderr, sends nothing" '[ ! -f "$T/body" ] && grep -q "auto compact window is 200000" "$T/err"'
(unset CLAUDE_CODE_AUTO_COMPACT_WINDOW; printf '%s' '{"model":"claude-opus-5-5"}' | bash "$H" >"$T/o3" 2>"$T/e3"); rc=$?
ok "compact window from settings.json when env unset" '[ $rc = 0 ] && [ ! -s "$T/e3" ]'
(unset CLAUDE_CODE_EFFORT_LEVEL; printf '%s' '{"model":"claude-opus-5-5"}' | bash "$H" >"$T/o2" 2>"$T/e2"); rc=$?
ok "effort from settings.json when env unset" '[ $rc = 0 ] && [ ! -s "$T/e2" ]'
rm -f "$T/body"; out=$(printf '%s' '{"model":"claude-sonnet-5-5"}' | bash "$H" 2>"$T/err"); rc=$?
ok "Sonnet: exit 0, sends nothing, warns in both places" '[ $rc = 0 ] && [ ! -f "$T/body" ] && grep -q "MODEL DRIFT" "$T/err" && [[ "$out" == *"MODEL DRIFT"* ]]'
rm -f "$T/body"; out=$(printf 'not json' | bash "$H" 2>/dev/null); rc=$?
ok "garbage stdin: exit 0" '[ $rc = 0 ]'
out=$(bash "$H" </dev/null 2>/dev/null); rc=$?; ok "empty stdin: exit 0" '[ $rc = 0 ]'
# Mac case: no `timeout` on PATH (Dan, iptv-player PR 17). Build a PATH without timeout/gtimeout.
NT="$T/nt"; mkdir -p "$NT"; for d in ${PATH//:/ }; do [ -d "$d" ] || continue; for f in "$d"/*; do b=${f##*/}; case $b in timeout|gtimeout) continue;; esac; [ -e "$NT/$b" ] || ln -s "$f" "$NT/$b" 2>/dev/null; done; done
rm -f "$T/body"; out=$(printf '%s' '{"model":"claude-opus-5"}' | PATH="$NT" bash "$H" 2>"$T/err"); rc=$?
ok "no timeout: still checks drift" '[ $rc = 0 ] && [ ! -f "$T/body" ] && grep -q "MODEL DRIFT" "$T/err"'
rm -f "$T/body"; out=$(printf '%s' '{"model":"claude-opus-5-5"}' | PATH="$NT" bash "$H" 2>"$T/err"); rc=$?
ok "no timeout: right model stays quiet" '[ $rc = 0 ] && [ ! -f "$T/body" ] && [ ! -s "$T/err" ]'
printf '#!/usr/bin/env bash\necho used > "$GT_LOG"; shift; exec "$@"\n' > "$NT/gtimeout"; chmod +x "$NT/gtimeout"
rm -f "$T/body" "$T/gt"; out=$(printf '%s' '{"model":"claude-opus-5"}' | GT_LOG="$T/gt" PATH="$NT" bash "$H" 2>"$T/err"); rc=$?
ok "gtimeout used when timeout missing" '[ $rc = 0 ] && [ -f "$T/gt" ] && grep -q "MODEL DRIFT" "$T/err"'
# Expected values come from fleet-defaults.json (repo copy at .claude/fleet-defaults.json wins over root)
FR="$T/fr"; mkdir -p "$FR/.claude"; echo '{"model":"claude-opus-9","effort":"medium","autoCompactWindow":300000}' > "$FR/.claude/fleet-defaults.json"
echo '{"model":"claude-opus-5-5","effort":"high","autoCompactWindow":400000}' > "$FR/fleet-defaults.json"
rm -f "$T/body"; out=$(printf '%s' '{"model":"claude-opus-9"}' | CLAUDE_PROJECT_DIR="$FR" CLAUDE_CODE_EFFORT_LEVEL=medium CLAUDE_CODE_AUTO_COMPACT_WINDOW=300000 bash "$H" 2>"$T/err"); rc=$?
ok "fleet-defaults: matching new values stay quiet" '[ $rc = 0 ] && [ ! -f "$T/body" ] && [ ! -s "$T/err" ]'
rm -f "$T/body"; out=$(printf '%s' '{"model":"claude-opus-5-5"}' | CLAUDE_PROJECT_DIR="$FR" bash "$H" 2>"$T/err"); rc=$?
ok "fleet-defaults: old values now drift, message names new pin" 'grep -q "want claude-opus-9" "$T/err" && grep -q "want medium" "$T/err" && [[ "$out" == *"--model claude-opus-9 --effort medium"* ]]'
rm -f "$T/body"; out=$(printf '%s' '{"model":"claude-opus-9"}' | CLAUDE_PROJECT_DIR="$FR" EXPECT_MODEL=claude-opus-9 EXPECT_EFFORT=high EXPECT_COMPACT=400000 bash "$H" 2>"$T/err"); rc=$?
ok "EXPECT_* env overrides fleet-defaults" '[ ! -f "$T/body" ] && [ ! -s "$T/err" ]'
rm "$FR/.claude/fleet-defaults.json"; rm -f "$T/body"; out=$(printf '%s' '{"model":"claude-opus-5-5"}' | CLAUDE_PROJECT_DIR="$FR" bash "$H" 2>"$T/err")
ok "fleet-defaults: root file used when .claude copy absent" '[ ! -f "$T/body" ] && [ ! -s "$T/err" ]'
# Mac case: a stdin pipe left open must not hang (no timeout/gtimeout on PATH).
rm -f "$NT/gtimeout"
s=$(date +%s); out=$(PATH="$NT" bash "$H" < <(printf '%s' '{"model":"claude-opus-5"}'; exec sleep 20) 2>/dev/null); e=$(( $(date +%s)-s ))
ok "mac: open stdin finishes <8s ($e s) and still warns" '[ $e -lt 8 ] && [[ "$out" == *"MODEL DRIFT"* ]]'
echo "pass=$pass fail=$fail"; [ $fail = 0 ]
