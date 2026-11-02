#!/usr/bin/env bash
# Tests bootstrap/launch-local.sh with a stub `claude` on PATH and fake bot files in a temp HOME (no real secrets).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; L="$ROOT/bootstrap/launch-local.sh"
TFD="$(bash "$ROOT/scripts/fleet/fleet-defaults.sh" --root "$ROOT" path)"  # shared resolver: .claude/ first, then root
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; export HOME="$T/home"; B="$HOME/.config/factory-bots"; mkdir -p "$B" "$T/bin"
cat > "$T/bin/claude" <<'C'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$ARGS_OUT"; pwd > "$PWD_OUT"
env | grep -E '^(BOT_|ANTHROPIC_API_KEY|FACTORY_PING)' | sort > "$ENV_OUT"
C
chmod +x "$T/bin/claude"; export PATH="$T/bin:$PATH" ARGS_OUT="$T/args" PWD_OUT="$T/pwd" ENV_OUT="$T/env"
R="$T/repo"; mkdir -p "$R/.claude"; echo bob > "$R/.claude/bot-owner"; cp "$TFD" "$R/.claude/fleet-defaults.json"
printf 'BOT_OWNER=bob\nBOT_WEBHOOK_URL=https://hook.example/bob-SECRETURL\nBOT_WEBHOOK_KEY="bob-SECRETKEY"\n' > "$B/bob.env"; chmod 600 "$B/bob.env"
printf 'BOT_OWNER=gus\nBOT_WEBHOOK_URL=https://hook.example/gus-SECRETURL\nBOT_WEBHOOK_KEY=gus-SECRETKEY\n' > "$B/gus.env"; chmod 600 "$B/gus.env"
# inherited from Gus's shell: must never reach Bob's session
export BOT_OWNER=gus BOT_WEBHOOK_URL=https://hook.example/gus-SECRETURL BOT_WEBHOOK_KEY=gus-SECRETKEY BOT_OTHER=1 ANTHROPIC_API_KEY=sk-x FACTORY_PING_KEY=old
M=$(python3 -c "import json;print(json.load(open('$TFD'))['model'])"); E=$(python3 -c "import json;print(json.load(open('$TFD'))['effort'])")
pass=0 fail=0; ok() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }
nosecret() { ! grep -q SECRET "$T/err" && ! grep -q SECRET <<<"$out"; }
run() { rm -f "$T/args" "$T/env"; out=$(bash "$L" "$@" 2>"$T/err"); rc=$?; }
run --repo "$R" -- -p hi
ok "happy path: exit 0, claude ran in repo" '[ $rc = 0 ] && [ "$(cat "$T/pwd")" = "$(cd "$R" && pwd)" ]'
ok "happy path: pin from fleet-defaults + extra args" '[ "$(cat "$T/args")" = "--model $M --effort $E --permission-mode bypassPermissions -p hi" ]'
ok "inherited env ignored: only bob's file, no API key" '[ "$(cat "$T/env")" = "$(printf "BOT_OWNER=bob\nBOT_WEBHOOK_KEY=bob-SECRETKEY\nBOT_WEBHOOK_URL=https://hook.example/bob-SECRETURL")" ]'
ok "happy path: no URL/key printed" 'nosecret'
run --repo "$R" --model "$M" --effort "$E"; ok "matching --model/--effort accepted" '[ $rc = 0 ]'
run --repo "$R" --model claude-opus-5; ok "refuses wrong model pin" '[ $rc = 5 ] && [ ! -f "$T/args" ] && grep -q "differs from fleet-defaults" "$T/err"'
run --repo "$R" --effort medium; ok "refuses wrong effort pin" '[ $rc = 5 ] && [ ! -f "$T/args" ]'
mv "$B/bob.env" "$T/bob.bak"; run --repo "$R"
ok "refuses missing bot file (even with inherited vars set)" '[ $rc = 5 ] && [ ! -f "$T/args" ] && grep -q "bob.env is missing" "$T/err" && nosecret'
cp "$B/gus.env" "$B/bob.env"; run --repo "$R"
ok "refuses wrong BOT_OWNER in file" '[ $rc = 5 ] && [ ! -f "$T/args" ] && grep -q "belongs to .bob." "$T/err" && nosecret'
printf 'BOT_OWNER=bob\nBOT_WEBHOOK_URL=\nBOT_WEBHOOK_KEY=SECRETKEY\n' > "$B/bob.env"; run --repo "$R"
ok "refuses empty webhook URL" '[ $rc = 5 ] && [ ! -f "$T/args" ] && grep -q "URL is empty" "$T/err" && nosecret'
printf 'BOT_OWNER=bob\nBOT_WEBHOOK_URL=http://SECRETURL\nBOT_WEBHOOK_KEY=SECRETKEY\n' > "$B/bob.env"; run --repo "$R"
ok "refuses non-https URL without printing it" '[ $rc = 5 ] && nosecret'
mv "$T/bob.bak" "$B/bob.env"; chmod 640 "$B/bob.env"; run --repo "$R"
ok "refuses group-readable bot file" '[ $rc = 5 ] && grep -q "chmod 600" "$T/err"'; chmod 600 "$B/bob.env"
echo gus > "$R/.claude/bot-owner"; run --repo "$R"
ok "owner mapping decides which file loads (gus repo -> gus.env)" '[ $rc = 0 ] && grep -q BOT_OWNER=gus "$T/env"'
rm "$R/.claude/bot-owner"; run --repo "$R"; ok "refuses repo without bot-owner" '[ $rc = 5 ] && [ ! -f "$T/args" ]'
echo bob > "$R/.claude/bot-owner"; FACTORY_BOTS_DIR="$T/none" run --repo "$R"
ok "FACTORY_BOTS_DIR override respected" '[ $rc = 5 ] && grep -q "$T/none/bob.env" "$T/err"'
# Mac: bash 3.2 has no `timeout`; launcher must not need it
NT="$T/nt"; mkdir -p "$NT"; for d in ${PATH//:/ }; do [ -d "$d" ] || continue; for f in "$d"/*; do b=${f##*/}; case $b in timeout|gtimeout) continue;; esac; [ -e "$NT/$b" ] || ln -s "$f" "$NT/$b" 2>/dev/null; done; done
rm -f "$T/args"; out=$(PATH="$NT" bash "$L" --repo "$R" 2>"$T/err"); rc=$?; ok "works without timeout binary" '[ $rc = 0 ] && [ -f "$T/args" ]'
echo "pass=$pass fail=$fail"; [ $fail = 0 ]
