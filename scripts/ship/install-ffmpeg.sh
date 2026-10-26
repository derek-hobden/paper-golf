#!/usr/bin/env bash
# Puts ffmpeg and ffprobe on PATH for the PR video publish jobs, without apt.
#
#   bash scripts/ship/install-ffmpeg.sh          # install (a no-op when both are on PATH)
#   bash scripts/ship/install-ffmpeg.sh --key    # the actions/cache key: the pinned checksums
#
# ubuntu-latest has no ffmpeg, and `apt-get update && apt-get install ffmpeg`
# hung to the step's 5-minute limit in both attempts of PR video publish run
# 40350234858 (and in 40345686952 before it). So: one static Linux x86_64 build
# from one GitHub release at a fixed tag, each archive checked against its
# pinned SHA-256 before it is unpacked, and a mismatch fails the step.
#
# The archives are kept in FFMPEG_CACHE_DIR (the path the workflow caches with
# actions/cache, keyed on --key), and a cached archive is checked exactly like
# a fresh one. The binaries are unpacked into FFMPEG_BIN_DIR and that directory
# is added to GITHUB_PATH for the later steps.
#
# To bump the build: point FFMPEG_RELEASE at another fixed release tag (never
# latest), download both assets, and put their `sha256sum` in FFMPEG_SHA256 and
# FFPROBE_SHA256. The cache key follows the checksums on its own
# (docs/pipeline-rollout.md "ffmpeg for the explainer").
# Exit 0 when both tools are on PATH, 1 on a failed download or a mismatch, 2 on
# a usage error.
set -euo pipefail

# eugeneware/ffmpeg-static b6.0: FFmpeg 6.0 static (johnvansickle.com build,
# libx264 and aac), the build the ffmpeg-static npm package installs.
FFMPEG_RELEASE=https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0
FFMPEG_SHA256=17c1ae10b52ac499180679fe6ba77e17642390c4eedb0f1e3b0ac045da55128f
FFPROBE_SHA256=88ca6818d82a70e87de2bb6166026ad411528c72eda0e4e11ed25d185116ee17

cache="${FFMPEG_CACHE_DIR:-$HOME/.cache/pr-video-ffmpeg}"
bin="${FFMPEG_BIN_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/pr-video-ffmpeg}"

case "${1:-}" in
  --key) echo "pr-video-ffmpeg-$FFMPEG_SHA256-$FFPROBE_SHA256"; exit 0 ;;
  '') ;;
  *) echo "usage: install-ffmpeg.sh [--key]" >&2; exit 2 ;;
esac

if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  ffmpeg -version | head -n 1
  exit 0
fi

# fetch <tool> <sha256>: the verified archive in the cache, downloaded if missing.
fetch() {
  local name="$1-linux-x64.gz" want="$2" got
  local file="$cache/$name" url="$FFMPEG_RELEASE/$1-linux-x64.gz"
  if [ ! -f "$file" ]; then
    # Up to 3 retries, each attempt cut off rather than left to hang: two
    # archives at 4 attempts each stay inside the step's 5 minutes.
    curl --fail --silent --show-error --location --retry 3 --retry-delay 2 --retry-all-errors \
      --connect-timeout 10 --max-time 30 -o "$file.part" "$url" || {
      rm -f "$file.part"
      echo "::error::could not download $url" >&2
      exit 1
    }
    mv "$file.part" "$file"
  fi
  got="$(sha256sum "$file" | cut -d ' ' -f 1)"
  if [ "$got" != "$want" ]; then
    rm -f "$file"
    echo "::error::$name from $FFMPEG_RELEASE has SHA-256 $got, which does not match the pinned SHA-256 $want" \
      "(FFMPEG_SHA256 / FFPROBE_SHA256 in scripts/ship/install-ffmpeg.sh)" >&2
    exit 1
  fi
  gzip -dc "$file" >"$bin/$1"
  chmod +x "$bin/$1"
}

mkdir -p "$cache" "$bin"
fetch ffmpeg "$FFMPEG_SHA256"
fetch ffprobe "$FFPROBE_SHA256"

if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$bin" >>"$GITHUB_PATH"
else
  echo "add $bin to PATH" >&2
fi
"$bin/ffmpeg" -version | head -n 1
"$bin/ffprobe" -version | head -n 1
