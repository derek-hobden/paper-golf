#!/usr/bin/env bash
# Portable time limit: macOS has no `timeout`; try gtimeout, else run with no limit. With neither, python3 and
# bot-ping.sh must return on their own (stdin is already capped by `read -t 2`, bot-ping caps its own curl), and
# the hook's own timeout in .claude/settings.json (15 s) is the backstop: the session is never held past it.
tlim() { t="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$t" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$t" "$@"
  else "$@"; fi; }
# SessionStart guard (Flo, 1 Nov 2026 22:44 Dubai). Derek: "I want all Claude code sessions from now on to be
# opus 5.5 high ... reliably 100% of the time"; 22:59: "opus 5.5 low for everything please". CI jobs stay on Sonnet 5.5 and don't load this hook's settings model.
# Reads the SessionStart hook JSON on stdin (field `model`, optional per
# https://code.claude.com/docs/en/hooks#sessionstart-input) and the effective effort:
#   $CLAUDE_EFFORT, else $CLAUDE_CODE_EFFORT_LEVEL (set in .claude/settings.json `env`, outranks --effort/settings),
#   else modelSettings[model].effortLevel / effortLevel from .claude/settings.local.json then .claude/settings.json.
# On drift (model not Opus 5.5, or effort not low) it pings the owning bot through
# scripts/claude-hooks/bot-ping.sh with event `model_drift`, warns on stderr and in additionalContext.
# Never blocks or crashes the session: always exit 0. Expected values can be overridden for tests only.
want_model="${EXPECT_MODEL:-claude-opus-5-5}"; want_effort="${EXPECT_EFFORT:-low}"
input=""; [ -t 0 ] || IFS= read -r -d '' -t 2 input || true  # no `timeout` needed (macOS)
root="${CLAUDE_PROJECT_DIR:-$PWD}"
result="$(HOOK_INPUT="$input" ROOT="$root" WANT_MODEL="$want_model" WANT_EFFORT="$want_effort" tlim 3 python3 - <<'PY' 2>/dev/null
import json,os,re
try: h=json.loads(os.environ.get("HOOK_INPUT") or "{}")
except Exception: h={}
want_m=os.environ["WANT_MODEL"]; want_e=os.environ["WANT_EFFORT"]
model=h.get("model") or os.environ.get("ANTHROPIC_MODEL") or ""
def settings():
    for f in ("settings.local.json","settings.json"):
        try: yield json.load(open(os.path.join(os.environ["ROOT"],".claude",f)))
        except Exception: pass
cfg=list(settings())
if not model:
    model=next((c.get("model") for c in cfg if c.get("model")),"")
effort=os.environ.get("CLAUDE_EFFORT") or os.environ.get("CLAUDE_CODE_EFFORT_LEVEL") or ""
src="env" if effort else ""
if not effort:
    base=re.sub(r"(\[1m\]|-\d{8})$","",model)
    for c in cfg:
        e=((c.get("modelSettings") or {}).get(base) or {}).get("effortLevel") or c.get("effortLevel")
        if e: effort,src=e,"settings"; break
base=re.sub(r"(\[1m\]|-\d{8})$","",model)
problems=[]
if base!=want_m: problems.append(f"model is {model or 'unknown'} (want {want_m})")
if effort!=want_e: problems.append(f"effort is {effort or 'unknown'} (want {want_e})")
print(json.dumps({"ok":not problems,"model":model,"effort_level":effort,"effort_source":src,
  "message":"MODEL DRIFT: "+"; ".join(problems)+". Derek requires Opus 5.5 at low effort for every Claude Code session." if problems else ""}))
PY
)"
[ -n "$result" ] || exit 0
ok="$(printf '%s' "$result" | python3 -c 'import json,sys;print(json.load(sys.stdin)["ok"])' 2>/dev/null)"
[ "$ok" = "False" ] || exit 0
msg="$(printf '%s' "$result" | python3 -c 'import json,sys;print(json.load(sys.stdin)["message"])' 2>/dev/null)"
echo "!!!!!!!!!! $msg !!!!!!!!!!" >&2
ping="$root/scripts/claude-hooks/bot-ping.sh"
[ -f "$ping" ] && printf '%s' "$result" | tlim 8 bash "$ping" model_drift >/dev/null 2>&1 || true
MSG="$msg" python3 -c 'import json,os;print(json.dumps({"systemMessage":os.environ["MSG"],"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":os.environ["MSG"]+" Tell the user and stop: relaunch with --model claude-opus-5-5 --effort low."}}))' 2>/dev/null || true
exit 0
