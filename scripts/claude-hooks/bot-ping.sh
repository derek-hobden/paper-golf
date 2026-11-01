#!/usr/bin/env bash
# Portable time limit: macOS has no `timeout`; try gtimeout, else run with no limit.
tlim() { t="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$t" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$t" "$@"
  else "$@"; fi; }
# Draft .claude/hooks/bot-ping.sh — generalised from paper-golf scripts/factory/session-ping.sh.
# Usage: bot-ping.sh <event>. Hook JSON on stdin. POSTs
# {event, kind, waiting, notification_type, repo, branch, session_id, session_url, tool_name, stop_reason, ts, ...}
# to $BOT_WEBHOOK_URL with header "Authorization: Bearer $BOT_WEBHOOK_KEY".
# Ping only: never answers a prompt (auto-approve lives in scripts/claude-hooks/auto-approve.sh; this script
# only asks it, via --check, whether a PermissionRequest was auto-approved, to set waiting/kind).
# Privacy: by default NO prompt/message/command/tool-input text is sent. FACTORY_PING_SNIPPET=1 adds `snippet`
# (<=120 chars, redacted: emails, long digit runs, token/key-like strings, anything after password/secret/token).
# Never hangs: stdin capped by `read -t 2`, curl always --connect-timeout 3 --max-time 5 (no `timeout` binary needed).
# Never prints URL/key, https only, always exit 0 and prints nothing on stdout.
# PostToolUse runs after every Bash call and every MCP create_pull_request tool (.claude/settings.json),
# and this script decides from the tool input: pr_opened (gh pr create in any form: env prefix,
# `cd x &&`, `gh -R o/r`; gh api or curl POST to /pulls; GraphQL createPullRequest; the MCP tool),
# pushed (git push), or no ping at all. The GitHub-side backstop is .github/workflows/bot-ping-pr-opened.yml.
event="${1:-unknown}"
input=""; [ -t 0 ] || IFS= read -r -d '' -t 2 input || true
auto=0; refused=""
if [ "$event" = "PermissionRequest" ]; then
  if refused="$(HOOK_INPUT="$input" bash "$(dirname "$0")/auto-approve.sh" --check 2>/dev/null)"; then auto=1; refused=""; fi
fi
export BOT_PING_AUTO="$auto" BOT_PING_REFUSED="$refused"
send() {
  BOT_WEBHOOK_URL="${BOT_WEBHOOK_URL:-${FACTORY_PING_URL:-}}"; BOT_WEBHOOK_KEY="${BOT_WEBHOOK_KEY:-${FACTORY_PING_KEY:-}}"
  [ -n "${BOT_WEBHOOK_URL:-}" ] && [ -n "${BOT_WEBHOOK_KEY:-}" ] || return 0
  case "$BOT_WEBHOOK_URL" in https://*) ;; *) return 0;; esac
  local repo branch payload
  repo="$(git config --get remote.origin.url 2>/dev/null | sed -E 's#^(https?://[^/]+/|git@[^:]+:)##; s#\.git$##')"
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  payload="$(HOOK_INPUT="$input" EVENT="$event" REPO="$repo" BRANCH="$branch" tlim 3 python3 - <<'PY' 2>/dev/null
import json,os,re,shlex,time
try: h=json.loads(os.environ.get("HOOK_INPUT") or "{}")
except Exception: h={}
def heredocs_out(cmd):
    # Drops heredoc bodies: their text is input, not commands (and may hold a stray quote).
    out,ends=[],[]
    for line in cmd.split("\n"):
        if ends:
            if line.strip()==ends[0]: ends.pop(0)
            continue
        out.append(line)
        ends+=[m.group(2) for m in re.finditer(r"<<-?\s*(['\"]?)([A-Za-z_]\w*)\1",line)]
    return "\n".join(out)
def simple_commands(cmd):
    # The command line as simple commands (word lists), split at ; & | ( ) < > and newlines.
    lx=shlex.shlex(cmd,posix=True,punctuation_chars=";&|()<>\n")
    lx.whitespace=" \t\r"; lx.whitespace_split=True; lx.commenters=""
    cmds,cur=[],[]
    for t in lx:
        if t and set(t)<=set(";&|()<>\n"):
            if cur: cmds.append(cur)
            cur=[]
        else: cur.append(t)
    if cur: cmds.append(cur)
    return cmds
def strip_prefix(w):
    # Peel wrappers: VAR=x, env, command, exec, time, nohup, nice, ionice, stdbuf, sudo, xargs, timeout/gtimeout.
    # Options that take a separate value are skipped with their value (e.g. timeout -s KILL, -k 5, --signal KILL).
    VAL={"timeout":{"-s","-k","--signal","--kill-after"},"gtimeout":{"-s","-k","--signal","--kill-after"},
         "env":{"-u","--unset","-C","--chdir","-S","--split-string"},"nice":{"-n","--adjustment"},
         "ionice":{"-c","-n","-p","--class","--classdata"},"stdbuf":{"-i","-o","-e"},
         "sudo":{"-u","-g","-h","-p","-C","-U","-r","-t"},"time":{"-f","-o","--format","--output"},
         "command":set(),"exec":{"-a"},"nohup":set(),"xargs":{"-n","-I","-L","-P","-d","-s","-E","-a"}}
    i=0
    while i<len(w):
        a=w[i]; b=os.path.basename(a)
        if re.match(r"[A-Za-z_]\w*=",a): i+=1; continue
        if b not in VAL: break
        i+=1
        while i<len(w):
            x=w[i]
            if x=="--": i+=1; break
            if x in VAL[b]: i+=2; continue
            if x.startswith("-") and x!="-": i+=1; continue
            if b=="env" and re.match(r"[A-Za-z_]\w*=",x): i+=1; continue
            break
        if b in ("timeout","gtimeout") and i<len(w): i+=1   # the DURATION
        if b=="nice" and i<len(w) and re.fullmatch(r"-?\d+",w[i]): i+=1
    return w[i:]
def gh_api_creates_pr(args):
    # gh api: a POST (-X POST, or any -f/-F/--input) to repos/O/R/pulls, or GraphQL createPullRequest.
    method,fields,endpoint,body=None,[],None,False
    i=0
    while i<len(args):
        a=args[i]; m=re.match(r"(--[a-z-]+)=(.*)",a,re.S)
        if m: flag,val=m.group(1),m.group(2); i+=1
        elif a in ("-X","--method","-f","--raw-field","-F","--field","-H","--header","--input","-q","--jq","-t","--template","--hostname","-p","--preview","--cache"):
            flag,val=a,(args[i+1] if i+1<len(args) else ""); i+=2
        elif re.match(r"-[XfF].",a): flag,val=a[:2],a[2:]; i+=1
        elif a.startswith("-"): i+=1; continue
        else:
            endpoint=endpoint or a; i+=1; continue
        if flag in ("-X","--method"): method=val.upper()
        elif flag in ("-f","--raw-field","-F","--field"): fields.append(val)
        elif flag=="--input": body=True
    path=re.sub(r"^https?://[^/]+/(api/v3/)?","",endpoint or "").lstrip("/").split("?")[0].rstrip("/")
    if path=="graphql": return any("createPullRequest" in f for f in fields)
    return bool(re.fullmatch(r"repos/[^/]+/[^/]+/pulls",path)) and (method or ("POST" if fields or body else "GET"))=="POST"
def curl_creates_pr(args):
    # curl: a POST (-X POST, or a -d/--data/--json body) to the REST API's repos/O/R/pulls.
    method,data,url=None,False,False
    i=0
    while i<len(args):
        a=args[i]
        if a in ("-X","--request"): method=(args[i+1] if i+1<len(args) else "").upper(); i+=2; continue
        if a.startswith("--request="): method=a.split("=",1)[1].upper(); i+=1; continue
        if re.match(r"-X.",a): method=a[2:].upper(); i+=1; continue
        if re.match(r"--(data|data-raw|data-binary|json)=",a) or re.match(r"-d.",a): data=True; i+=1; continue
        if a in ("-d","--data","--data-raw","--data-binary","--json"): data=True; i+=2; continue
        if a in ("-H","--header","-u","--user","-o","--output","-w","--write-out","-m","--max-time","-A","--user-agent","--connect-timeout","--retry","-x","--proxy","-F","--form","--data-urlencode"):
            i+=2; continue
        if not a.startswith("-") and re.search(r"(api\.github\.com|/api/v3)/repos/[^/]+/[^/]+/pulls/?(\?|$)",a): url=True
        i+=1
    return url and (method or ("POST" if data else "GET"))=="POST"
def command_kinds(cmd,depth=0):
    # {"pr"} for a command line that opens a pull request, {"push"} for a git push, or both.
    kinds=set(); cmd=heredocs_out(cmd)
    try: cmds=simple_commands(cmd)
    except ValueError:  # unbalanced quotes: fall back to a plain search
        if re.search(r"(^|[\s;&|(/])gh\s[^\n;&|]*\bpr\s+(create|new)\b",cmd): kinds.add("pr")
        if re.search(r"(^|[\s;&|(/])git\s[^\n;&|]*\bpush\b",cmd): kinds.add("push")
        return kinds
    for w in cmds:
        w=strip_prefix(w)
        if not w: continue
        b,args=os.path.basename(w[0]),w[1:]
        if b in ("bash","sh","zsh","dash") and depth<3:
            for j,a in enumerate(args[:-1]):
                if re.fullmatch(r"-[a-z]*c[a-z]*",a): kinds|=command_kinds(args[j+1],depth+1); break
        elif b=="gh":
            pos,i=[],0
            while i<len(args) and len(pos)<2:
                a=args[i]
                if a in ("-R","--repo","--hostname"): i+=2; continue
                i+=1
                if not a.startswith("-"): pos.append(a)
            if pos[:1]==["pr"] and pos[1:2] in (["create"],["new"]): kinds.add("pr")
            if pos[:1]==["api"] and gh_api_creates_pr(args[args.index("api")+1:]): kinds.add("pr")
        elif b=="curl" and curl_creates_pr(args): kinds.add("pr")
        elif b=="git":
            i=0
            while i<len(args):
                a=args[i]
                if a in ("-C","-c","--git-dir","--work-tree","--namespace","--exec-path"): i+=2; continue
                if a.startswith("-"): i+=1; continue
                if a=="push": kinds.add("push")
                break
    return kinds
def tool_event(tool,cmd):
    if re.fullmatch(r"mcp__.+__create_pull_request",tool): return "pr_opened"
    if tool!="Bash": return None
    k=command_kinds(cmd)
    return "pr_opened" if "pr" in k else ("pushed" if "push" in k else None)
sid=os.environ.get("CLAUDE_CODE_REMOTE_SESSION_ID") or h.get("session_id","")
ti=h.get("tool_input") or {}
prompt=h.get("message") or ti.get("command") or ti.get("file_path") or h.get("last_assistant_message","") or h.get("prompt","")
def redact(t):
    t=re.sub(r"(?is)\b(password|passwd|secret|token|api[_-]?key)\b.*",r"\1 [redacted]",str(t))
    t=re.sub(r"[\w.+-]+@[\w-]+(\.[\w-]+)+","[email]",t)
    t=re.sub(r"\b(sk|pk|ghp|gho|ghs|github_pat|xox[a-z]|eyJ)[\w-]{6,}","[key]",t)
    t=re.sub(r"[A-Za-z0-9_+/=-]{24,}","[key]",t)
    t=re.sub(r"\d[\d -]{5,}\d","[num]",t)
    return re.sub(r"\s+"," ",t).strip()[:120]
ev=os.environ["EVENT"]; nt=h.get("notification_type") or ""
WAIT_NT=("permission_prompt","idle_prompt","elicitation_dialog","elicitation_url_dialog","agent_needs_input","quota_auto_resume_stale")
extra={}
if ev=="PostToolUse":
    tool=str(h.get("tool_name") or "")
    cmd=str(ti.get("command","")) if tool=="Bash" else ""
    ev=tool_event(tool,cmd)
    if ev is None: raise SystemExit(0)  # not a push or a new PR: no ping
    tr=h.get("tool_response") or {}
    out=(str(tr.get("stdout","")) + "\n" + str(tr.get("stderr",""))) if isinstance(tr,dict) and tool=="Bash" else json.dumps(tr)
    urls=re.findall(r"https://github\.com/[\w.-]+/[\w.-]+/pull/(?:new/[\w./-]+|\d+)", out)
    if ev=="pr_opened": urls=[u for u in urls if re.search(r"/pull/\d+$",u)] or urls  # the new PR, not a push's /pull/new/ hint
    extra={"pr_url":(urls[-1] if urls else None)}
# waiting=true only when a human/bot must act now; auto-approved PermissionRequest is info-only
waiting=(ev=="PermissionRequest" and os.environ.get("BOT_PING_AUTO")!="1") or (ev=="Notification" and nt in WAIT_NT) or ev=="Elicitation"
kind="alert" if (waiting or ev in ("StopFailure","PermissionDenied","model_drift")) else "info"
if ev=="Elicitation": extra={"mcp_server_name":h.get("mcp_server_name"),"mode":h.get("mode"),"url":h.get("url")}
if ev=="SessionStart": extra={"source":h.get("source")}
if ev=="Stop": extra={"question":str(h.get("last_assistant_message") or "").rstrip().endswith("?")}  # flag only, no text
if ev=="PermissionDenied": extra={"reason":h.get("reason")}
if ev=="model_drift": extra={"model":h.get("model"),"effort_level":h.get("effort_level"),"effort_source":h.get("effort_source")}
print(json.dumps({**extra,"event":ev,"hook_event":os.environ["EVENT"],"waiting":waiting,"kind":kind,"auto_approved":ev=="PermissionRequest" and os.environ.get("BOT_PING_AUTO")=="1",
 **({"auto_approve_refused":os.environ.get("BOT_PING_REFUSED") or "error"} if ev=="PermissionRequest" and os.environ.get("BOT_PING_AUTO")!="1" else {}),"notification_type":h.get("notification_type"),
 "repo":os.environ.get("REPO"),"branch":os.environ.get("BRANCH"),"session_id":sid,
 "session_url":("https://claude.ai/code/"+sid) if os.environ.get("CLAUDE_CODE_REMOTE_SESSION_ID") else None,
 "tool_name":h.get("tool_name"),"stop_reason":h.get("reason"),"ts":int(time.time()),
 **({"snippet":redact(prompt)} if os.environ.get("FACTORY_PING_SNIPPET")=="1" and prompt else {})}))
PY
)"
  [ -n "$payload" ] || return 0
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 5 -X POST -H "Content-Type: application/json" \
    -H "Authorization: Bearer $BOT_WEBHOOK_KEY" --data "$payload" "$BOT_WEBHOOK_URL" 2>/dev/null || echo 000)"
  # evidence log: event + HTTP status only, never URL/key
  printf '%s %s http=%s\n' "$(date -u +%FT%TZ)" "$event" "$code" >> "${BOT_PING_LOG:-/tmp/bot-ping.log}" 2>/dev/null || true
}
send
exit 0
