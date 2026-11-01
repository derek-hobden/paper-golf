#!/usr/bin/env bash
# Tests scripts/claude-hooks/bot-ping.sh (ping only) and scripts/claude-hooks/auto-approve.sh.
# curl is stubbed on PATH (no network). Run: bash scripts/__tests__/bot-ping.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; P="$ROOT/scripts/claude-hooks/bot-ping.sh"; A="$ROOT/scripts/claude-hooks/auto-approve.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cat > "$T/curl" <<'C'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$CURL_ARGS"
while [ $# -gt 0 ]; do case "$1" in --data) printf '%s' "$2" > "$CURL_OUT"; shift;; esac; shift; done
printf 200
C
chmod +x "$T/curl"
unset FACTORY_PING_URL FACTORY_PING_KEY FACTORY_PING_SNIPPET FACTORY_AUTO_APPROVE BOT_AUTO_APPROVE CLAUDE_CODE_REMOTE CLAUDE_CODE_REMOTE_SESSION_ID
export PATH="$T:$PATH" CURL_OUT="$T/body" CURL_ARGS="$T/args" CLAUDE_PROJECT_DIR="$ROOT" BOT_PING_LOG="$T/log" \
  BOT_WEBHOOK_URL=https://hook.example/x BOT_WEBHOOK_KEY=k
pass=0 fail=0
ok() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }
ping() { rm -f "$T/body"; out=$(printf '%s' "$2" | bash "$P" "$1" 2>/dev/null); rc=$?; }
j() { jq -r "$1" "$T/body" 2>/dev/null; }
kw() { [ "$(j .kind)" = "$1" ] && [ "$(j .waiting)" = "$2" ]; }
SECRET='call me at bob@ex.com 0501234567 my password is hunter2'
# --- classifier ---
ping model_drift '{"model":"claude-opus-5","effort_level":"low","effort_source":"env"}'
ok "model_drift -> alert" 'kw alert false && [ "$(j .event)" = model_drift ] && [ "$(j .model)" = claude-opus-5 ]'
for nt in permission_prompt idle_prompt elicitation_dialog elicitation_url_dialog agent_needs_input quota_auto_resume_stale; do
  ping Notification "{\"notification_type\":\"$nt\",\"message\":\"$SECRET\"}"
  ok "Notification $nt -> alert waiting" 'kw alert true && [ "$(j .notification_type)" = '$nt' ]'
done
for nt in quota_auto_resume_fired quota_auto_resume_disabled; do
  ping Notification "{\"notification_type\":\"$nt\"}"; ok "Notification $nt -> info" 'kw info false'
done
ping Elicitation '{"mcp_server_name":"s","mode":"form"}'; ok "Elicitation -> alert waiting" 'kw alert true && [ "$(j .mcp_server_name)" = s ]'
ping StopFailure '{"reason":"api_error"}'; ok "StopFailure -> alert" 'kw alert false'
ping PermissionDenied '{"reason":"auto mode"}'; ok "PermissionDenied -> alert" 'kw alert false && [ "$(j .reason)" = "auto mode" ]'
ping Stop "{\"last_assistant_message\":\"Shall I open the PR? $SECRET?\"}"
ok "Stop with question -> info, question=true" 'kw info false && [ "$(j .event)" = Stop ] && [ "$(j .question)" = true ]'
ping Stop '{"last_assistant_message":"Done."}'; ok "Stop without question -> question=false" '[ "$(j .question)" = false ]'
ping SessionEnd '{"reason":"other","session_id":"abc"}'
ok "SessionEnd -> info with reason+session" 'kw info false && [ "$(j .stop_reason)" = other ] && [ "$(j .session_id)" = abc ]'
ping SessionStart '{"source":"startup"}'; ok "SessionStart -> info" 'kw info false && [ "$(j .source)" = startup ]'
ping PostToolUse '{"tool_name":"Bash","tool_input":{"command":"gh pr create --title x"},"tool_response":{"stdout":"https://github.com/o/r/pull/7"}}'
ok "PostToolUse gh pr create -> pr_opened, no command text" '[ "$(j .event)" = pr_opened ] && [ "$(j .pr_url)" = https://github.com/o/r/pull/7 ] && [ "$(j .command)" = null ]'
ping PostToolUse '{"tool_name":"Bash","tool_input":{"command":"git push origin HEAD"}}'; ok "PostToolUse git push -> pushed" '[ "$(j .event)" = pushed ]'
ping PostToolUse '{"tool_name":"Bash","tool_input":{"command":"ls"}}'; ok "PostToolUse other -> no ping" '[ ! -f "$T/body" ]'
ping PermissionRequest '{"tool_name":"Bash","tool_input":{"command":"npm test"}}'
ok "PermissionRequest auto-approved -> info, auto_approved" 'kw info false && [ "$(j .auto_approved)" = true ] && [ -z "$out" ]'
ping PermissionRequest '{"tool_name":"Bash","tool_input":{"command":"git push --force origin x"}}'
ok "PermissionRequest denied-pattern -> alert waiting" 'kw alert true && [ "$(j .auto_approved)" = false ]'
FACTORY_AUTO_APPROVE=0 ping PermissionRequest '{"tool_name":"Bash","tool_input":{"command":"npm test"}}'
ok "PermissionRequest with auto off -> alert waiting" 'kw alert true'
# --- privacy ---
ping Notification "{\"notification_type\":\"permission_prompt\",\"message\":\"$SECRET\",\"cwd\":\"/home/u/secret\",\"tool_input\":{\"command\":\"echo $SECRET\"},\"prompt\":\"$SECRET\"}"
ok "default: no text fields" '[ "$(j "has(\"prompt_text\") or has(\"snippet\") or has(\"command\") or has(\"cwd\") or has(\"tool_input\")")" = false ]'
ok "default: no secret anywhere in body" '! grep -qE "bob@|hunter2|0501234567|/home/u" "$T/body"'
ok "default: has metadata" '[ "$(j .event)" = Notification ] && [ "$(j .ts|grep -cE "^[0-9]+$")" = 1 ] && jq -e "has(\"repo\") and has(\"branch\") and has(\"session_id\") and has(\"tool_name\")" "$T/body" >/dev/null'
FACTORY_PING_SNIPPET=1 ping Notification "{\"notification_type\":\"permission_prompt\",\"message\":\"$SECRET\"}"
ok "snippet opt-in: present, redacted" '[ -n "$(j .snippet)" ] && ! grep -qE "bob@|hunter2|0501234567" "$T/body" && [[ "$(j .snippet)" == *"[email]"* ]] && [[ "$(j .snippet)" == *"[num]"* ]]'
long=$(printf 'word %.0s' {1..100}); FACTORY_PING_SNIPPET=1 ping Notification "{\"notification_type\":\"idle_prompt\",\"message\":\"$long ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456\"}"
ok "snippet <=120 chars" '[ "$(j ".snippet|length")" -le 120 ]'
FACTORY_PING_SNIPPET=1 ping Notification '{"notification_type":"idle_prompt","message":"use key sk-abcdef1234567890XYZ and AKIAABCDEFGHIJKLMNOPQRSTUV now"}'
ok "snippet strips key-like strings" '! grep -qE "sk-abc|AKIAABCD" "$T/body"'
FACTORY_PING_SNIPPET=1 ping Notification '{"notification_type":"idle_prompt","message":"set SECRET=abc123 and TOKEN: zzz"}'
ok "snippet cuts after secret/token" '! grep -qE "abc123|zzz" "$T/body"'
# --- curl always time-capped ---
ping Stop '{}'; ok "curl has --connect-timeout and --max-time" 'grep -q -- "--connect-timeout" "$T/args" && grep -q -- "--max-time" "$T/args"'
ok "bot-ping never prints the URL/key and logs http=200" '! grep -q hook.example "$T/log" && grep -q "Stop http=200" "$T/log"'
# --- auto-approve.sh ---
aa() { out=$(printf '%s' "$1" | bash "$A" 2>/dev/null); rc=$?; }
allow() { [ "$(jq -r .hookSpecificOutput.decision.behavior <<<"$out" 2>/dev/null)" = allow ]; }
aa '{"tool_name":"Bash","tool_input":{"command":"npm test"}}'; ok "auto-approve on by default" 'allow && [ $rc = 0 ]'
aa '{"tool_name":"Edit","tool_input":{"file_path":"/r/.claude/x"},"permission_suggestions":[{"type":"addDirectories","destination":"session"},{"type":"x","destination":"userSettings"}]}'
ok "echoes only session suggestions" 'allow && [ "$(jq ".hookSpecificOutput.decision.updatedPermissions|length" <<<"$out")" = 1 ]'
out=$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"npm test"}}' | FACTORY_AUTO_APPROVE=0 bash "$A"); ok "FACTORY_AUTO_APPROVE=0 -> nothing" '[ -z "$out" ]'
out=$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"npm test"}}' | BOT_AUTO_APPROVE=0 CLAUDE_CODE_REMOTE=true bash "$A"); ok "legacy BOT_AUTO_APPROVE=0 -> nothing" '[ -z "$out" ]'
out=$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"npm test"}}' | FACTORY_AUTO_APPROVE=1 bash "$A"); ok "FACTORY_AUTO_APPROVE=1 -> allow" 'allow'
for c in 'git push --force origin x' 'cd x && git push -f origin y' 'gh repo delete o/r --yes' 'git push origin HEAD:refs/tags/ci-green'; do
  aa "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$c\"}}"; ok "deny respected: $c" '[ -z "$out" ] && [ $rc = 0 ]'
done
aa '{"tool_name":"Read","tool_input":{"file_path":"/repo/.env"}}'; ok "deny respected: Read .env" '[ -z "$out" ]'
aa '{"tool_name":"Write","tool_input":{"file_path":"/repo/app/.env.production"}}'; ok "deny respected: Write .env.production" '[ -z "$out" ]'
aa '{"tool_name":"mcp__github__merge_pull_request","tool_input":{}}'; ok "deny respected: MCP merge" '[ -z "$out" ]'
aa '{"tool_name":"AskUserQuestion","tool_input":{}}'; ok "deny respected: AskUserQuestion" '[ -z "$out" ]'
aa '{"tool_name":"Read","tool_input":{"file_path":"/repo/src/env.ts"}}'; ok "non-denied Read allowed" 'allow'
for c in 'rm -rf /' 'rm -rf /*' 'rm -rf ~' 'rm -rf $HOME' 'sudo rm -rf /usr' 'rm -fr /etc/' 'rm -rf --no-preserve-root /' 'rm -rf .git' 'cd /tmp; rm -rf *'; do
  aa "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$c\"}}"; ok "rm critical refused: $c" '[ -z "$out" ]'
done
aa '{"tool_name":"Bash","tool_input":{"command":"rm -rf \"${D:?}\"/build"}}'; ok "rm of project path allowed" 'allow'
aa 'not json'; ok "garbage stdin: exit 0" '[ $rc = 0 ]'
out=$(bash "$A" </dev/null); ok "empty stdin: allow (no deny match)" 'allow'
# --- Mac case: no timeout/gtimeout on PATH; stdin pipe left open must not hang ---
NT="$T/nt"; mkdir -p "$NT"; for d in ${PATH//:/ }; do [ -d "$d" ] || continue; for f in "$d"/*; do b=${f##*/}; case $b in timeout|gtimeout) continue;; esac; [ -e "$NT/$b" ] || ln -s "$f" "$NT/$b" 2>/dev/null; done; done
ok "mac PATH has no timeout/gtimeout" '! PATH="$NT" command -v timeout >/dev/null && ! PATH="$NT" command -v gtimeout >/dev/null'
rm -f "$T/body"; s=$(date +%s)
out=$(PATH="$NT" bash "$P" Notification < <(printf '%s' '{"notification_type":"permission_prompt"}'; exec sleep 20) 2>/dev/null); e=$(( $(date +%s)-s ))
ok "mac: bot-ping with open stdin finishes <8s ($e s) and pings" '[ $e -lt 8 ] && [ "$(j .kind)" = alert ]'
rm -f "$T/body"; s=$(date +%s)
out=$(PATH="$NT" bash "$P" PermissionRequest < <(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"npm test"}}'; exec sleep 20) 2>/dev/null); e=$(( $(date +%s)-s ))
ok "mac: PermissionRequest ping finishes <8s ($e s)" '[ $e -lt 8 ] && [ "$(j .auto_approved)" = true ]'
s=$(date +%s); out=$(PATH="$NT" bash "$A" < <(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"npm test"}}'; exec sleep 20) 2>/dev/null); e=$(( $(date +%s)-s ))
ok "mac: auto-approve finishes <8s ($e s) and allows" '[ $e -lt 8 ] && allow'
s=$(date +%s); out=$(PATH="$NT" bash "$ROOT/.claude/hooks/check-model-effort.sh" < <(printf '%s' '{"model":"claude-opus-5"}'; exec sleep 20) 2>/dev/null); e=$(( $(date +%s)-s ))
ok "mac: check-model-effort open stdin finishes <8s ($e s)" '[ $e -lt 8 ] && [[ "$out" == *"MODEL DRIFT"* ]]'
<<<<<<< HEAD
# --- wrapper forms (Cat, 23:48): options that take a value must not be mistaken for the duration/command ---
while IFS= read -r c; do [ -n "$c" ] || continue
  J=$(python3 -c 'import json,sys;print(json.dumps({"tool_name":"Bash","tool_input":{"command":sys.argv[1]},"tool_response":{"stdout":"https://github.com/o/r/pull/7"}}))' "$c")
  ping PostToolUse "$J"; ok "wrapper: $c -> pr_opened" '[ "$(j .event)" = pr_opened ]'
done <<'WRAP'
timeout 30 gh pr create --title x
timeout -s KILL 30 gh pr create --title x
timeout -k 5 30 gh pr create --title x
timeout --signal KILL 30 gh pr create --title x
timeout --signal=KILL 30 gh pr create --title x
timeout --kill-after 5 30 gh pr create --title x
timeout --kill-after=5 -s TERM 30 gh pr create --title x
gtimeout -s KILL 30 gh pr create --title x
env GH_REPO=o/r gh pr create --title x
env -u FOO A=1 gh pr create --title x
FOO=1 BAR=2 gh pr create --title x
nice gh pr create --title x
nice -n 10 gh pr create --title x
nice -10 gh pr create --title x
nohup gh pr create --title x
nohup nice -n 5 timeout -s KILL 30 env A=1 gh pr create --title x
command gh pr create --title x
time gh pr create --title x
stdbuf -o L gh pr create --title x
sudo -u bot gh pr create --title x
WRAP
J=$(python3 -c 'import json,sys;print(json.dumps({"tool_name":"Bash","tool_input":{"command":sys.argv[1]},"tool_response":{"stdout":""}}))' 'timeout -s KILL 30 gh pr list')
ping PostToolUse "$J"; ok "wrapper: timeout -s KILL 30 gh pr list -> not pr_opened" '[ "$(j .event)" != pr_opened ]'
=======
>>>>>>> origin/main
echo "pass=$pass fail=$fail"; [ $fail = 0 ]
