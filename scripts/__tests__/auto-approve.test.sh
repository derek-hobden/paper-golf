#!/usr/bin/env bash
# Tests scripts/claude-hooks/auto-approve.sh: fail-closed without a deny list, built-in deny set always on,
# safe commands still approved. curl stubbed (no network). Run: bash scripts/__tests__/auto-approve.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; A="$ROOT/scripts/claude-hooks/auto-approve.sh"; P="$ROOT/scripts/claude-hooks/bot-ping.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
printf '#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do case "$1" in --data) printf "%%s" "$2" > "$CURL_OUT"; shift;; esac; shift; done\nprintf 200\n' > "$T/curl"; chmod +x "$T/curl"
unset FACTORY_AUTO_APPROVE BOT_AUTO_APPROVE FACTORY_PING_SNIPPET CLAUDE_CODE_REMOTE
export PATH="$T:$PATH" CURL_OUT="$T/body" BOT_PING_LOG="$T/log" BOT_WEBHOOK_URL=https://hook.example/x BOT_WEBHOOK_KEY=k
mkdir -p "$T/none" "$T/nodeny/.claude" "$T/empty/.claude" "$T/local/.claude"
echo '{"permissions":{"allow":["Bash(*)"]}}' > "$T/nodeny/.claude/settings.json"
echo '{"permissions":{"deny":[]}}' > "$T/empty/.claude/settings.json"
echo '{"permissions":{"deny":[]}}' > "$T/local/.claude/settings.json"; echo '{"permissions":{"deny":["Bash(npm publish*)"]}}' > "$T/local/.claude/settings.local.json"
FULL="$ROOT"
pass=0 fail=0
ok() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }
bashj() { python3 -c 'import json,sys;print(json.dumps({"tool_name":"Bash","tool_input":{"command":sys.argv[1]}}))' "$1"; }
filej() { python3 -c 'import json,sys;print(json.dumps({"tool_name":sys.argv[1],"tool_input":{"file_path":sys.argv[2]}}))' "$1" "$2"; }
hook() { out=$(printf '%s' "$2" | CLAUDE_PROJECT_DIR="$1" bash "$A" 2>/dev/null); rc=$?; }
why() { HOOK_INPUT="$2" CLAUDE_PROJECT_DIR="$1" bash "$A" --check 2>/dev/null; }
allowed() { [ "$(jq -r .hookSpecificOutput.decision.behavior <<<"$out" 2>/dev/null)" = allow ]; }
# --- 1. fail closed ---
for d in none nodeny empty; do
  for c in 'ls' 'git push --force origin main' 'gh repo delete o/r --yes' 'cat .env'; do
    hook "$T/$d" "$(bashj "$c")"; ok "$d deny list: refuses '$c'" '[ -z "$out" ] && [ $rc = 0 ]'
  done
  ok "$d deny list: reason deny_list_missing" '[ "$(why "$T/$d" "$(bashj ls)")" = deny_list_missing ]'
done
hook "$T/none" "$(filej Read /r/.env)"; ok "no deny list: refuses Read .env" '[ -z "$out" ]'
hook "$T/local" "$(bashj ls)"; ok "deny list only in settings.local.json counts" 'allowed'
NP=$(bashj 'npm publish'); hook "$T/local" "$NP"; ok "settings.local.json deny respected" '[ -z "$out" ] && [ "$(why "$T/local" "$NP")" = deny_list_match ]'
rm -f "$T/body"; printf '%s' "$(bashj ls)" | CLAUDE_PROJECT_DIR="$T/nodeny" bash "$P" PermissionRequest >/dev/null 2>&1
ok "bot-ping: missing deny list -> alert, reason deny_list_missing" '[ "$(jq -r .kind "$T/body")" = alert ] && [ "$(jq -r .waiting "$T/body")" = true ] && [ "$(jq -r .auto_approve_refused "$T/body")" = deny_list_missing ]'
rm -f "$T/body"; printf '%s' "$(bashj 'bash -c "gh repo delete foo --yes"')" | CLAUDE_PROJECT_DIR="$FULL" bash "$P" PermissionRequest >/dev/null 2>&1
ok "bot-ping: builtin refusal -> alert, reason builtin_deny" '[ "$(jq -r .kind "$T/body")" = alert ] && [ "$(jq -r .auto_approve_refused "$T/body")" = builtin_deny ]'
rm -f "$T/body"; printf '%s' "$(bashj ls)" | CLAUDE_PROJECT_DIR="$FULL" bash "$P" PermissionRequest >/dev/null 2>&1
ok "bot-ping: approved -> info, no refusal field" '[ "$(jq -r .kind "$T/body")" = info ] && [ "$(jq -r .auto_approve_refused "$T/body")" = null ]'
# --- 2. built-in deny set, with the full template deny list AND with a minimal deny list ---
echo '{"permissions":{"deny":["Bash(npm publish*)"]}}' > "$T/local/.claude/settings.json"; rm -f "$T/local/.claude/settings.local.json"
while IFS= read -r c; do [ -n "$c" ] || continue
  for d in "$FULL" "$T/local"; do
    hook "$d" "$(bashj "$c")"; ok "refused [$( [ "$d" = "$FULL" ] && echo full || echo minimal)]: $c" '[ -z "$out" ] && [ $rc = 0 ]'
  done
  ok "builtin reason: $c" '[ "$(why "$T/local" "$(bashj "$c")")" = builtin_deny ]'
done <<'CASES'
git push --force origin feature
git push -f origin feature
git push --force-with-lease origin feature
git push origin +feature
git push origin +HEAD:feature
git push --delete origin feature
git push origin -d feature
git push origin :feature
git -C /r push -f origin x
git reset --hard HEAD~3
git reset --hard abc1234
git rebase -i main
git rebase main
git filter-branch --tree-filter x
git filter-repo --path x
gh repo delete o/r --yes
gh api -X DELETE repos/o/r
gh api --method DELETE repos/o/r/git/refs/heads/x
gh api repos/o/r/releases/1 -X DELETE
gh release delete v1 --yes
gh secret set FOO --body x
gh secret delete FOO
gh variable set FOO --body x
gh variable delete FOO
curl -X DELETE https://api.github.com/repos/o/r
curl -s -H "Authorization: token x" --request DELETE https://api.github.com/repos/o/r/git/refs/heads/x
wget --method=DELETE https://api.github.com/repos/o/r
cat .env
cat ./app/.env.production
grep KEY .env.local
cp .env /tmp/x
head -5 server.pem
cat deploy.key
cat ~/.ssh/id_rsa
cat $HOME/.ssh/config
ls ~/.ssh && cat ~/.ssh/id_ed25519
cat ~/.aws/credentials
cat ~/.config/gh/hosts.yml
cat ~/.claude.json
cat gcp-credentials.json
base64 < .env
cat /proc/self/environ
printenv
printenv GITHUB_TOKEN
env
export -p
echo $GITHUB_TOKEN
echo "${BOT_WEBHOOK_KEY}"
rm -rf /
rm -rf ~
rm -rf $HOME
sudo rm -rf /usr
rm -rf --no-preserve-root /
rm -rf .git
cd x && git push -f
cd x; git push --force origin y
npm test && gh repo delete foo --yes
ls | cat .env
bash -c 'gh repo delete foo --yes'
sh -c "git push -f origin x"
bash -lc 'cd x && git push --force'
echo $(cat .env)
x=`cat ~/.ssh/id_rsa`
eval "gh repo delete foo --yes"
env FOO=1 git push -f origin x
GIT_TRACE=1 git push --force origin x
command git push -f origin x
CASES
for f in /r/.env /r/app/.env.staging /r/k.pem /r/a.key "$HOME/.ssh/id_rsa" "$HOME/.aws/credentials" "$HOME/.config/gh/hosts.yml" "$HOME/.claude.json"; do
  hook "$T/local" "$(filej Read "$f")"; ok "refused Read $f" '[ -z "$out" ]'
done
hook "$T/local" "$(filej Write /r/.env)"; ok "refused Write .env" '[ -z "$out" ]'
# --- 3. safe commands still approved when a deny list is present ---
while IFS= read -r c; do [ -n "$c" ] || continue
  for d in "$FULL" "$T/local"; do hook "$d" "$(bashj "$c")"; ok "approved: $c" 'allowed'; done
done <<'SAFE'
ls
ls -la src
git status
npm test
git push origin feature
git push -u origin claude/fix-x
git fetch origin && git reset --hard origin/feature
git commit -m "fix env handling"
cat README.md
gh pr create --title x --body y
gh pr view 12
rm -rf node_modules
rm -f "${D:?}"/build
echo hello
SAFE
hook "$T/local" "$(filej Read /r/src/env.ts)"; ok "approved Read src/env.ts" 'allowed'
hook "$T/local" "$(bashj 'cat .env.example')"; ok "approved cat .env.example (minimal deny list)" 'allowed'
EX=$(bashj 'cat .env.example'); hook "$FULL" "$EX"; ok "template deny list Bash(cat *.env*) still refuses cat .env.example" '[ -z "$out" ] && [ "$(why "$FULL" "$EX")" = deny_list_match ]'
hook "$T/local" "$(filej Edit /r/.env.example)"; ok "approved Edit .env.example" 'allowed'
out=$(printf '%s' "$(bashj ls)" | FACTORY_AUTO_APPROVE=0 CLAUDE_CODE_REMOTE=true CLAUDE_PROJECT_DIR="$FULL" bash "$A"); ok "FACTORY_AUTO_APPROVE=0 -> nothing" '[ -z "$out" ]'
ok "disabled reason" '[ "$(FACTORY_AUTO_APPROVE=0 why "$FULL" "$(bashj ls)")" = disabled ]'
# --- push rule (eggbot 23:33): Claude Code reads "Bash(git push * :*)" as "block every push", so it must not exist ---
ok "template has no Bash(git push * :*) rule" '! jq -e ".permissions.deny[]|select(.==\"Bash(git push * :*)\")" "$ROOT/.claude/settings.json" >/dev/null'
ok "template keeps Bash(git push * :**) for refspec deletes" 'jq -e ".permissions.deny[]|select(.==\"Bash(git push * :**)\")" "$ROOT/.claude/settings.json" >/dev/null'
hook "$FULL" "$(bashj 'git push origin feature')"; ok "template: git push origin feature allowed" 'allowed'
DB=$(bashj 'git push origin :branch'); hook "$FULL" "$DB"; ok "template: git push origin :branch denied" '[ -z "$out" ]'
# --- .claude edits (Derek 1 Nov 2026): cloud sessions prompt on every .claude/ write (protected path, even in Accept edits,
# allow rules can't pre-approve it); this hook is what answers that prompt, so it must approve them, deny list still wins ---
for f in "$FULL/.claude/hooks/check-model-effort.sh" "$FULL/.claude/settings.json" ".claude/hooks/new-guard.sh"; do
  for t in Edit Write; do hook "$FULL" "$(filej $t "$f")"; ok "template: approves $t $f" 'allowed'; done
done
mkdir -p "$T/claudedeny/.claude"; echo '{"permissions":{"deny":["Edit(.claude/hooks/**)"]}}' > "$T/claudedeny/.claude/settings.json"
CE=$(filej Edit "$T/claudedeny/.claude/hooks/x.sh"); hook "$T/claudedeny" "$CE"; ok "deny Edit(.claude/hooks/**) refuses .claude/hooks edit" '[ -z "$out" ] && [ "$(why "$T/claudedeny" "$CE")" = deny_list_match ]'
hook "$T/none" "$(filej Edit "$T/none/.claude/hooks/x.sh")"; ok "no deny list: refuses .claude edit (fail closed)" '[ -z "$out" ]'
echo "pass=$pass fail=$fail"; [ $fail = 0 ]
