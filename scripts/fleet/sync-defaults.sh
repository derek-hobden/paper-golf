#!/usr/bin/env bash
# Keeps .claude/settings.json's model/effort/compact keys equal to fleet-defaults.json.
# Claude Code only reads settings.json, so the values live there too; this script is the only writer.
# Usage: sync-defaults.sh [--check] [--repo DIR] [--defaults FILE]
#   default: rewrite the managed keys in place (other keys and order untouched)
#   --check: change nothing, list drift, exit 1 if any (for CI). Exit 3 = file missing/unreadable.
# Managed keys: model, effortLevel, modelSettings[<model>].effortLevel, env.CLAUDE_CODE_EFFORT_LEVEL,
#   autoCompactWindow, env.CLAUDE_CODE_AUTO_COMPACT_WINDOW.
set -eu
check=0; repo="$PWD"; defaults=""
while [ $# -gt 0 ]; do case "$1" in
  --check) check=1;; --repo) repo="$2"; shift;; --defaults) defaults="$2"; shift;;
  *) echo "unknown arg $1" >&2; exit 2;; esac; shift; done
here="$(cd "$(dirname "$0")" && pwd)"
defaults="$(bash "$here/fleet-defaults.sh" ${defaults:+--file "$defaults"} --root "$repo" path)" || exit 3
settings="$repo/.claude/settings.json"
[ -f "$settings" ] || { echo "no $settings" >&2; exit 3; }
python3 - "$defaults" "$settings" "$check" <<'PY'
import json,sys
dpath,spath,check=sys.argv[1],sys.argv[2],sys.argv[3]=="1"
d=json.load(open(dpath)); s=json.load(open(spath))
m,e,c=d["model"],d["effort"],int(d["autoCompactWindow"])
drift=[]
def setk(obj,key,val,label):
    if obj.get(key)!=val:
        drift.append("%s is %r (want %r)"%(label,obj.get(key),val)); obj[key]=val
setk(s,"model",m,"model"); setk(s,"effortLevel",e,"effortLevel")
ms=s.setdefault("modelSettings",{})
for other in [k for k in ms if k!=m and "effortLevel" in ms[k]]:
    drift.append("modelSettings[%s] is stale (model is %s)"%(other,m)); del ms[other]
setk(ms.setdefault(m,{}),"effortLevel",e,"modelSettings[%s].effortLevel"%m)
env=s.setdefault("env",{})
setk(env,"CLAUDE_CODE_EFFORT_LEVEL",e,"env.CLAUDE_CODE_EFFORT_LEVEL")
setk(env,"CLAUDE_CODE_AUTO_COMPACT_WINDOW",str(c),"env.CLAUDE_CODE_AUTO_COMPACT_WINDOW")
setk(s,"autoCompactWindow",c,"autoCompactWindow")
if check:
    if drift:
        print("settings.json drifted from %s:"%dpath); [print("  - "+x) for x in drift]
        print("fix: bash scripts/fleet/sync-defaults.sh && commit .claude/settings.json"); sys.exit(1)
    print("settings.json matches fleet defaults (%s, %s, compact %d)"%(m,e,c)); sys.exit(0)
if drift:
    with open(spath,"w") as f: json.dump(s,f,indent=2,ensure_ascii=False); f.write("\n")
    print("updated %s: %d key(s)"%(spath,len(drift)))
else: print("already in sync")
PY
