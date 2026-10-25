#!/usr/bin/env bash
# Run gh as Golf Gus Bot (the GitHub App golf-gus-bot, installed on
# derek-hobden/paper-golf only). Mints an installation token — an RS256 JWT
# signed with openssl, then POST /app/installations/$ID/access_tokens — and
# execs gh with GH_TOKEN set to it, so a pull request is opened by
# golf-gus-bot[bot] and Derek can use the Approve button. Pushes stay on the
# existing credentials. The explainer video has nothing to do with this script:
# CI makes it and links it from the top of the body (AGENTS.md).
#
#   scripts/gh-as-gus.sh pr create ...
#
# Needs GOLF_GUS_APP_ID, GOLF_GUS_INSTALLATION_ID and GOLF_GUS_APP_KEY_B64
# (the app PEM, base64). The key and both tokens stay off argv.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,13p' "$0"; exit 0 ;; esac
[ $# -ge 1 ] || { echo "usage: scripts/gh-as-gus.sh <gh arguments...>" >&2; exit 2; }

gus_need() {
  # ${!1} is the value of the variable named by $1. A missing one is a hard
  # failure: this script never falls back to the PAT in GH_TOKEN.
  [ -n "${!1:-}" ] || { echo "golf-gus-bot: $1 is not set" >&2; exit 1; }
}
gus_need GOLF_GUS_APP_ID
gus_need GOLF_GUS_INSTALLATION_ID
gus_need GOLF_GUS_APP_KEY_B64
[[ "$GOLF_GUS_APP_ID" =~ ^[0-9]+$ ]] || { echo "golf-gus-bot: GOLF_GUS_APP_ID is not an app id" >&2; exit 1; }
[[ "$GOLF_GUS_INSTALLATION_ID" =~ ^[0-9]+$ ]] || {
  echo "golf-gus-bot: GOLF_GUS_INSTALLATION_ID is not an installation id" >&2
  exit 1
}

for tool in openssl curl jq gh; do
  command -v "$tool" >/dev/null 2>&1 || { echo "golf-gus-bot: $tool is required" >&2; exit 1; }
done

umask 077
key="$(mktemp)"
body="$(mktemp)"
trap 'rm -f "$key" "$body"' EXIT

if ! printf '%s' "$GOLF_GUS_APP_KEY_B64" | tr -d '[:space:]' | openssl base64 -d -A >"$key" 2>/dev/null; then
  echo "golf-gus-bot: GOLF_GUS_APP_KEY_B64 is not a base64 PEM" >&2
  exit 1
fi

# Base64url, no padding, no newline. The signature stays in the pipe: a NUL in
# the raw signature would be stripped by a command substitution.
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '=\n'; }
now="$(date +%s)"
iat="$((now - 60))"
exp="$((now + 540))"
header="$(printf '%s' '{"alg":"RS256","typ":"JWT"}' | b64url)"
payload="$(printf '{"iat":%s,"exp":%s,"iss":%s}' "$iat" "$exp" "$GOLF_GUS_APP_ID" | b64url)"
signing="${header}.${payload}"
if ! sig="$(printf '%s' "$signing" | openssl dgst -sha256 -sign "$key" | b64url)"; then
  echo "golf-gus-bot: could not sign the app JWT" >&2
  exit 1
fi
jwt="${signing}.${sig}"

api="https://api.github.com/app/installations/${GOLF_GUS_INSTALLATION_ID}/access_tokens"
if ! status="$(
  printf 'header = "Authorization: Bearer %s"\nheader = "Accept: application/vnd.github+json"\nheader = "X-GitHub-Api-Version: 2022-11-28"\nrequest = "POST"\nurl = "%s"\noutput = "%s"\nwrite-out = "%%{http_code}"\n' \
    "$jwt" "$api" "$body" |
    curl -sS --max-time 20 -K -
)"; then
  status=""
fi
if [ "$status" != 201 ]; then
  echo "golf-gus-bot: GitHub refused the installation token (HTTP ${status:-none})" >&2
  exit 1
fi
token="$(jq -r '.token // empty' "$body" 2>/dev/null || true)"
case "$token" in
  ghs_*)
    case "$token" in
      *[!A-Za-z0-9_]*) token="" ;;
    esac
    ;;
  *) token="" ;;
esac
if [ -z "$token" ]; then
  echo "golf-gus-bot: the installation response had no token" >&2
  exit 1
fi

rm -f "$key" "$body"
trap - EXIT
unset jwt sig GOLF_GUS_APP_KEY_B64
export GH_TOKEN="$token"
unset GITHUB_TOKEN token
exec gh "$@"
