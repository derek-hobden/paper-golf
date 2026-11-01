#!/usr/bin/env bash
# Tests .claude/hooks/check-model-effort.sh with curl stubbed on PATH (no network).
# Run: bash scripts/__tests__/check-model-effort.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; H="$ROOT/.claude/hooks/check-model-effort.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cat > "$T/curl" <<'C'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do case "$1" in --data) printf '%s' "$2" > "$CURL_OUT"; shift;; esac; shift; done
printf 200
C
chmod +x "$T/curl"
unset CLAUDE_EFFORT ANTHROPIC_MODEL FACTORY_PING_URL FACTORY_PING_KEY
export PATH="$T:$PATH" CURL_OUT="$T/body" CLAUDE_PROJECT_DIR="$ROOT" BOT_PING_LOG="$T/log" \
  BOT_WEBHOOK_URL=https://hook.example/x BOT_WEBHOOK_KEY=k CLAUDE_CODE_EFFORT_LEVEL=low
pass=0 fail=0
ok() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }
run() { rm -f "$T/body"; out=$(printf '%s' "$1" | bash "$H" 2>"$T/err"); rc=$?; }
run '{"hook_event_name":"SessionStart","source":"startup","model":"claude-opus-5-5"}'
ok "right model+effort: exit 0" '[ $rc = 0 ]'
ok "right: no ping, no output" '[ ! -f "$T/body" ] && [ -z "$out" ] && [ ! -s "$T/err" ]'
run '{"hook_event_name":"SessionStart","source":"startup","model":"claude-opus-5-5[1m]"}'
ok "1m variant counts as Opus 5.5" '[ ! -f "$T/body" ]'
run '{"hook_event_name":"SessionStart","source":"startup","model":"claude-opus-5"}'
ok "wrong model: exit 0" '[ $rc = 0 ]'
ok "wrong model: ping model_drift" '[ "$(jq -r .event "$T/body")" = model_drift ] && [ "$(jq -r .kind "$T/body")" = alert ] && [ "$(jq -r .model "$T/body")" = claude-opus-5 ]'
ok "wrong model: stderr warning" 'grep -q "MODEL DRIFT: model is claude-opus-5" "$T/err"'
ok "wrong model: additionalContext" '[[ "$(jq -r .hookSpecificOutput.additionalContext <<<"$out")" == *"MODEL DRIFT"* ]]'
CLAUDE_CODE_EFFORT_LEVEL=xhigh run '{"hook_event_name":"SessionStart","source":"startup","model":"claude-opus-5-5"}'
ok "wrong effort: exit 0" '[ $rc = 0 ]'
ok "wrong effort: ping with effort" '[ "$(jq -r .effort_level "$T/body")" = xhigh ] && [ "$(jq -r .event "$T/body")" = model_drift ]'
ok "wrong effort: stderr" 'grep -q "effort is xhigh" "$T/err"'
(unset CLAUDE_CODE_EFFORT_LEVEL; printf '%s' '{"model":"claude-opus-5-5"}' | bash "$H" >"$T/o2" 2>"$T/e2"); rc=$?
ok "effort from settings.json when env unset" '[ $rc = 0 ] && [ ! -s "$T/e2" ]'
rm -f "$T/body"; out=$(printf '%s' '{"model":"claude-sonnet-5-5"}' | BOT_WEBHOOK_URL= BOT_WEBHOOK_KEY= bash "$H" 2>"$T/err"); rc=$?
ok "missing webhook: exit 0, no ping, still warns" '[ $rc = 0 ] && [ ! -f "$T/body" ] && grep -q "MODEL DRIFT" "$T/err" && [[ "$out" == *"MODEL DRIFT"* ]]'
rm -f "$T/body"; out=$(printf 'not json' | bash "$H" 2>/dev/null); rc=$?
ok "garbage stdin: exit 0" '[ $rc = 0 ]'
out=$(bash "$H" </dev/null 2>/dev/null); rc=$?; ok "empty stdin: exit 0" '[ $rc = 0 ]'
# Mac case: no `timeout` on PATH (Dan, iptv-player PR 17). Build a PATH without timeout/gtimeout.
NT="$T/nt"; mkdir -p "$NT"; for d in ${PATH//:/ }; do [ -d "$d" ] || continue; for f in "$d"/*; do b=${f##*/}; case $b in timeout|gtimeout) continue;; esac; [ -e "$NT/$b" ] || ln -s "$f" "$NT/$b" 2>/dev/null; done; done
rm -f "$T/body"; out=$(printf '%s' '{"model":"claude-opus-5"}' | PATH="$NT" bash "$H" 2>"$T/err"); rc=$?
ok "no timeout: still checks and pings drift" '[ $rc = 0 ] && [ "$(jq -r .event "$T/body" 2>/dev/null)" = model_drift ] && grep -q "MODEL DRIFT" "$T/err"'
rm -f "$T/body"; out=$(printf '%s' '{"model":"claude-opus-5-5"}' | PATH="$NT" bash "$H" 2>"$T/err"); rc=$?
ok "no timeout: right model stays quiet" '[ $rc = 0 ] && [ ! -f "$T/body" ] && [ ! -s "$T/err" ]'
printf '#!/usr/bin/env bash\necho used > "$GT_LOG"; shift; exec "$@"\n' > "$NT/gtimeout"; chmod +x "$NT/gtimeout"
rm -f "$T/body" "$T/gt"; out=$(printf '%s' '{"model":"claude-opus-5"}' | GT_LOG="$T/gt" PATH="$NT" bash "$H" 2>"$T/err"); rc=$?
ok "gtimeout used when timeout missing" '[ $rc = 0 ] && [ -f "$T/gt" ] && grep -q "MODEL DRIFT" "$T/err"'
echo "pass=$pass fail=$fail"; [ $fail = 0 ]
