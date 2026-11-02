#!/usr/bin/env bash
# Tests bootstrap/launch-cloud.sh with gh/script stubbed (no network, no real session).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; L="$ROOT/bootstrap/launch-cloud.sh"
TFD="$(bash "$ROOT/scripts/fleet/fleet-defaults.sh" --root "$ROOT" path)"  # shared resolver: .claude/ first, then root
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; export HOME="$T/home"; mkdir -p "$HOME"
cat > "$T/gh" <<'G'
#!/usr/bin/env bash
# gh repo clone R DIR -- ... -b BRANCH
echo "$*" >> "$GH_CALLS"
d="$4"; b=""; while [ $# -gt 0 ]; do [ "$1" = -b ] && b="$2"; shift; done
mkdir -p "$d/.claude"; git -C "$d" init -q -b "$b"
[ "${SEEDED:-1}" = 1 ] && echo '{"hooks":{"PermissionRequest":[{"hooks":[{"command":"bash scripts/claude-hooks/auto-approve.sh"}]}]}}' > "$d/.claude/settings.json"
[ -n "${REPO_OWNER-gus}" ] && echo "${REPO_OWNER-gus}" > "$d/.claude/bot-owner"
[ -n "${REPO_FD:-}" ] && printf '%s' "$REPO_FD" > "$d/.claude/fleet-defaults.json"
echo "$d" > "$CLONED"
G
cat > "$T/script" <<'S'
#!/usr/bin/env bash
cmd="$2"; log="$3"; printf '%s\n' "$cmd" > "$CMD_OUT"; pwd > "$PWD_OUT"; printf '%s' "$LAUNCH_BRIEF" > "$PWD_OUT.brief"
env | grep -E '^(BOT_|ANTHROPIC_API_KEY|FACTORY_PING)' | sort > "$ENV_OUT"
echo "Session: https://claude.ai/code/session_TESTabc123" > "$log"
S
chmod +x "$T/gh" "$T/script"; export PATH="$T:$PATH" CLONED="$T/cloned" CMD_OUT="$T/cmd" PWD_OUT="$T/pwd" ENV_OUT="$T/env" GH_CALLS="$T/ghcalls"
B="$HOME/.config/factory-bots"; mkdir -p "$B"
printf 'BOT_OWNER=gus\nBOT_WEBHOOK_URL="https://hook.example/gus-SECRETURL"\nBOT_WEBHOOK_KEY=gus-SECRETKEY\n' > "$B/gus.env"; chmod 600 "$B/gus.env"
# inherited env from another bot (the 2 Nov 11:09 incident) must be ignored
export BOT_OWNER=bob BOT_WEBHOOK_URL=https://hook.example/bob BOT_WEBHOOK_KEY=bobkey BOT_EXTRA=x ANTHROPIC_API_KEY=sk-x FACTORY_PING_URL=https://old
echo "do the thing" > "$T/brief"
pass=0 fail=0; ok() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }
out=$(bash "$L" o/r claude/x-1 "$T/brief" --temp-clone --log "$T/log" 2>"$T/err"); rc=$?
ok "prints session URL" '[ $rc = 0 ] && [ "$out" = https://claude.ai/code/session_TESTabc123 ]'
ok "launched from the clone of the seeded branch" '[ "$(cat "$T/pwd")" = "$(cat "$T/cloned")" ]'
ok "launch line pins opus 5.5 high + bypass + cloud" 'grep -q -- "--model claude-opus-5-5 --effort high --permission-mode bypassPermissions --cloud" "$T/cmd"'
ok "brief says work on current branch" 'grep -q LAUNCH_BRIEF "$T/cmd"'
ok "temp clone removed" '[ ! -e "$(cat "$T/cloned")" ]'
ok "launch folder marked trusted" 'grep -q hasTrustDialogAccepted "$HOME/.claude.json"'
out=$(bash "$L" o/r main "$T/brief" --temp-clone 2>"$T/err"); rc=$?; ok "refuses main" '[ $rc = 2 ]'
out=$(SEEDED=0 bash "$L" o/r claude/x-2 "$T/brief" --temp-clone --log "$T/log" 2>"$T/err"); rc=$?
ok "refuses unseeded branch" '[ $rc = 3 ] && grep -q "not seeded" "$T/err"'
ok "unseeded clone removed too" '[ ! -e "$(cat "$T/cloned")" ]'
: > "$T/empty"; out=$(bash "$L" o/r claude/x-3 "$T/empty" --temp-clone 2>/dev/null); rc=$?; ok "refuses empty brief" '[ $rc = 2 ]'
ok "pin read from fleet-defaults.json" 'grep -q -- "--model $(python3 -c "import json;print(json.load(open(\"$TFD\"))[\"model\"])") " "$T/cmd"'
ok "env: only gus's file loaded, inherited bob vars + API key dropped" '[ "$(cat "$T/env")" = "$(printf "BOT_OWNER=gus\nBOT_WEBHOOK_KEY=gus-SECRETKEY\nBOT_WEBHOOK_URL=https://hook.example/gus-SECRETURL")" ]'
M=$(python3 -c "import json;print(json.load(open('$TFD'))['model'])"); E=$(python3 -c "import json;print(json.load(open('$TFD'))['effort'])")
nosecret() { ! grep -q SECRET "$T/err" && ! grep -q SECRET <<<"$out"; }
out=$(bash "$L" o/r claude/x-1 "$T/brief" --temp-clone --log "$T/log" 2>"$T/err"); ok "no URL/key printed on success" 'nosecret'
out=$(REPO_OWNER=bob bash "$L" o/r claude/x-4 "$T/brief" --temp-clone --log "$T/log" 2>"$T/err"); rc=$?
ok "refuses: bot file missing for repo owner" '[ $rc = 5 ] && grep -q "bob.env is missing" "$T/err" && nosecret'
out=$(REPO_OWNER= bash "$L" o/r claude/x-5 "$T/brief" --temp-clone --log "$T/log" 2>"$T/err"); rc=$?
ok "refuses: repo has no bot-owner" '[ $rc = 5 ] && grep -q "no .claude/bot-owner" "$T/err"'
cp "$B/gus.env" "$T/gus.bak"; printf 'BOT_OWNER=bob\nBOT_WEBHOOK_URL=https://hook.example/SECRETURL\nBOT_WEBHOOK_KEY=SECRETKEY\n' > "$B/gus.env"
out=$(bash "$L" o/r claude/x-6 "$T/brief" --temp-clone --log "$T/log" 2>"$T/err"); rc=$?
ok "refuses: BOT_OWNER mismatch" '[ $rc = 5 ] && grep -q "belongs to .gus." "$T/err" && nosecret'
printf 'BOT_OWNER=gus\nBOT_WEBHOOK_URL=\nBOT_WEBHOOK_KEY=SECRETKEY\n' > "$B/gus.env"
out=$(bash "$L" o/r claude/x-7 "$T/brief" --temp-clone --log "$T/log" 2>"$T/err"); rc=$?
ok "refuses: empty webhook URL (inherited one not used)" '[ $rc = 5 ] && grep -q "BOT_WEBHOOK_URL is empty" "$T/err" && nosecret'
cp "$T/gus.bak" "$B/gus.env"; chmod 644 "$B/gus.env"
out=$(bash "$L" o/r claude/x-8 "$T/brief" --temp-clone --log "$T/log" 2>"$T/err"); rc=$?
ok "refuses: bot file not chmod 600" '[ $rc = 5 ] && grep -q "chmod 600" "$T/err"'; chmod 600 "$B/gus.env"
rm -f "$T/cloned"; out=$(bash "$L" o/r claude/x-9 "$T/brief" --temp-clone --model claude-opus-5 --log "$T/log" 2>"$T/err"); rc=$?
ok "refuses: --model differs from fleet-defaults (before cloning)" '[ $rc = 5 ] && grep -q "differs from fleet-defaults" "$T/err" && [ ! -f "$T/cloned" ]'
out=$(bash "$L" o/r claude/x-9 "$T/brief" --temp-clone --effort low --log "$T/log" 2>"$T/err"); rc=$?
ok "refuses: --effort differs" '[ $rc = 5 ] && grep -q "effort low differs" "$T/err"'
out=$(REPO_FD='{"model":"claude-opus-5","effort":"high","autoCompactWindow":400000}' bash "$L" o/r claude/x-10 "$T/brief" --temp-clone --log "$T/log" 2>"$T/err"); rc=$?
ok "refuses: branch's fleet-defaults differ from template" '[ $rc = 5 ] && grep -q "sync the repo first" "$T/err"'
# ---- --from-checkout (default mode): no clone, read-only checks on an existing checkout
C="$T/co"; mkdir -p "$C/.claude/hooks" "$C/scripts/claude-hooks"; git -C "$C" init -q -b main
git -C "$C" config user.email t@t; git -C "$C" config user.name t; git -C "$C" remote add origin git@github.com:o/r.git
echo '{"hooks":{"PermissionRequest":[{"hooks":[{"command":"bash scripts/claude-hooks/auto-approve.sh"}]}]}}' > "$C/.claude/settings.json"
echo x > "$C/.claude/hooks/check-model-effort.sh"; echo x > "$C/scripts/claude-hooks/bot-ping.sh"
cp "$TFD" "$C/.claude/fleet-defaults.json"; printf ' Gus\n' > "$C/.claude/bot-owner"
echo "ignored.log" > "$C/.gitignore"; git -C "$C" add -A; git -C "$C" commit -qm seed; echo noise > "$C/ignored.log"
snap() { (cd "$C" && git rev-parse HEAD && git symbolic-ref HEAD && git status --porcelain --ignored && find . -path ./.git -prune -o -type f -print0 | sort -z | xargs -0 shasum) > "$1"; }
snap "$T/before"; rm -f "$T/ghcalls" "$T/cmd"
out=$(bash "$L" o/r claude/co-1 "$T/brief" --from-checkout "$C" --log "$T/log" 2>"$T/err"); rc=$?
ok "from-checkout: clean main accepted, prints URL" '[ $rc = 0 ] && [ "$out" = https://claude.ai/code/session_TESTabc123 ]'
ok "from-checkout: gh repo clone never called" '[ ! -s "$T/ghcalls" ]'
ok "from-checkout: launched inside the checkout" '[ "$(cat "$T/pwd")" = "$(cd "$C" && pwd)" ]'
ok "from-checkout: pin + owner ' Gus\\n' normalized to gus" 'grep -q -- "--model $M --effort $E " "$T/cmd" && grep -q BOT_OWNER=gus "$T/env"'
ok "from-checkout: brief tells the session to create + push claude/co-1 from main" 'grep -q "Create your own working branch claude/co-1 from it" "$T/pwd.brief" && grep -q "never commit to or push main" "$T/pwd.brief"'
snap "$T/after"; ok "from-checkout: checkout untouched (HEAD, branch, status, file hashes)" 'cmp -s "$T/before" "$T/after"'
ok "from-checkout: no secrets printed" 'nosecret'
cof() { rm -f "$T/cmd"; out=$(bash "$L" o/r "${2:-claude/co-1}" "$T/brief" --from-checkout "$C" --log "$T/log" 2>"$T/err"); rc=$?; ok "$1" '[ $rc = 5 ] && [ ! -f "$T/cmd" ] && [ ! -s "$T/ghcalls" ] && '"$3"; }
echo dirt > "$C/new.txt"; cof "refuses untracked file" "" 'grep -q "uncommitted or untracked" "$T/err"'; rm "$C/new.txt"
echo y >> "$C/scripts/claude-hooks/bot-ping.sh"; cof "refuses uncommitted change" "" 'grep -q "uncommitted" "$T/err"'
git -C "$C" checkout -q -- scripts/claude-hooks/bot-ping.sh
git -C "$C" checkout -q -b claude/feat; cof "refuses checkout on a non-main branch" "" 'grep -q "is on claude/feat, not main" "$T/err"'
git -C "$C" checkout -q main; git -C "$C" branch -q -D claude/feat
git -C "$C" update-ref refs/remotes/origin/main HEAD; git -C "$C" commit -q --allow-empty -m local
cof "refuses main with local commits not on origin/main" "" 'grep -q "not on origin/main" "$T/err"'
git -C "$C" update-ref refs/remotes/origin/main HEAD; git -C "$C" reset -q --hard HEAD~1
rm -f "$T/cmd"; out=$(bash "$L" o/r claude/co-1 "$T/brief" --from-checkout "$C" --log "$T/log" 2>"$T/err"); rc=$?
ok "main behind origin/main: accepted with a warning" '[ $rc = 0 ] && grep -q "behind origin/main" "$T/err"'
git -C "$C" update-ref -d refs/remotes/origin/main
git -C "$C" rm -q .claude/hooks/check-model-effort.sh; git -C "$C" commit -qm drop
cof "refuses missing hooks" "" 'grep -q "missing: .claude/hooks/check-model-effort.sh" "$T/err"'
git -C "$C" revert --no-edit HEAD >/dev/null
git -C "$C" rm -q .claude/bot-owner; git -C "$C" commit -qm drop2
cof "refuses missing bot-owner" "" 'grep -q "missing: .claude/bot-owner" "$T/err"'
git -C "$C" revert --no-edit HEAD >/dev/null
printf 'two words\n' > "$C/.claude/bot-owner"; git -C "$C" commit -qam bad
cof "refuses bot-owner 'two words'" "" 'grep -q "one lowercase token" "$T/err"'
git -C "$C" revert --no-edit HEAD >/dev/null
git -C "$C" remote set-url origin git@github.com:o/other.git; cof "refuses checkout of another repo" "" 'grep -q "origin is not o/r" "$T/err"'
git -C "$C" remote set-url origin https://github.com/o/r.git
rm -f "$T/cmd"; out=$(bash "$L" o/r claude/co-1 "$T/brief" --from-checkout "$T/nope" 2>"$T/err"); rc=$?; ok "refuses missing checkout path" '[ $rc = 5 ] && grep -q "does not exist" "$T/err"'
out=$(bash "$L" o/r claude/co-1 "$T/brief" --from-checkout "$C" --seed 2>"$T/err"); rc=$?; ok "refuses --seed with --from-checkout" '[ $rc = 5 ] && [ ! -s "$T/ghcalls" ]'
git -C "$C" mv .claude/fleet-defaults.json fleet-defaults.json; git -C "$C" mv .claude/bot-owner bot-owner; git -C "$C" commit -qm move
rm -f "$T/cmd"; out=$(bash "$L" o/r claude/co-1 "$T/brief" --from-checkout "$C" --log "$T/log" 2>"$T/err"); rc=$?
ok "from-checkout: root fleet-defaults.json/bot-owner fallback" '[ $rc = 0 ] && grep -q BOT_OWNER=gus "$T/env"'
out=$(bash "$L" o/r claude/co-1 "$T/brief" 2>"$T/err"); rc=$?
ok "no mode: refused with usage pointing to --from-checkout" '[ $rc = 5 ] && grep -q -- "--from-checkout" "$T/err" && [ ! -s "$T/ghcalls" ]'
echo "pass=$pass fail=$fail"; [ $fail = 0 ]
