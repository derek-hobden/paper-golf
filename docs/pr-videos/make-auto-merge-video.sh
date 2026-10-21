#!/usr/bin/env bash
# Render the narrated explainer video for "Turn auto-merge on outside the review
# job" (PR 20) into docs/pr-videos/auto-merge-fix.mp4.
#
#   OPENROUTER_API_KEY=... bash docs/pr-videos/make-auto-merge-video.sh
#   bash docs/pr-videos/make-auto-merge-video.sh --script   # the narration, as markdown
#   bash docs/pr-videos/make-auto-merge-video.sh --slides   # the slides only, no voice
#
# One slide per section below: the narration is read by OpenRouter's
# google/gemini-3.8-flash-lite-tts in voice Kore (pcm, 24 kHz mono), the slide is
# drawn as HTML and shot with the Chromium Playwright already has, and ffmpeg
# cuts each slide to its own narration and joins them. Needs node (Playwright
# installed, i.e. after `npm install`), ffmpeg, curl and jq.
#
# The key is read from the environment and never printed; auto-merge-fix.narration.md
# is this script's own --script output, so the words only live here.
# It writes the video (and, with --slides, the slide pngs) inside docs/pr-videos/,
# plus a temp dir and one renderer under node_modules/.cache, both removed on exit.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,18p' "$0"; exit 0 ;; esac
mode="${1:-video}"
case "$mode" in video | --script | --slides) ;; *) echo "unknown argument: $1" >&2; exit 2 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
out="$here/auto-merge-fix.mp4"
if [ "$mode" = video ]; then
  : "${OPENROUTER_API_KEY:?set OPENROUTER_API_KEY (the voice is read by OpenRouter)}"
fi
if [ "$mode" != --script ]; then
  for tool in node ffmpeg curl jq; do
    command -v "$tool" >/dev/null 2>&1 || { echo "✗ $tool is required" >&2; exit 1; }
  done
fi

# title | body lines, separated by ; | narration
slides=(
  "Paper Golf · auto-merge|A green risk:low pull request sat waiting;Nobody had to merge it by hand;This is why, and what changed|Paper Golf merges its own low risk pull requests. Dependabot opens one every week, the review passes, every check goes green, and then nothing happens. Here is why, and what this change does about it."
  "The old failure|claude-review ran: gh pr merge --auto --squash;GraphQL: Resource not accessible by integration;(enablePullRequestAutoMerge);PR 13, run 39659612854|The review job itself tried to turn auto-merge on. On a pull request opened by Dependabot, that run gets a read-only token, so GitHub refused the mutation: resource not accessible by integration. You can see it on pull request thirteen."
  "The misleading warning|\"auto-merge is off for this repo;(Settings → General → Allow auto-merge)\";Auto-merge was never off. The token could not merge.|Worse, the step swallowed that refusal into a warning blaming the repository's auto-merge setting. That setting was never off. The token simply could not merge, so the log sent you looking in the wrong place."
  "The fix|claude-review labels risk:low or risk:high, and stops there;A new Auto-merge workflow runs on workflow_run;contents: write + pull-requests: write;It reads the pull request through gh api only|The label still comes from the review job, where the token can write it. The mutation moves into a new workflow that runs after the review, on workflow_run, so it gets the repository's own token with contents write and pull requests write. It never checks out or runs the pull request's head: it reads the pull request through the GitHub API and decides."
  "The decision|scripts/ship/auto-merge.sh;risk:low and the review green → auto-merge on;risk:high or unlabelled → off, as before;closed or merged → no write at all;a refusal is quoted with what it means|The decision is a small script, scripts slash ship slash auto dash merge. Risk low with a green review turns auto-merge on. Risk high, an unlabelled pull request, or a review that did not pass leaves it off, exactly as before. A closed or already merged pull request is a no-op: nothing is written at all. And when GitHub does refuse, the script quotes the refusal and says which one it was, the token or the repository setting."
  "The proof|Tests written first: 12 cases in test-ship.sh;npm run check green · 503 tests;Gate evidence in the pull request body;GitHub still waits for every required check|The tests came first: twelve cases covering every branch of that decision, run by npm test with the rest of the suite. The check command is green. And nothing here merges anything by itself. GitHub still waits for check, smoke, signoff and the review before it squashes."
)

tmp="$(mktemp -d)"
renderer=''
trap 'rm -rf "$tmp" "$renderer"' EXIT

# One wav per slide, from the narration. The model answers with base64 pcm.
say() { # say <text> <wav>
  local body resp
  body="$(jq -n --arg text "$1" '{
    model: "google/gemini-3.8-flash-lite-tts",
    modalities: ["audio"],
    audio: { voice: "Kore", format: "pcm" },
    messages: [{ role: "user", content: ("Read this, calmly and clearly: " + $text) }]
  }')"
  resp="$(curl -sS --max-time 180 https://openrouter.ai/api/v1/chat/completions \
    -H "Authorization: Bearer $OPENROUTER_API_KEY" \
    -H 'Content-Type: application/json' \
    -d "$body")"
  jq -re '.choices[0].message.audio.data' <<<"$resp" >"$tmp/b64" || {
    echo "✗ no audio came back:" >&2
    jq -r '.error.message // .' <<<"$resp" | head -5 >&2
    exit 1
  }
  base64 -d <"$tmp/b64" >"$tmp/raw.pcm"
  ffmpeg -nostdin -loglevel error -y -f s16le -ar 24000 -ac 1 -i "$tmp/raw.pcm" "$2"
}

# One 1280x720 png per slide, drawn as HTML in the notebook's own colours and
# shot with the Chromium that comes with Playwright. The program is written out
# rather than passed with -e: a `${...}` in it is JavaScript, not the shell's.
write_renderer() {
  # Inside the repo, so node resolves @playwright/test from its node_modules.
  renderer="$root/node_modules/.cache/pg-slide.mjs"
  mkdir -p "$(dirname "$renderer")"
  cat >"$renderer" <<'JS'
    import { chromium } from "@playwright/test";
    const title = process.env.SLIDE_TITLE ?? "";
    const body = (process.env.SLIDE_BODY ?? "").split(";").filter((s) => s !== "");
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<!doctype html><meta charset="utf-8"><style>
      html, body { margin: 0; height: 100%; }
      body { background: #f7f3e8; color: #23313a; display: flex; flex-direction: column;
        justify-content: center; gap: 34px; padding: 72px 88px; box-sizing: border-box;
        font: 400 30px/1.45 ui-sans-serif, system-ui, sans-serif; }
      h1 { font-size: 58px; line-height: 1.1; margin: 0; color: #1d6b3f; }
      hr { border: 0; border-top: 3px solid #1d6b3f; opacity: .35; margin: 0; width: 180px; }
      ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 20px; }
      li { padding-left: 42px; position: relative; }
      li::before { content: ""; position: absolute; left: 6px; top: .55em; width: 14px; height: 14px;
        border-radius: 50%; background: #1d6b3f; }
      code { font-family: ui-monospace, monospace; font-size: .95em; }
    </style><h1>${esc(title)}</h1><hr><ul>${body.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
    // CHROME_PATH wins, exactly as the chrome project in playwright.config.ts
    // reads it, so a machine with no Playwright Chromium can point at its own.
    const chromePath = process.env.CHROME_PATH;
    const launch = chromePath !== undefined && chromePath !== "" && !chromePath.endsWith(".app")
      ? { executablePath: chromePath }
      : {};
    const browser = await chromium.launch(launch);
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: process.env.SLIDE_PNG });
    await browser.close();
JS
}

shoot() { # shoot <title> <body lines, ;-separated> <png>
  SLIDE_TITLE="$1" SLIDE_BODY="$2" SLIDE_PNG="$3" node "$renderer"
}

cd "$root"
list="$tmp/parts.txt"
: >"$list"
i=0
[ "$mode" = --script ] || write_renderer

# --script: the narration as markdown, which is what auto-merge-fix.narration.md is.
if [ "$mode" = --script ]; then
  echo "# Auto-merge fix — explainer narration"
  echo
  echo "Voice: OpenRouter \`google/gemini-3.8-flash-lite-tts\`, voice **Kore** (pcm → wav → mp4)."
  echo "Rendered by \`bash docs/pr-videos/make-auto-merge-video.sh\`; this file is its \`--script\` output."
  echo
fi

for slide in "${slides[@]}"; do
  i=$((i + 1))
  title="${slide%%|*}"
  rest="${slide#*|}"
  body="${rest%%|*}"
  narration="${rest#*|}"
  if [ "$mode" = --script ]; then
    echo "## $i. $title"
    echo
    printf '%s\n' "$body" | tr ';' '\n' | sed 's/^/- /'
    echo
    echo "> $narration"
    echo
    continue
  fi
  echo "→ slide $i: $title"
  shoot "$title" "$body" "$tmp/slide$i.png"
  if [ "$mode" = --slides ]; then
    cp "$tmp/slide$i.png" "$here/slide$i.png"
    continue
  fi
  say "$narration" "$tmp/slide$i.wav"
  # The slide holds for exactly as long as its narration, plus a short beat.
  ffmpeg -nostdin -loglevel error -y -loop 1 -i "$tmp/slide$i.png" -i "$tmp/slide$i.wav" \
    -af "apad=pad_dur=0.6" -shortest -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p \
    -r 12 -c:a aac -b:a 96k "$tmp/part$i.mp4"
  printf "file '%s'\n" "$tmp/part$i.mp4" >>"$list"
done

case "$mode" in
  --script) exit 0 ;;
  --slides) echo "✓ $i slides in $here"; exit 0 ;;
esac

ffmpeg -nostdin -loglevel error -y -f concat -safe 0 -i "$list" -c copy "$out"
echo "✓ $out ($(du -h "$out" | cut -f1))"
