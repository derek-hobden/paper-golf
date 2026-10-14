#!/bin/bash
# TEST FIXTURE: a verbatim copy of bots-work lib/approval-lib.sh (job 1, 14 Oct 2026) below this
# header, so scripts/ship/test-ship.sh can run push-to-main.sh against the real gate logic on any
# machine (CI has no bots-work). push-to-main.sh itself sources the live bots-work copy
# ($SHIP_APPROVAL_LIB). If bots-work changes the record format, refresh this copy.
#
# approval-lib.sh — Derek's release gate (13 Oct 2026). Sourced by ship-job.sh, release-job.sh, record-approval.sh.
# Bots build and test on localhost, send Derek a before/after explainer video and STOP. Only after Derek says yes
# in chat does the bot record it (lib/record-approval.sh) and ship:
#   <job>/approvals/main.json  push to main (+ the staging deploy the repo's pipeline runs on push)
#   <job>/approvals/prod.json  release to production (staging green, Derek asked again; needs main.json too)
#   <job>/approvals/checks.json  the repo's local checks passed on a commit (lib/record-checks.sh; approval_for_sha)
# A file is valid when: valid JSON; approved_by == "Derek"; step == the step; job == the job folder's name;
# bot and quote non-empty; time is an ISO-8601 time with a zone, not in the future; and (when freshness is
# checked) time is strictly newer than the committer time of the job's last commit (worktree HEAD, or the
# shipped sha in the repo clone once the worktree is gone), so a commit made after the approval needs a new yes.
: "${BOTS:=/Users/anton/bots-work}"
: "${BOTS_REPOS_DIR:=$BOTS/repos}"   # where repo clones live (tests point it at a temp dir)

# iso_epoch <time>: epoch seconds, or nothing if the time is not ISO-8601 with an explicit zone.
iso_epoch() {
  python3 -c 'import sys,datetime
t=sys.argv[1]
try:
    d=datetime.datetime.fromisoformat(t.replace("Z","+00:00"))
except Exception: sys.exit(1)
if d.tzinfo is None: sys.exit(1)
print(int(d.timestamp()))' "$1" 2>/dev/null
}

# job_commit <job-dir>: "<sha> <committer epoch>" of the job's last commit, or nothing.
job_commit() {
  local j=$1 sha repo
  if [ -d "$j/worktree" ] && git -C "$j/worktree" rev-parse -q --verify HEAD >/dev/null 2>&1; then
    git -C "$j/worktree" log -1 --format='%H %ct' HEAD; return
  fi
  sha=$(sed -n 's/^shipped[a-z-]* sha=\([0-9a-f]\{7,40\}\).*/\1/p' "$j/status" 2>/dev/null | head -1)
  repo=$(jq -r '.repo // empty' "$j/meta.json" 2>/dev/null)
  [ -n "$sha" ] && [ -n "$repo" ] && git -C "$BOTS_REPOS_DIR/$repo" log -1 --format='%H %ct' "$sha" 2>/dev/null
}

# approval_valid <job-dir> <main|prod> <fresh: true|false>
# Returns 0 if valid; otherwise 1 with the reason in APPROVAL_WHY.
approval_valid() {
  local j=$1 step=$2 fresh=$3 f id by s jid bot quote t ep c ce
  f="$j/approvals/$step.json"; id=$(basename "$j"); APPROVAL_WHY=""
  [ -f "$f" ] || { APPROVAL_WHY="no approvals/$step.json"; return 1; }
  jq -e 'type == "object"' "$f" >/dev/null 2>&1 || { APPROVAL_WHY="approvals/$step.json is not a JSON object"; return 1; }
  by=$(jq -r '.approved_by // ""' "$f"); s=$(jq -r '.step // ""' "$f"); jid=$(jq -r '.job // ""' "$f")
  bot=$(jq -r '.bot // ""' "$f"); quote=$(jq -r '.quote // ""' "$f"); t=$(jq -r '.time // ""' "$f")
  [ "$by" = Derek ] || { APPROVAL_WHY="approvals/$step.json approved_by is '$by' (must be Derek)"; return 1; }
  [ "$s" = "$step" ] || { APPROVAL_WHY="approvals/$step.json is for step '$s', not '$step'"; return 1; }
  [ "$jid" = "$id" ] || { APPROVAL_WHY="approvals/$step.json is for job '$jid', not '$id'"; return 1; }
  [ -n "$bot" ] || { APPROVAL_WHY="approvals/$step.json has no bot"; return 1; }
  [ -n "$quote" ] || { APPROVAL_WHY="approvals/$step.json has no quote of Derek's yes"; return 1; }
  ep=$(iso_epoch "$t"); [ -n "$ep" ] || { APPROVAL_WHY="approvals/$step.json time '$t' is not an ISO-8601 time with a zone"; return 1; }
  [ "$ep" -le $(( $(date +%s) + 300 )) ] || { APPROVAL_WHY="approvals/$step.json time '$t' is in the future"; return 1; }
  if [ "$fresh" = true ]; then
    c=$(job_commit "$j"); ce=${c#* }
    [ -n "$c" ] || { APPROVAL_WHY="can't find the job's last commit to compare approvals/$step.json against"; return 1; }
    [ "$ep" -gt "$ce" ] || { APPROVAL_WHY="approvals/$step.json ($t) is not newer than the job's last commit ${c:0:12} ($(date -r "$ce" '+%Y-%m-%dT%H:%M:%S%z')); the code changed after Derek's yes, so show him the new result and ask again"; return 1; }
  fi
  return 0
}

# approval_for_sha <job-dir> <main|prod> <sha>  (Derek, 14 Oct 2026 13:46)
# The per-commit approval a Claude Code job needs to run its repo's push-to-main.sh itself. <sha> (full 40 hex) is
# the commit being pushed. Passes only when approval_valid passes for approvals/<step>.json AND either
#   - .commit is exactly <sha> (and the approval is fresh: newer than the worktree HEAD), or
#   - <sha> is a rebase of .commit onto the worktree's origin/main (Derek 13:51): origin/main is an ancestor of <sha>,
#     the approval is newer than .commit, and the patch is unchanged: git patch-id of merge-base(origin/main,X)..X is
#     the same for X = .commit and X = <sha> (computed here at check time; nothing extra is stored in main.json)
# AND approvals/checks.json (lib/record-checks.sh) records the repo's local checks passing on <sha> itself.
# 1 + APPROVAL_WHY otherwise.
_range_patch_id() { # <git dir> <commit>: patch-id of everything the commit adds on top of origin/main
  local b; b=$(git -C "$1" merge-base origin/main "$2" 2>/dev/null) || return 1
  git -C "$1" diff "$b" "$2" 2>/dev/null | git patch-id --stable 2>/dev/null | cut -d' ' -f1
}
approval_for_sha() {
  local j=$1 step=$2 sha=$3 wt="$1/worktree" c ce ep pa pb ck cr cc ct
  case "$sha" in *[!0-9a-f]*) sha=bad ;; esac
  [ ${#sha} -eq 40 ] || { APPROVAL_WHY="'$3' is not a full commit sha"; return 1; }
  approval_valid "$j" "$step" false || return 1
  c=$(jq -r '.commit // ""' "$j/approvals/$step.json")
  if [ "$c" = "$sha" ]; then
    approval_valid "$j" "$step" true || return 1
  else
    git -C "$wt" cat-file -e "${c:-none}^{commit}" 2>/dev/null && [ ${#c} -eq 40 ] \
      || { APPROVAL_WHY="approvals/$step.json covers '${c:0:12}', not a commit in the worktree: ${sha:0:12} needs a fresh yes"; return 1; }
    git -C "$wt" merge-base --is-ancestor origin/main "$sha" 2>/dev/null \
      || { APPROVAL_WHY="${sha:0:12} is not the approved ${c:0:12} and not on top of origin/main: rebase onto origin/main, re-run lib/record-checks.sh"; return 1; }
    ce=$(git -C "$wt" log -1 --format=%ct "$c"); ep=$(iso_epoch "$(jq -r '.time // ""' "$j/approvals/$step.json")")
    [ "$ep" -gt "$ce" ] || { APPROVAL_WHY="approvals/$step.json is not newer than the approved commit ${c:0:12}; needs a fresh yes"; return 1; }
    pa=$(_range_patch_id "$wt" "$c"); pb=$(_range_patch_id "$wt" "$sha")
    [ -n "$pa" ] && [ "$pa" = "$pb" ] || { APPROVAL_WHY="patch changed since approval: needs a fresh yes (${sha:0:12} is not ${c:0:12} rebased onto origin/main)"; return 1; }
  fi
  ck="$j/approvals/checks.json"
  [ -f "$ck" ] || { APPROVAL_WHY="no approvals/checks.json: ${sha:0:12} needs fresh checks (lib/record-checks.sh)"; return 1; }
  jq -e 'type == "object"' "$ck" >/dev/null 2>&1 || { APPROVAL_WHY="approvals/checks.json is not a JSON object"; return 1; }
  cr=$(jq -r '.result // ""' "$ck"); cc=$(jq -r '.commit // ""' "$ck"); ct=$(jq -r '.at // ""' "$ck")
  [ "$cc" = "$sha" ] || { APPROVAL_WHY="approvals/checks.json is for ${cc:0:12}, not ${sha:0:12}: ${sha:0:12} needs fresh checks (lib/record-checks.sh)"; return 1; }
  [ "$cr" = pass ] || { APPROVAL_WHY="approvals/checks.json result is '$cr' (must be pass)"; return 1; }
  [ -n "$(jq -r '.cmd // ""' "$ck")" ] || { APPROVAL_WHY="approvals/checks.json has no cmd"; return 1; }
  [ -n "$(iso_epoch "$ct")" ] || { APPROVAL_WHY="approvals/checks.json at '$ct' is not an ISO-8601 time with a zone"; return 1; }
  return 0
}
