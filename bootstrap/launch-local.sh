#!/usr/bin/env bash
# Local Claude Code launcher (Mac or Linux, bash 3.2 ok). Clean env, the repo owner's bot settings only,
# model/effort from fleet-defaults.json. Refuses with exit 5 on any mismatch (see bot-launch-lib.sh).
# Usage: launch-local.sh [--repo DIR] [--model M] [--effort E] [--] [extra claude args...]
#   --model/--effort are optional and must equal fleet-defaults.json (they exist to catch stale launch lines).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; . "$here/bot-launch-lib.sh"
repo="$PWD"; want_m=""; want_e=""
while [ $# -gt 0 ]; do case "$1" in
  --repo) repo="$2"; shift;; --model) want_m="$2"; shift;; --effort) want_e="$2"; shift;;
  --) shift; break;; *) break;; esac; shift; done
repo="$(cd "$repo" && pwd)"
FD="$here/../scripts/fleet/fleet-defaults.sh"  # shared resolver: .claude/fleet-defaults.json first, then repo root
fd="$(bash "$FD" --root "$repo" path 2>/dev/null)" || fd="$(bash "$FD" --root "$here/.." path)" || { echo "launch refused: no fleet-defaults.json in $repo or the template" >&2; exit 5; }
bl_clean_env
bl_pin "$fd" "$want_m" "$want_e"
bl_load_bot "$repo"
cd "$repo"
exec env -u ANTHROPIC_API_KEY claude --model "$BL_MODEL" --effort "$BL_EFFORT" --permission-mode bypassPermissions "$@"
