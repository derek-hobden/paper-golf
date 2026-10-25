#!/usr/bin/env bash
# The browser playwright.config.ts's `chrome` project uses inside the official
# Playwright container: the image's own Chromium. CI used to take the runner's
# preinstalled Google Chrome and download WebKit next to it; the jobs now run in
# mcr.microsoft.com/playwright, which ships every browser and no branded Chrome,
# so nothing is installed and `playwright install` is gone from the workflows.
#
#   bash scripts/ship/container-chrome.sh >>"$GITHUB_ENV"
#
# Prints the one line CHROME_PATH=<executable>, which playwright.config.ts reads
# (CHROME_NO_SANDBOX=1, set by the job, turns off the sandbox Chromium cannot
# start as root in a container). Fails loudly if the image has no Chromium where
# Playwright says it is, rather than letting the suite fall back to a browser
# that is not there. AGENTS.md "Ship process".
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,15p' "$0"; exit 0 ;; esac

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

path="$(node --input-type=module -e 'import { chromium } from "playwright"; process.stdout.write(chromium.executablePath());')"
if [ -z "$path" ] || [ ! -x "$path" ]; then
  echo "::error::no Chromium in the image at '${path:-}' — is this job running in mcr.microsoft.com/playwright?" >&2
  exit 1
fi
echo "CHROME_PATH=$path"
