#!/usr/bin/env bash
# PermissionRequest auto-approver: the ONE place that answers permission prompts (pings live in bot-ping.sh).
# Why: Derek, 1 Nov 2026 11:44am Dubai: "yes, use bypassPermissions on every session", and sessions must never
# stop on a permission prompt. claude.ai cloud sessions ignore bypassPermissions, so this hook is the cloud substitute.
# Rules:
#   - On by default. FACTORY_AUTO_APPROVE=0 (or legacy BOT_AUTO_APPROVE=0) turns it off: prints nothing, prompt shows as usual.
#   - Deny-respecting: never approves a request matching any permissions.deny rule in .claude/settings.json or
#     .claude/settings.local.json, and never approves rm on / ~ $HOME or critical system paths. For those it prints
#     nothing (the normal prompt / deny flow continues and bot-ping reports it as waiting).
#   - Echoes the prompt's session-scoped suggestions so the same prompt isn't asked again.
# Usage: auto-approve.sh            (hook mode: hook JSON on stdin, decision JSON on stdout)
#        auto-approve.sh --check    (exit 0 if it would approve the JSON in $HOOK_INPUT, 1 if not; prints nothing)
# Never hangs: stdin read is capped with `read -t`, no `timeout` binary needed (macOS). Always exit 0 in hook mode.
enabled() { local v="${FACTORY_AUTO_APPROVE:-${BOT_AUTO_APPROVE:-1}}"; [ "$v" != "0" ] && [ "$v" != "false" ]; }
mode="${1:-hook}"
if [ "$mode" = "--check" ]; then input="${HOOK_INPUT:-}"
else input=""; [ -t 0 ] || IFS= read -r -d '' -t 2 input || true; fi
if ! enabled; then [ "$mode" = "--check" ] && exit 1; exit 0; fi
root="${CLAUDE_PROJECT_DIR:-$PWD}"
out="$(HOOK_INPUT="$input" ROOT="$root" python3 - <<'PY' 2>/dev/null
import json,os,re,fnmatch
try: h=json.loads(os.environ.get("HOOK_INPUT") or "{}")
except Exception: h={}
if not isinstance(h,dict): h={}
tool=str(h.get("tool_name") or ""); ti=h.get("tool_input") or {}
if not isinstance(ti,dict): ti={}
deny=[]
for f in ("settings.json","settings.local.json"):
    try: deny+=json.load(open(os.path.join(os.environ["ROOT"],".claude",f))).get("permissions",{}).get("deny",[]) or []
    except Exception: pass
home=os.path.expanduser("~")
def cmd_rx(p):  # Bash rule: * = anything; legacy "x:*" = prefix
    p=re.sub(r":\*$","*",p)
    return re.compile("^"+".*".join(re.escape(s) for s in p.split("*"))+"$",re.S)
def path_rx(p):
    if p.startswith("~/"): p=home+p[1:]
    elif p.startswith("//"): p=p[1:]
    rx="";i=0
    while i<len(p):
        if p.startswith("**/",i): rx+="(?:.*/)?"; i+=3
        elif p.startswith("**",i): rx+=".*"; i+=2
        elif p[i]=="*": rx+="[^/]*"; i+=1
        else: rx+=re.escape(p[i]); i+=1
    if not p.startswith("/"): rx="(?:.*/)?"+rx
    return re.compile("^"+rx+"$")
cmd=str(ti.get("command") or "")
segs=[cmd]+[s.strip() for s in re.split(r"&&|\|\||[;|\n]",cmd) if s.strip()]
path=str(ti.get("file_path") or ti.get("notebook_path") or ti.get("path") or "")
def denied():
    for r in deny:
        m=re.fullmatch(r"([^()]+?)(?:\((.*)\))?",str(r),re.S)
        if not m: continue
        rt,spec=m.group(1),m.group(2)
        if not fnmatch.fnmatchcase(tool,rt): continue
        if spec is None: return True
        if tool=="Bash":
            if any(cmd_rx(spec).match(s) for s in segs): return True
        elif path:
            ap=os.path.abspath(os.path.expanduser(path))
            if path_rx(spec).match(ap) or path_rx(spec).match(path): return True
    return False
CRIT=r"(/|/\*|~|~/|~/\*|\$HOME|\$\{HOME\}|\$HOME/\*|/(bin|boot|dev|etc|lib|lib64|opt|private|proc|root|sbin|sys|System|Library|Applications|Users|home|usr|var)(/\*?)?|\.git|\.git/.*|\.|\./|\*)"
def rm_critical():
    if tool!="Bash": return False
    for s in segs[1:] or [cmd]:
        w=s.split()
        while w and (re.match(r"[A-Za-z_]\w*=",w[0]) or w[0] in ("sudo","command","exec","env","nohup","xargs")): w=w[1:]
        if not w or os.path.basename(w[0])!="rm": continue
        for a in w[1:]:
            a=a.strip("'\"")
            if a=="--no-preserve-root": return True
            if not a.startswith("-") and re.fullmatch(CRIT,a.rstrip("/") or "/"): return True
    return False
if denied() or rm_critical(): raise SystemExit(0)
s=[x for x in (h.get("permission_suggestions") or []) if isinstance(x,dict) and x.get("destination")=="session"]
d={"behavior":"allow"}
if s: d["updatedPermissions"]=s
print(json.dumps({"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":d}}))
PY
)"
if [ "$mode" = "--check" ]; then [ -n "$out" ]; exit $?; fi
[ -n "$out" ] && printf '%s' "$out"
exit 0
