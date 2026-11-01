#!/usr/bin/env bash
# PermissionRequest auto-approver: the ONE place that answers permission prompts (pings live in bot-ping.sh).
# Why: Derek, 1 Nov 2026 11:44am Dubai: "yes, use bypassPermissions on every session", and sessions must never
# stop on a permission prompt. claude.ai cloud sessions ignore bypassPermissions, so this hook is the cloud substitute.
# Rules (refusing = print nothing, so the normal prompt shows and bot-ping reports an alert with the reason):
#   - On by default. FACTORY_AUTO_APPROVE=0 (or legacy BOT_AUTO_APPROVE=0) turns it off.            reason: disabled
#   - FAIL CLOSED: no permissions.deny in .claude/settings.json / settings.local.json, or it is empty,
#     means approve nothing.                                                                      reason: deny_list_missing
#   - Never approves anything matching that deny list.                                            reason: deny_list_match
#   - Built-in deny set, ALWAYS applied (even with a full deny list), see BUILTIN below:          reason: builtin_deny
#     force/delete pushes, history rewrites, repo/release/secret deletes, GitHub DELETE calls, secret file reads,
#     env dumps, rm of critical paths. Checked on every chained part (&& || ; | newline), $(...)/`...`, and sh/bash -c strings.
#   - Any internal error (python3 missing, bad input) also approves nothing.                     reason: error
#   - Echoes the prompt's session-scoped suggestions so the same prompt isn't asked again.
# Usage: auto-approve.sh          hook mode: hook JSON on stdin, decision JSON on stdout (or nothing). Always exit 0.
#        auto-approve.sh --check  reads $HOOK_INPUT; exit 0 if it would approve, else exit 1 and print the reason.
# Never hangs: stdin read is capped with `read -t`, no `timeout` binary needed (macOS).
enabled() { local v="${FACTORY_AUTO_APPROVE:-${BOT_AUTO_APPROVE:-1}}"; [ "$v" != "0" ] && [ "$v" != "false" ]; }
mode="${1:-hook}"
if [ "$mode" = "--check" ]; then input="${HOOK_INPUT:-}"
else input=""; [ -t 0 ] || IFS= read -r -d '' -t 2 input || true; fi
if ! enabled; then [ "$mode" = "--check" ] && { echo disabled; exit 1; }; exit 0; fi
root="${CLAUDE_PROJECT_DIR:-$PWD}"
out="$(HOOK_INPUT="$input" ROOT="$root" python3 - <<'PY' 2>/dev/null
import json,os,re,fnmatch,shlex
def refuse(r): print("REFUSE:"+r); raise SystemExit(0)
try: h=json.loads(os.environ.get("HOOK_INPUT") or "{}")
except Exception: h={}
if not isinstance(h,dict): h={}
tool=str(h.get("tool_name") or ""); ti=h.get("tool_input") or {}
if not isinstance(ti,dict): ti={}
deny=[]
for f in ("settings.json","settings.local.json"):
    try:
        d=(json.load(open(os.path.join(os.environ["ROOT"],".claude",f))).get("permissions") or {}).get("deny") or []
        if isinstance(d,list): deny+=[x for x in d if isinstance(x,str) and x.strip()]
    except Exception: pass
if not deny: refuse("deny_list_missing")
home=os.path.expanduser("~")
cmd=str(ti.get("command") or "")
path=str(ti.get("file_path") or ti.get("notebook_path") or ti.get("path") or "")

def parts(c,depth=0):
    """Every piece of a command line that could run on its own."""
    out=[c]
    if depth>4: return out
    for m in re.finditer(r"\$\(([^()]*(?:\([^()]*\)[^()]*)*)\)|`([^`]*)`",c):
        out+=parts(m.group(1) or m.group(2) or "",depth+1)
    for s in re.split(r"&&|\|\||[;|&\n]|\$\(|\)|`",c):
        s=s.strip()
        if not s: continue
        out.append(s)
        try: w=shlex.split(s)
        except ValueError: w=s.split()
        for j,a in enumerate(w[:-1]):
            if os.path.basename(a) in ("sh","bash","zsh","dash") and re.fullmatch(r"-[a-z]*c[a-z]*",w[j+1]) and j+2<len(w):
                out+=parts(w[j+2],depth+1)
            if re.fullmatch(r"-[a-z]*c[a-z]*",a) and j>0 and os.path.basename(w[j-1]) in ("sh","bash","zsh","dash"): pass
        if w and w[0]=="eval": out+=parts(" ".join(w[1:]),depth+1)
    return out
segs=parts(cmd) if tool=="Bash" else []
def words(s):
    try: w=shlex.split(s)
    except ValueError: w=s.split()
    while w and (re.match(r"[A-Za-z_]\w*=",w[0]) or os.path.basename(w[0]) in ("sudo","command","exec","nohup","xargs","time","env") ):
        w=w[1:]
        while w and w[0].startswith("-") and len(w)>1: w=w[1:]
    return w

# ---- settings deny list ----
def cmd_rx(p):
    p=re.sub(r"(?<=\S):\*$","*",p)  # legacy prefix form "npm run:*"; "git push * :*" keeps its literal colon
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
def settings_denied():
    for r in deny:
        m=re.fullmatch(r"([^()]+?)(?:\((.*)\))?",r,re.S)
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

# ---- BUILTIN deny set ----
SECRET_FILE=re.compile(r"(^|/)(\.env(\.[\w.-]+)?|[^/]*\.pem|[^/]*\.key|id_rsa[^/]*|id_ed25519[^/]*|id_ecdsa[^/]*|\.claude\.json|\.netrc|\.git-credentials|credentials(\.json)?|[^/]*credentials[^/]*\.json|\.npmrc|\.pypirc)$|(^|/)\.ssh(/|$)|(^|/)\.aws(/|$)|(^|/)\.config/gh(/|$)|^~/?\.ssh|^~/?\.aws|^/proc/[^/]+/environ$")
def secret_path(a):
    a=a.strip("'\"")
    if a.startswith("$HOME") or a.startswith("${HOME}"): a=home+a.split("}",1)[-1] if a.startswith("${") else home+a[5:]
    a=os.path.expanduser(a)
    return bool(SECRET_FILE.search(a)) and not re.search(r"\.env\.(example|sample|template)$",a)
CRIT=r"(/|/\*|~|~/\*|\$HOME|\$\{HOME\}|\$HOME/\*|/(bin|boot|dev|etc|lib|lib64|opt|private|proc|root|sbin|sys|System|Library|Applications|Users|home|usr|var)(/\*)?|\.git|\.git/.*|\.|\./|\*)"
SECRET_VAR=r"\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PAT|AUTH)\w*"
def builtin(s):
    try: raw=shlex.split(s)
    except ValueError: raw=s.split()
    if raw and os.path.basename(raw[0])=="env" and not [x for x in raw[1:] if not x.startswith("-") and "=" not in x]: return True  # bare env dump
    w=words(s)
    if not w: return False
    b=os.path.basename(w[0]); a=w[1:]
    if b=="git":
        i=0
        while i<len(a) and a[i].startswith("-"): i+= 2 if a[i] in ("-C","-c","--git-dir","--work-tree") else 1
        sub=a[i] if i<len(a) else ""; rest=a[i+1:]
        if sub=="push":
            for x in rest:
                if x in ("-f","-d","--force","--delete","--mirror","--prune") or x.startswith("--force") or re.fullmatch(r"-[a-zA-Z]*[fd][a-zA-Z]*",x): return True
                if not x.startswith("-") and (x.startswith("+") or x.startswith(":")): return True
        if sub=="reset" and "--hard" in rest:
            tgt=[x for x in rest if not x.startswith("-")]
            if tgt and not re.match(r"(origin|upstream)/",tgt[0]): return True  # rewinding history
        if sub in ("rebase","filter-branch","filter-repo"): return True
        if sub=="branch" and any(x in ("-D","--delete","-d") for x in rest) and any(x in ("main","master") for x in rest): return True
    if b=="gh":
        p=[x for x in a if not x.startswith("-")]
        if p[:2] in (["repo","delete"],["release","delete"],["secret","set"],["secret","delete"],["variable","set"],["variable","delete"],["secret","remove"],["variable","remove"]): return True
        if p[:1]==["api"]:
            j=" ".join(a)
            if re.search(r"(-X|--method)[ =]?DELETE",j,re.I): return True
    if b in ("curl","wget"):
        j=" ".join(a)
        if re.search(r"(-X ?|--request[ =]|--method=)DELETE",j,re.I) and re.search(r"api\.github\.com|/api/v3/",j): return True
    if b in ("cat","less","more","head","tail","grep","egrep","rg","cp","mv","scp","rsync","base64","xxd","od","strings","source",".","tar","zip","sed","awk","nl","bat","jq","diff","open","curl"):
        if any(secret_path(x) for x in a if not x.startswith("-") or "=" in x): return True
        if b=="curl" and re.search(r"@\S*(\.env|\.pem|\.key|id_rsa)"," ".join(a)): return True
    if re.search(r"(^|[\s<])<\s*\S*(\.env\b|\.pem|\.key|id_rsa|\.ssh/|\.aws/)",s): return True
    if b=="printenv": return True
    if b=="env" and not [x for x in a if not x.startswith("-")]: return True
    if b in ("set","export","declare") and (not a or a in (["-p"],["-x"],["-px"])): return True
    if b in ("echo","printf") and re.search(SECRET_VAR,s,re.I): return True
    if b=="rm":
        for x in a:
            x=x.strip("'\"")
            if x=="--no-preserve-root": return True
            if not x.startswith("-") and re.fullmatch(CRIT,x.rstrip("/") or "/"): return True
    return False
def builtin_denied():
    if tool=="Bash": return any(builtin(s) for s in segs)
    if tool in ("Read","Edit","Write","MultiEdit","NotebookEdit","Grep","Glob") and path and secret_path(path): return True
    if tool=="Grep" and re.search(r"\.env|\.pem|\.key|id_rsa",str(ti.get("glob") or "")): return True
    return False
if builtin_denied(): refuse("builtin_deny")
if settings_denied(): refuse("deny_list_match")
s=[x for x in (h.get("permission_suggestions") or []) if isinstance(x,dict) and x.get("destination")=="session"]
d={"behavior":"allow"}
if s: d["updatedPermissions"]=s
print(json.dumps({"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":d}}))
PY
)"
case "$out" in
  '{'*) [ "$mode" = "--check" ] && exit 0; printf '%s' "$out";;
  REFUSE:*) [ "$mode" = "--check" ] && { echo "${out#REFUSE:}"; exit 1; };;
  *) [ "$mode" = "--check" ] && { echo error; exit 1; };;
esac
exit 0
