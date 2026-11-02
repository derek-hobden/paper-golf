#!/usr/bin/env bash
# Tests the shared lookup (scripts/fleet/fleet-defaults.sh): .claude/ first, repo-root fallback, bot-owner normalization,
# and that sync-defaults.sh, launch-local.sh and install-claude-dir.sh follow it.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; FD="$ROOT/scripts/fleet/fleet-defaults.sh"
TFD="$(bash "$ROOT/scripts/fleet/fleet-defaults.sh" --root "$ROOT" path)"  # shared resolver: .claude/ first, then root
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0 fail=0; ok() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }
R="$T/r"; mkdir -p "$R/.claude"
echo '{"model":"m-claude","effort":"e1","autoCompactWindow":1}' > "$R/.claude/fleet-defaults.json"
echo '{"model":"m-root","effort":"e2","autoCompactWindow":2}' > "$R/fleet-defaults.json"
ok "fleet-defaults: .claude/ wins over root" '[ "$(bash "$FD" --root "$R" model)" = m-claude ]'
rm "$R/.claude/fleet-defaults.json"; ok "fleet-defaults: root fallback" '[ "$(bash "$FD" --root "$R" model)" = m-root ]'
rm "$R/fleet-defaults.json"; bash "$FD" --root "$R" model 2>/dev/null; rc=$?; ok "fleet-defaults: none -> exit 3" '[ $rc = 3 ]'
own() { printf "$1" > "$R/.claude/bot-owner"; out=$(bash "$FD" --root "$R" owner 2>"$T/err"); rc=$?; }
own ' Gus\n'; ok "owner ' Gus\\\\n' -> gus" '[ $rc = 0 ] && [ "$out" = gus ]'
own 'DAN'; ok "owner DAN -> dan" '[ "$out" = dan ]'
own '\n\n  mel  \n\n'; ok "owner blank lines/spaces trimmed" '[ "$out" = mel ]'
own 'my-bot2\n'; ok "owner with digit/hyphen ok" '[ "$out" = my-bot2 ]'
own 'two words\n'; ok "owner 'two words' refused exit 5" '[ $rc = 5 ] && [ -z "$out" ]'
own 'gus\nbob\n'; ok "owner on two lines refused" '[ $rc = 5 ]'
own 'gus!'; ok "owner with ! refused" '[ $rc = 5 ]'
own 'gus_x'; ok "owner with underscore refused" '[ $rc = 5 ]'
own ''; ok "empty owner refused" '[ $rc = 5 ]'
own 'gus'; echo bob > "$R/bot-owner"; out=$(bash "$FD" --root "$R" owner); ok "bot-owner: .claude/ wins over root" '[ "$out" = gus ]'
rm "$R/.claude/bot-owner"; out=$(bash "$FD" --root "$R" owner); ok "bot-owner: root fallback" '[ "$out" = bob ]'
rm "$R/bot-owner"; bash "$FD" --root "$R" owner 2>/dev/null; rc=$?; ok "no bot-owner: exit 5" '[ $rc = 5 ]'
# sync-defaults follows the same order
S="$ROOT/scripts/fleet/sync-defaults.sh"; cp "$ROOT/.claude/settings.json" "$R/.claude/"; cp "$TFD" "$R/fleet-defaults.json"
echo '{"model":"claude-x","effort":"low","autoCompactWindow":5}' > "$R/.claude/fleet-defaults.json"
bash "$S" --repo "$R" >/dev/null; ok "sync uses .claude/fleet-defaults.json over root" 'grep -q "\"model\": \"claude-x\"" "$R/.claude/settings.json"'
# launch-local: root fallback for both files
H="$T/home"; mkdir -p "$H/.config/factory-bots" "$T/bin"
printf 'BOT_OWNER=cat\nBOT_WEBHOOK_URL=https://h.example/x\nBOT_WEBHOOK_KEY=k\n' > "$H/.config/factory-bots/cat.env"; chmod 600 "$H/.config/factory-bots/cat.env"
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$*" > "$ARGS_OUT"; echo "$BOT_OWNER" >> "$ARGS_OUT"\n' > "$T/bin/claude"; chmod +x "$T/bin/claude"
L2="$T/l"; mkdir -p "$L2"; cp "$TFD" "$L2/fleet-defaults.json"; printf ' CAT \n' > "$L2/bot-owner"
M=$(bash "$FD" --file "$TFD" model)
out=$(HOME="$H" PATH="$T/bin:$PATH" ARGS_OUT="$T/args" bash "$ROOT/bootstrap/launch-local.sh" --repo "$L2" 2>"$T/err"); rc=$?
ok "launch-local: root fleet-defaults + bot-owner fallback, owner normalized" '[ $rc = 0 ] && grep -q -- "--model $M" "$T/args" && grep -qx cat "$T/args"'
printf 'two words' > "$L2/bot-owner"; rm -f "$T/args"
out=$(HOME="$H" PATH="$T/bin:$PATH" ARGS_OUT="$T/args" bash "$ROOT/bootstrap/launch-local.sh" --repo "$L2" 2>"$T/err"); rc=$?
ok "launch-local: 'two words' owner refused exit 5" '[ $rc = 5 ] && [ ! -f "$T/args" ] && grep -q "one lowercase token" "$T/err"'
# install-claude-dir: same lookup + validation
ST="$T/stage"; mkdir -p "$ST/dot-claude/hooks"; echo x > "$ST/dot-claude/hooks/check-model-effort.sh"
echo '{"hooks":"check-model-effort.sh"}' > "$ST/dot-claude/settings.json"; cp "$TFD" "$ST/dot-claude/"
printf 'two words\n' > "$ST/dot-claude/bot-owner"; D="$T/dest"; mkdir -p "$D"
sh "$ROOT/bootstrap/install-claude-dir.sh" "$D" "$ST" >/dev/null 2>"$T/err"; rc=$?
ok "install: bad staged bot-owner refused exit 5, nothing installed" '[ $rc = 5 ] && [ ! -d "$D/.claude" ]'
printf ' Flo\n' > "$ST/dot-claude/bot-owner"; sh "$ROOT/bootstrap/install-claude-dir.sh" "$D" "$ST" >/dev/null 2>"$T/err"; rc=$?
ok "install: ok owner + fleet-defaults, no warnings" '[ $rc = 0 ] && [ -f "$D/.claude/fleet-defaults.json" ] && [ -f "$D/.claude/bot-owner" ] && ! grep -q warning "$T/err"'
rm "$ST/dot-claude/bot-owner" "$ST/dot-claude/fleet-defaults.json"; D2="$T/d2"; mkdir -p "$D2"; printf 'rob\n' > "$D2/bot-owner"; cp "$TFD" "$D2/"
sh "$ROOT/bootstrap/install-claude-dir.sh" "$D2" "$ST" >/dev/null 2>"$T/err"; rc=$?
ok "install: repo-root fallback accepted (no warnings)" '[ $rc = 0 ] && ! grep -q warning "$T/err"'
echo "pass=$pass fail=$fail"; [ $fail = 0 ]
