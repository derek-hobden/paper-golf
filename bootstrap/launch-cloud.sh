#!/usr/bin/env bash
# Launch a claude.ai cloud session that loads the template's hooks (auto-approve, pings, model check) from minute one.
# `claude --cloud` uses the launch folder's current branch.
# Usage:
#   launch-cloud.sh <owner/repo> <branch> <brief-file> --from-checkout <path> [--log FILE] [--model M] [--effort E]   (default, documented)
#   launch-cloud.sh <owner/repo> <branch> <brief-file> --temp-clone [--seed] [--log FILE] [--model M] [--effort E]   (explicit opt-in)
#   --from-checkout  launch from an existing checkout (e.g. /workspace/repos/<repo>; Derek: never make another clone).
#                    It must be a clean checkout of main (the default branch): on main, no uncommitted or untracked changes
#                    (ignored files ok), no local commits missing from origin/main (warns if behind), origin = <owner/repo>,
#                    and main carries .claude/settings.json (auto-approve), .claude/hooks/check-model-effort.sh,
#                    scripts/claude-hooks/bot-ping.sh, fleet-defaults and bot-owner. Read-only: never modified, reset, cleaned,
#                    switched, and no branch is created in it. <branch> is the branch the cloud session creates and pushes itself.
#   --temp-clone     old behaviour: shallow clone of <branch> into a mktemp dir, deleted afterwards. --seed only works here.
#   --model/--effort optional; must equal fleet-defaults.json (the pin always comes from that file, never from this comment).
# Prints the session URL. Clean env + the repo owner's bot settings only (bot-launch-lib.sh). Exit 5 = refused.
set -euo pipefail
usage="usage: launch-cloud.sh <owner/repo> <branch> <brief-file> --from-checkout <path> [--log FILE]  (or --temp-clone [--seed])"
[ $# -ge 3 ] || { echo "$usage" >&2; exit 2; }
repo="$1"; branch="$2"; brief_file="$3"; shift 3
seed=0; log="/tmp/launch-cloud-$$.log"; want_m=""; want_e=""; mode=""; co=""
while [ $# -gt 0 ]; do case "$1" in
  --from-checkout) mode=checkout; co="${2:?--from-checkout needs a path}"; shift;;
  --temp-clone) mode=clone;; --seed) seed=1;; --log) log="$2"; shift;;
  --model) want_m="$2"; shift;; --effort) want_e="$2"; shift;;
  *) echo "unknown arg $1" >&2; exit 2;; esac; shift; done
refuse() { echo "launch refused: $*" >&2; exit 5; }
[ -n "$mode" ] || refuse "pick a launch mode. Default: --from-checkout /workspace/repos/<repo> (an existing clean checkout of main). Temp clone only with explicit --temp-clone. $usage"
case "$branch" in main|master|production|released) echo "refusing protected branch $branch" >&2; exit 2;; esac
[ -s "$brief_file" ] || { echo "brief file empty: $brief_file" >&2; exit 2; }
here="$(cd "$(dirname "$0")" && pwd)"; . "$here/bot-launch-lib.sh"
FD="$here/../scripts/fleet/fleet-defaults.sh"
bl_clean_env
tfd="$(bash "$FD" --root "$here/.." path 2>/dev/null)" || bl_die "template has no .claude/fleet-defaults.json (or fleet-defaults.json)"
bl_pin "$tfd" "$want_m" "$want_e"
if [ $mode = checkout ]; then
  [ $seed = 0 ] || refuse "--seed needs --temp-clone; with --from-checkout the hooks must already be on main (merge the seed PR, then pull main yourself)"
  [ -d "$co" ] || refuse "checkout $co does not exist"
  top="$(git -C "$co" rev-parse --show-toplevel 2>/dev/null)" || refuse "$co is not a git checkout"
  dir_r="$(cd "$top" && pwd)"
  url="$(git -C "$dir_r" config --get remote.origin.url 2>/dev/null || true)"
  case "$url" in *[:/]"$repo"|*[:/]"$repo".git|*[:/]"$repo"/) ;; *) refuse "checkout origin is not $repo";; esac
  cur="$(git -C "$dir_r" symbolic-ref --short HEAD 2>/dev/null || echo detached)"
  [ "$cur" = main ] || refuse "checkout $dir_r is on $cur, not main (switch it to main yourself; this script never changes it; the cloud session creates $branch)"
  if git -C "$dir_r" rev-parse -q --verify refs/remotes/origin/main >/dev/null 2>&1; then  # no fetch: read-only
    ahead="$(git -C "$dir_r" rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
    behind="$(git -C "$dir_r" rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
    [ "$ahead" = 0 ] || refuse "checkout $dir_r main has $ahead local commit(s) not on origin/main; the cloud session would not see them"
    [ "$behind" = 0 ] || echo "launch-cloud: warning: checkout main is $behind commit(s) behind origin/main (last fetch); pull it yourself if that matters" >&2
  fi
  dirty="$(git -C "$dir_r" status --porcelain --untracked-files=normal 2>/dev/null)" || refuse "git status failed in $dir_r"
  [ -z "$dirty" ] || refuse "checkout $dir_r has uncommitted or untracked changes ($(printf '%s\n' "$dirty" | wc -l | tr -d ' ') path(s)); commit/stash them yourself"
  missing=""
  grep -q auto-approve.sh "$dir_r/.claude/settings.json" 2>/dev/null || missing="$missing .claude/settings.json(auto-approve)"
  [ -f "$dir_r/.claude/hooks/check-model-effort.sh" ] || missing="$missing .claude/hooks/check-model-effort.sh"
  [ -f "$dir_r/scripts/claude-hooks/bot-ping.sh" ] || missing="$missing scripts/claude-hooks/bot-ping.sh"
  bash "$FD" --root "$dir_r" path >/dev/null 2>&1 || missing="$missing .claude/fleet-defaults.json"
  bash "$FD" --root "$dir_r" owner-path >/dev/null 2>&1 || missing="$missing .claude/bot-owner"
  [ -z "$missing" ] || refuse "checkout $dir_r (main) is missing:$missing (merge the seed PR into main, then pull main)"
else
  [ $seed = 1 ] && bash "$here/seed-branch.sh" "$repo" "$branch"
  dir="$(mktemp -d /tmp/cloud-launch.XXXXXX)"; trap 'rm -rf -- "${dir:?}"' EXIT
  gh repo clone "$repo" "$dir/r" -- --depth 1 --single-branch -b "$branch" -q
  dir_r="$dir/r"
  cur="$(git -C "$dir_r" symbolic-ref --short HEAD 2>/dev/null || echo detached)"
  [ "$cur" = "$branch" ] || { echo "clone is on $cur, not $branch" >&2; exit 3; }
  [ -f "$dir_r/.claude/settings.json" ] && grep -q auto-approve.sh "$dir_r/.claude/settings.json" \
    || { echo "branch $branch is not seeded (no auto-approve hook); run with --seed or seed-branch.sh --update" >&2; exit 3; }
fi
if rfd="$(bash "$FD" --root "$dir_r" path 2>/dev/null)"; then
  rm_="$(bash "$FD" --file "$rfd" model)-$(bash "$FD" --file "$rfd" effort)" || rm_="?"
  [ "$rm_" = "$BL_MODEL-$BL_EFFORT" ] || bl_die "branch's fleet-defaults ($rm_) differs from the template's ($BL_MODEL-$BL_EFFORT); sync the repo first"
fi
bl_load_bot "$dir_r"
python3 - "$dir_r" <<'PY'
import json,os,sys
p=os.path.expanduser('~/.claude.json')
try: d=json.load(open(p))
except Exception: d={}
d.setdefault('projects',{}).setdefault(sys.argv[1],{})['hasTrustDialogAccepted']=True
json.dump(d,open(p,'w'),indent=2)
PY
if [ $mode = checkout ]; then
  brief="$(cat "$brief_file")
Your checkout starts from main. Create your own working branch $branch from it, commit there and push $branch; never commit to or push main."
else
  brief="$(cat "$brief_file")
Your checkout starts from $branch (claude.ai names its own working branch from it); stay on that checkout and do not switch branches."
fi
cd "$dir_r"
# script(1) runs the command with sh, so pass the brief through the environment, not shell quoting.
LAUNCH_BRIEF="$brief" env -u ANTHROPIC_API_KEY script -qec \
  "claude --model $BL_MODEL --effort $BL_EFFORT --permission-mode bypassPermissions --cloud \"\$LAUNCH_BRIEF\"" "$log" >/dev/null 2>&1 || true
url="$(grep -ao 'https://claude.ai/code/session_[A-Za-z0-9]*' "$log" | head -1)"
[ -n "$url" ] || { echo "no session URL in $log" >&2; exit 4; }
echo "$url"
