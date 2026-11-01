#!/usr/bin/env bash
# Turn job 1's silent recording into the narrated explainer, host it as an asset
# on the month's PR video shelf (a `pr-videos-YYYY-MM` prerelease,
# pr-video-upload.sh), and put its link at the top of the pull request.
#
# This is the publish workflow's half, in two modes run by two jobs with the
# audio gate's job between them (.github/workflows/pr-video-publish.yml). It
# never checks out or runs a line of the pull request: the recording arrives
# as a workflow artifact and is treated as data throughout — ffmpeg and
# ffprobe see it with every key unset, and which pull request it belongs to is
# confirmed against the API rather than believed (AGENTS.md "PR explainer
# videos").
#
#   GH_TOKEN=<read-only token> SHIP_REPO=<owner/repo> RUN_HEAD_SHA=<sha> \
#   ANTHROPIC_API_KEY=... OPENROUTER_API_KEY=... \
#     bash scripts/ship/pr-video-publish.sh <artifact-dir>
#   GH_TOKEN=<Golf Gus app token> SHIP_REPO=<owner/repo> RUN_HEAD_SHA=<sha> \
#     bash scripts/ship/pr-video-publish.sh --upload <made-dir>
#
# The first makes the video: it confirms the pull request, proves a Claude
# review passed for the commit the recording shows (review-findings.sh: the
# findings artifact's workflow and event are checked, blocking is 0, and its
# commit covers RUN_HEAD_SHA), drops a recording whose passed review already
# has a video, writes and voices the narration — what the pull request is and
# the problem it fixes, how it works today, what changed, how it works after,
# and last the review result as a fixed paragraph in plain words — adds the
# review card (pr-video-card.sh) and muxes it, and leaves video.mp4, narration.txt, narration.wav, model.log and
# made.json in the work directory ($VIDEO_WORK, else <artifact-dir>/work),
# with `made=true` or `made=false` on $GITHUB_OUTPUT. It holds the two keys and
# reads with a read-only token. pr-video-audio-gate.sh then listens to it in a
# job of its own with no secret, and only advises. --upload is the only step
# that writes: it hosts the mp4, puts its link at the top of the body and
# comments, on the app's token, whatever <made-dir>/audio-gate.txt says. A FAIL
# there, or no report at all, is a warning (lib.sh ship_video_warning): the
# explainer video is best effort and never holds a merge (Derek, 1 Nov 2026).
#
# RUN_HEAD_SHA is the commit the triggering run recorded, from the workflow_run
# event — not from the artifact, which the pull request's own code wrote.
#
# Beat mode (issue 80): a recording of one clip whose artifact holds beats.json
# — a JSON array of 2 to 40 scene starts, in seconds, the first under 2, each
# after the one before and inside the clip — is narrated one paragraph per scene
# (pr-video-script.sh with BEAT_SECONDS) and put in step with its voice scene by
# scene (pr-video-beats.sh): its last scene is the review result's, so there is
# no separate card. With script.json beside it (the motion kit, e2e/walkthroughs/
# motion.ts), the voice says that, one paragraph per scene, and no model writes
# a word. Anything else in beats.json is said and ignored, and the video
# is made as before; so is a narration whose paragraphs do not match the scenes,
# or scenes the voice cannot be put in step with, with a warning.
#
# Exit 0 when the video is made (or not needed), or the link is on the pull
# request; 1 when no video could be made or hosted at all (there is no
# half-published video); 2 on a usage error. A video problem that still leaves
# a video is a warning, never a failure.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,${/^[^#]/q;p;}' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

# Says on $GITHUB_OUTPUT whether a video was made for the gate and the upload.
made_output() {
  [ -z "${GITHUB_OUTPUT:-}" ] || echo "made=$1" >>"$GITHUB_OUTPUT"
}

# --- hosted, linked, announced (after the gate) ------------------------------
upload_mode() {
  local made="$1" pr sha review_run summary url note
  [ -d "$made" ] || { echo "::error::no made directory at $made" >&2; exit 2; }
  ship_need gh jq
  [ -n "${GH_TOKEN:-}" ] || { echo "::error::GH_TOKEN is not set" >&2; exit 2; }
  [ -n "${RUN_HEAD_SHA:-}" ] || { echo "::error::RUN_HEAD_SHA is not set" >&2; exit 2; }
  # The gate only advises: the video is best effort and never holds a merge
  # (Derek, 1 Nov 2026), so what it heard is a warning and the video is hosted
  # all the same, a gate that never ran included.
  local verdict reasons
  verdict="$(head -n 1 "$made/audio-gate.txt" 2>/dev/null || true)"
  if [ "$verdict" = "audio-gate: FAIL" ]; then
    reasons="$(sed -n 's/^reason: //p' "$made/audio-gate.txt" | paste -sd ';' - | sed 's/;/; /g')"
    ship_video_warning "the audio check flagged this video (${reasons:-no reason given}), and it is published anyway"
  elif [ "$verdict" != "audio-gate: PASS" ]; then
    ship_video_warning "the audio check did not run on this video, and it is published anyway"
  fi
  pr="$(jq -r '.pr // empty' "$made/made.json" 2>/dev/null || true)"
  sha="$(jq -r '.sha // empty' "$made/made.json" 2>/dev/null || true)"
  review_run="$(jq -r '.review_run // empty' "$made/made.json" 2>/dev/null || true)"
  summary="$(jq -r '.summary // empty' "$made/made.json" 2>/dev/null || true)"
  case "$pr" in '' | *[!0-9]*) echo "::error::the made video names no pull request" >&2; exit 1 ;; esac
  [ "$sha" = "$RUN_HEAD_SHA" ] || {
    echo "::error::the made video says it shows $sha, but the run recorded $RUN_HEAD_SHA" >&2
    exit 1
  }
  [ -f "$made/video.mp4" ] || { echo "::error::no video at $made/video.mp4" >&2; exit 1; }

  url="$(PR="$pr" HEAD_SHA="$sha" bash "$here/pr-video-upload.sh" "$made/video.mp4")" || exit 1
  PR="$pr" bash "$here/pr-video-body.sh" "$url"

  # The comment is also the record of what has been bought: the marker and the
  # passed review it was bought for are what the cap reads next time.
  note="$(mktemp)"
  trap 'rm -f "$note"' EXIT
  BODY="$(printf '%s\n\n%s\n\n    ffprobe: %s\n\n%s\nreview-run: %s\n' \
    "The explainer video for this pull request is linked at the top of the description." \
    "It was recorded and narrated by CI after the Claude review passed; nobody attached it by hand. A code push gets a fresh review, and a fresh video once that passes." \
    "$summary" "$VIDEO_MARKER" "$review_run")" jq -n '{body: env.BODY}' >"$note"
  gh api --method POST "/repos/$SHIP_REPO/issues/$pr/comments" --input "$note" >/dev/null ||
    echo "::warning::could not comment on pull request $pr; the video is still on the body" >&2

  echo "pr-video-publish: $url"
  exit 0
}

VIDEO_MARKER='<!-- pr-video-published -->'
if [ "${1:-}" = --upload ]; then
  [ $# -eq 2 ] || { echo "usage: pr-video-publish.sh --upload <made-dir> (see --help)" >&2; exit 2; }
  upload_mode "$2"
fi

[ $# -eq 1 ] || { echo "usage: pr-video-publish.sh <artifact-dir> (see --help)" >&2; exit 2; }
art="$1"
[ -d "$art" ] || { echo "::error::no artifact directory at $art" >&2; exit 2; }
ship_need gh jq
[ -n "${GH_TOKEN:-}" ] || { echo "::error::GH_TOKEN is not set" >&2; exit 2; }
[ -n "${RUN_HEAD_SHA:-}" ] || { echo "::error::RUN_HEAD_SHA is not set" >&2; exit 2; }

work="${VIDEO_WORK:-$art/work}"
mkdir -p "$work"

# --- which pull request, confirmed ------------------------------------------
# The artifact says which; the API decides whether to believe it.
pr="$(jq -r '.pr // empty' "$art/meta.json" 2>/dev/null || true)"
sha="$(jq -r '.sha // empty' "$art/meta.json" 2>/dev/null || true)"
case "$pr" in '' | *[!0-9]*) echo "::error::the artifact names no pull request" >&2; exit 1 ;; esac
[ "$sha" = "$RUN_HEAD_SHA" ] || {
  echo "::error::the artifact says it recorded $sha, but the run recorded $RUN_HEAD_SHA" >&2
  exit 1
}

row="$(gh api "/repos/$SHIP_REPO/pulls/$pr" \
  --jq '[(.head.repo.full_name // ""), (.draft|tostring), .state, "\(.changed_files) files, +\(.additions) −\(.deletions)"] | @tsv')" || {
  echo "::error::could not read pull request $pr" >&2
  exit 1
}
IFS=$'\t' read -r head_repo draft state diffstat <<<"$row"
[ "$head_repo" = "$SHIP_REPO" ] || { echo "::error::pull request $pr is from $head_repo, not $SHIP_REPO" >&2; exit 1; }
[ "$state" = open ] || { echo "::error::pull request $pr is $state" >&2; exit 1; }
[ "$draft" != true ] || { echo "::error::pull request $pr is a draft" >&2; exit 1; }
# Read whole, then searched: a pipe into grep -q can SIGPIPE gh under pipefail.
commits="$(gh api --paginate "/repos/$SHIP_REPO/pulls/$pr/commits" --jq '.[].sha')" || commits=''
grep -qxF "$RUN_HEAD_SHA" <<<"$commits" || {
  echo "::error::$RUN_HEAD_SHA is not a commit of pull request $pr" >&2
  exit 1
}
title="$(gh api "/repos/$SHIP_REPO/pulls/$pr" --jq '.title')"
gh api "/repos/$SHIP_REPO/pulls/$pr" --jq '.body // ""' >"$work/body.md"

# Review first, then the video, and one video per passed review: decided here
# and nowhere else. Job 1 runs on a `pull_request` event, so its copy of the
# workflow and of paid-trigger.sh is the pull request's own: a branch can edit
# either and record whenever it likes. This file is main's, it cannot be edited
# by the pull request, and it is where the money is spent — so this is where
# both have to be. A recording with no passed review for its commit, or for a
# passed review that already has a video, is dropped before anything is bought.
PR="$pr" bash "$here/review-findings.sh" "$work/review" || exit 1
count_of() { sed -n "s/^$1=//p" "$work/review/counts"; }
review_run="$(count_of review_run)"
published="$(gh api --paginate "/repos/$SHIP_REPO/issues/$pr/comments" --jq '
  .[] | select(.body | contains("'"$VIDEO_MARKER"'")) | .body' |
  sed -n 's/^review-run: //p')" || published=''
if [ -n "$review_run" ] && grep -qxF -- "$review_run" <<<"$published"; then
  echo "pr-video-publish: pull request $pr already has a video for the passed review run $review_run; nothing to buy"
  made_output false
  exit 0
fi

clips=()
while IFS= read -r clip; do
  [ -n "$clip" ] || continue
  clips+=("$clip")
done < <(find "$art/clips" -name '*.webm' -type f 2>/dev/null | LC_ALL=C sort)
[ "${#clips[@]}" -gt 0 ] || { echo "::error::the artifact holds no recording" >&2; exit 1; }

# --- the narrated video ------------------------------------------------------
# The picture first, so the narration can be written to fit it: a script longer
# than the walkthrough leaves the video frozen on its last frame.
bash "$here/pr-video-join.sh" "$work/clip.mp4" "${clips[@]}"
seconds="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$work/clip.mp4" || true)"
# A walkthrough that kept its scene starts filmed one clip, or something went wrong: a second
# clip (a test that skipped itself after its page opened, PR 105) takes the recording out of beat
# mode, so no scene can be held to its words. That is said plainly, as a warning, and the video
# is made without beats: the video is best effort and never holds a merge (Derek, 1 Nov 2026).
if [ -f "$art/beats.json" ] && [ "${#clips[@]}" -gt 1 ]; then
  ship_video_warning "the walkthrough kept its scene starts (beats.json) but ${#clips[@]} clips were filmed ($(for c in "${clips[@]}"; do printf '%s ' "${c#"$art/clips/"}"; done)): a beat recording is one clip, so the video is made without beats and its scenes are not held to their words"
fi
# Beat mode, when the walkthrough left its scene starts and filmed one clip.
starts=''
if [ -f "$art/beats.json" ] && [ "${#clips[@]}" = 1 ]; then
  # Two decimals each, so a start never reaches pr-video-beats.sh in exponent form.
  starts="$(jq -r --argjson len "${seconds:-0}" '
    if type == "array" and length >= 2 and length <= 40 and all(.[]; type == "number")
       and .[0] >= 0 and .[0] < 2 and .[-1] < $len
       and ([range(1; length) as $i | .[$i] > .[$i - 1]] | all)
    then map(. * 100 | round / 100 | tostring) | join(" ") else empty end' "$art/beats.json" 2>/dev/null || true)"
  [ -n "$starts" ] || echo "::warning::beats.json is not a list of scene starts inside the recording; making the video without beats"
fi
beat_seconds=''
if [ -n "$starts" ]; then
  beat_seconds="$(awk -v s="$starts" -v l="$seconds" 'BEGIN {
    k = split(s, a, " "); a[k + 1] = l
    for (i = 1; i <= k; i++) printf "%s%.2f", (i > 1 ? " " : ""), a[i + 1] - a[i] }')"
  echo "pr-video-publish: beat mode, $(wc -w <<<"$starts") scenes starting at $starts"
fi
# A walkthrough built with the motion kit leaves script.json beside beats.json: what each scene
# says, from the same lines it shows. Then those words are said and no model writes any.
scene_script=''
if [ -n "$starts" ] && [ -f "$art/script.json" ]; then
  scene_script="$art/script.json"
  echo "pr-video-publish: the walkthrough's scene script is said word for word, from the lines its scenes show"
fi
# Its stdout, the model's one log line included, is kept for the debug artifact.
# The review goes in as kinds and counts, never a finding's words.
PR_TITLE="$title" PR_BODY="$(cat "$work/body.md")" DIFFSTAT="$diffstat" CLIP_SECONDS="$seconds" \
  REVIEW_ROUND="$(count_of round)" REVIEW_FOUND="$(count_of found)" REVIEW_NOTES="$(count_of notes)" \
  BEAT_SECONDS="$beat_seconds" SCENE_SCRIPT="$scene_script" bash "$here/pr-video-script.sh" "$work/narration.txt" | tee "$work/model.log"
# The narration's word checks only warn (pr-video-script.sh), so its paragraphs
# may not match the scenes: then, or when the scenes cannot be put in step with
# the voice, the video is made without beats rather than not at all.
in_step=0
if [ -n "$starts" ]; then
  found="$(awk 'BEGIN { RS = "" } END { print NR }' "$work/narration.txt")"
  scenes="$(wc -w <<<"$starts" | tr -d ' ')"
  if [ "$found" != "$scenes" ]; then
    ship_video_warning "the narration has $found paragraphs for $scenes scenes, so the video is made without beats: the voice is not in step with the scenes"
  elif bash "$here/pr-video-beats.sh" "$work/clip.mp4" "$starts" "$work/narration.txt" \
    "$work/clip-beats.mp4" "$work/narration.wav"; then
    in_step=1
  else
    ship_video_warning "the scenes could not be put in step with the voice, so the video is made without beats"
  fi
fi
if [ "$in_step" = 1 ]; then
  # Each scene held for its own paragraph; its last scene is the review result's.
  bash "$here/pr-video-mux.sh" "$work/clip-beats.mp4" "$work/narration.wav" "$work/video.mp4"
else
  bash "$here/pr-video-narrate.sh" "$work/narration.txt" "$work/narration.wav"
  # The review card after the walkthrough, last: a tick and plain words with the
  # numbers in them, no model text, and not read aloud (the mux pads the voice
  # with silence to the picture).
  CARD_PASSED=true CARD_ROUND="$(count_of round)" CARD_FIXED="$(count_of fixed)" CARD_NOTES="$(count_of notes)" \
    bash "$here/pr-video-card.sh" "$work/clip.mp4" "$work/clip-card.mp4"
  bash "$here/pr-video-mux.sh" "$work/clip-card.mp4" "$work/narration.wav" "$work/video.mp4"
fi

# Listened to next, in a job of its own with no secret, before anything is
# hosted (pr-video-audio-gate.sh): the audio fills the picture, the voice is
# heard over the narration's length at a sane loudness, and it says the script.
probe="$(ffprobe -v error -show_entries stream=codec_type,codec_name \
  -show_entries format=duration,size -of default=nw=1:nk=0 "$work/video.mp4")" || {
  echo "::error::ffprobe could not read the finished video" >&2
  exit 1
}
summary="$(printf '%s\n' "$probe" | awk -F= '
  $1 == "codec_name" { codec[++n] = $2 }
  $1 == "codec_type" { kind[n] = $2 }
  $1 == "duration" { d = $2 }
  $1 == "size" { s = $2 }
  END {
    for (i = 1; i <= n; i++) printf "%s=%s ", kind[i], codec[i]
    printf "duration=%.1fs size=%d bytes", d, s
  }')"
echo "ffprobe: $summary"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '### Explainer video\n\n    ffprobe: %s\n' "$summary" >>"$GITHUB_STEP_SUMMARY"
fi

# What the gate and the upload need: the pull request, the commit, the passed
# review this video is bought for, and the summary the comment quotes.
jq -n --argjson pr "$pr" --arg sha "$sha" --arg review_run "$review_run" --arg summary "$summary" \
  '{pr: $pr, sha: $sha, review_run: $review_run, summary: $summary}' >"$work/made.json"
made_output true
echo "pr-video-publish: made the video for pull request $pr at $sha; the audio gate is next"
