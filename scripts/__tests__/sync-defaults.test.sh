#!/usr/bin/env bash
# Tests scripts/fleet/sync-defaults.sh (sync, --check pass, --check drift) on temp repos.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; S="$ROOT/scripts/fleet/sync-defaults.sh"
TFD="$(bash "$ROOT/scripts/fleet/fleet-defaults.sh" --root "$ROOT" path)"  # shared resolver: .claude/ first, then root
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0 fail=0; ok() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }
j() { python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(eval(sys.argv[2]))" "$@"; }
out=$(bash "$S" --check --repo "$ROOT"); rc=$?; ok "template settings.json in sync with template fleet-defaults.json" '[ $rc = 0 ]'
R="$T/r"; mkdir -p "$R/.claude"; cp "$ROOT/.claude/settings.json" "$R/.claude/"
cat > "$R/.claude/fleet-defaults.json" <<'J'
{"model":"claude-opus-9","effort":"medium","autoCompactWindow":300000}
J
out=$(bash "$S" --check --repo "$R" 2>&1); rc=$?
ok "check fails on drift (exit 1, lists keys)" '[ $rc = 1 ] && grep -q "model is" <<<"$out" && grep -q CLAUDE_CODE_AUTO_COMPACT_WINDOW <<<"$out"'
ok "check changed nothing" 'cmp -s "$R/.claude/settings.json" "$ROOT/.claude/settings.json"'
out=$(cd "$R" && bash "$S"); rc=$?; ok "sync exit 0" '[ $rc = 0 ] && grep -q updated <<<"$out"'
F="$R/.claude/settings.json"
ok "sync: model" '[ "$(j "$F" "d[\"model\"]")" = claude-opus-9 ]'
ok "sync: effortLevel + modelSettings" '[ "$(j "$F" "d[\"effortLevel\"]")" = medium ] && [ "$(j "$F" "d[\"modelSettings\"][\"claude-opus-9\"][\"effortLevel\"]")" = medium ] && [ "$(j "$F" "\"claude-opus-5-5\" in d[\"modelSettings\"]")" = False ]'
ok "sync: env effort + compact (string)" '[ "$(j "$F" "d[\"env\"][\"CLAUDE_CODE_EFFORT_LEVEL\"]")" = medium ] && [ "$(j "$F" "repr(d[\"env\"][\"CLAUDE_CODE_AUTO_COMPACT_WINDOW\"])")" = "'"'"'300000'"'"'" ]'
ok "sync: autoCompactWindow (number)" '[ "$(j "$F" "repr(d[\"autoCompactWindow\"])")" = 300000 ]'
ok "sync: other keys kept (permissions, hooks)" '[ "$(j "$F" "len(d[\"permissions\"][\"deny\"])")" = "$(j "$ROOT/.claude/settings.json" "len(d[\"permissions\"][\"deny\"])")" ] && grep -q check-model-effort.sh "$F"'
out=$(bash "$S" --check --repo "$R"); rc=$?; ok "check passes after sync" '[ $rc = 0 ]'
cp "$F" "$T/after"; out=$(bash "$S" --repo "$R"); ok "sync is idempotent" 'cmp -s "$F" "$T/after" && grep -q "already in sync" <<<"$out"'
python3 - "$F" <<'P'
import json,sys; d=json.load(open(sys.argv[1])); d["env"]["CLAUDE_CODE_EFFORT_LEVEL"]="high"; json.dump(d,open(sys.argv[1],"w"),indent=2)
P
out=$(bash "$S" --check --repo "$R"); rc=$?; ok "check catches one hand-edited key" '[ $rc = 1 ] && grep -q "env.CLAUDE_CODE_EFFORT_LEVEL" <<<"$out"'
R2="$T/r2"; mkdir -p "$R2/.claude"; cp "$ROOT/.claude/settings.json" "$R2/.claude/"; cp "$TFD" "$R2/"
out=$(bash "$S" --check --repo "$R2"); rc=$?; ok "falls back to <repo>/fleet-defaults.json" '[ $rc = 0 ]'
R3="$T/r3"; mkdir -p "$R3/.claude"; cp "$ROOT/.claude/settings.json" "$R3/.claude/"
out=$(bash "$S" --check --repo "$R3" 2>&1); rc=$?; ok "missing fleet-defaults: exit 3" '[ $rc = 3 ]'
NT="$T/nt"; mkdir -p "$NT"; for d in ${PATH//:/ }; do [ -d "$d" ] || continue; for f in "$d"/*; do b=${f##*/}; case $b in timeout|gtimeout|jq) continue;; esac; [ -e "$NT/$b" ] || ln -s "$f" "$NT/$b" 2>/dev/null; done; done
out=$(PATH="$NT" bash "$S" --check --repo "$ROOT"); rc=$?; ok "works without jq/timeout (mac)" '[ $rc = 0 ]'
echo "pass=$pass fail=$fail"; [ $fail = 0 ]
