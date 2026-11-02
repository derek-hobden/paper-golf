#!/usr/bin/env bash
# Proves every fleet script works in a repo that has ONLY .claude/fleet-defaults.json (no repo-root fleet-defaults.json):
# launch-cloud --from-checkout, launch-local, sync-defaults --check, check-model-effort. claude/gh/script are stubbed.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; export HOME="$T/home"; mkdir -p "$HOME"
pass=0 fail=0; ok() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }
ok "template itself has no root fleet-defaults.json, only .claude/" '[ ! -e "$ROOT/fleet-defaults.json" ] && [ ! -L "$ROOT/fleet-defaults.json" ] && [ -f "$ROOT/.claude/fleet-defaults.json" ]'
# Copy the template (scripts, hooks, settings) into a temp git repo on main, root file absent.
R="$T/repo"; mkdir -p "$R"; (cd "$ROOT" && tar cf - .claude scripts bootstrap) | (cd "$R" && tar xf -)
rm -f "$R/fleet-defaults.json"; printf 'gus\n' > "$R/.claude/bot-owner"
git -C "$R" init -q -b main; git -C "$R" config user.email t@t; git -C "$R" config user.name t
git -C "$R" remote add origin https://github.com/o/r.git; git -C "$R" add -A; git -C "$R" commit -qm init
ok "temp repo: only .claude/fleet-defaults.json" '[ -f "$R/.claude/fleet-defaults.json" ] && [ ! -e "$R/fleet-defaults.json" ]'
M=$(bash "$R/scripts/fleet/fleet-defaults.sh" --root "$R" model); E=$(bash "$R/scripts/fleet/fleet-defaults.sh" --root "$R" effort)
B="$HOME/.config/factory-bots"; mkdir -p "$B"
printf 'BOT_OWNER=gus\nBOT_WEBHOOK_URL="https://hook.example/gus-SECRETURL"\nBOT_WEBHOOK_KEY=gus-SECRETKEY\n' > "$B/gus.env"; chmod 600 "$B/gus.env"
cat > "$T/script" <<'S'
#!/usr/bin/env bash
printf '%s\n' "$2" > "$CMD_OUT"; pwd > "$CMD_OUT.pwd"; echo "Session: https://claude.ai/code/session_TESTabc123" > "$3"
S
printf '#!/usr/bin/env bash\necho "$*" >> "$GH_CALLS"; exit 1\n' > "$T/gh"
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$@" > "$CMD_OUT.local"\n' > "$T/claude"
chmod +x "$T/script" "$T/gh" "$T/claude"; export PATH="$T:$PATH" CMD_OUT="$T/cmd" GH_CALLS="$T/ghcalls"
echo "do it" > "$T/brief"
# Run the copies inside the temp repo too, so the template-side lookup also sees only .claude/.
L="$R/bootstrap/launch-cloud.sh"
out=$(bash "$L" o/r claude/only-1 "$T/brief" --from-checkout "$R" --log "$T/log" 2>"$T/err"); rc=$?
ok "launch-cloud --from-checkout (clean main) accepted" '[ $rc = 0 ] && [ "$out" = https://claude.ai/code/session_TESTabc123 ] && [ ! -s "$T/ghcalls" ]'
ok "launch-cloud pinned from .claude/fleet-defaults.json" 'grep -q -- "--model $M --effort $E " "$T/cmd"'
ok "launch-cloud left checkout on main, clean" '[ "$(git -C "$R" symbolic-ref --short HEAD)" = main ] && [ -z "$(git -C "$R" status --porcelain)" ] && [ "$(git -C "$R" branch --list | wc -l | tr -d " ")" = 1 ]'
out=$(bash "$ROOT/bootstrap/launch-cloud.sh" o/r claude/only-2 "$T/brief" --from-checkout "$R" --log "$T/log" 2>"$T/err"); rc=$?
ok "launch-cloud from the template itself (template has only .claude/) accepted" '[ $rc = 0 ]'
git -C "$R" checkout -q -b claude/side
out=$(bash "$L" o/r claude/only-3 "$T/brief" --from-checkout "$R" --log "$T/log" 2>"$T/err"); rc=$?
ok "launch-cloud: checkout on non-main branch -> exit 5" '[ $rc = 5 ] && grep -q "not main" "$T/err"'
git -C "$R" checkout -q main
echo dirt >> "$R/.claude/bot-owner"
out=$(bash "$L" o/r claude/only-4 "$T/brief" --from-checkout "$R" --log "$T/log" 2>"$T/err"); rc=$?
ok "launch-cloud: dirty checkout -> exit 5" '[ $rc = 5 ] && grep -q "uncommitted" "$T/err"'
git -C "$R" checkout -q -- .claude/bot-owner
out=$(cd "$R" && bash bootstrap/launch-local.sh -- -p hi 2>"$T/err"); rc=$?
ok "launch-local pinned from .claude/fleet-defaults.json" '[ $rc = 0 ] && grep -qx -- "$M" "$T/cmd.local" && grep -qx -- "$E" "$T/cmd.local"'
out=$(bash "$R/scripts/fleet/sync-defaults.sh" --check --repo "$R" 2>&1); rc=$?
ok "sync-defaults --check passes" '[ $rc = 0 ] && grep -q "$R/.claude/fleet-defaults.json\|matches fleet defaults" <<<"$out"'
out=$(printf '{"model":"%s"}' "$M" | CLAUDE_PROJECT_DIR="$R" bash "$R/.claude/hooks/check-model-effort.sh" 2>"$T/err"); rc=$?
ok "check-model-effort quiet on the pin (no missing-file fallback)" '[ $rc = 0 ] && [ ! -s "$T/err" ]'
out=$(printf '{"model":"claude-wrong"}' | CLAUDE_PROJECT_DIR="$R" BOT_WEBHOOK_URL= bash "$R/.claude/hooks/check-model-effort.sh" 2>"$T/err"); rc=$?
ok "check-model-effort flags drift against .claude pin" '[ $rc = 0 ] && grep -q "want $M" "$T/err" && ! grep -q "missing or unreadable" "$T/err"'
ok "no secrets printed" '! grep -rq SECRET "$T/err" && ! grep -q SECRET <<<"$out"'
echo "pass=$pass fail=$fail"; [ $fail = 0 ]
