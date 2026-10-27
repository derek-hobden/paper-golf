#!/usr/bin/env bash
# Tests for scripts/factory/session-ping.sh, the hook that tells the bot owning a
# Claude Code cloud session that the session finished, asks a question, hit an
# error or ended. A fake curl on PATH (scripts/factory/test-fakes) records its
# argv, its stdin config and the posted JSON; a temp fixture repo gives the
# script a fixed origin and branch. No network, no real key, no real session id.
#
#   bash scripts/factory/test-session-ping.sh            # all cases
#   bash scripts/factory/test-session-ping.sh <case>     # one case (tests/session-ping.test.ts)
#   bash scripts/factory/test-session-ping.sh --list     # case names
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$dir/../.." && pwd)"
PING="$dir/session-ping.sh"
SETTINGS="$ROOT/.claude/settings.json"
# Fixtures live inside the repo (gitignored node_modules/.cache), as the ship
# tests' do: bot job hosts only allow git on paths inside their workspace.
TMP_ROOT="$ROOT/node_modules/.cache/pg-session-ping-test"
# Fixed fakes. The key is distinctive so a leak anywhere is easy to find.
FAKE_SESSION=cse_01FakeSession0001
FAKE_BARE=01FakeSession0001
FAKE_URL=https://ping.invalid/factory/hook
FAKE_KEY=fake-ping-key-3f9a1c7e
FIXTURE_REPO=acme/widgets
FIXTURE_BRANCH=feature/fixture
# The environment .claude/settings.json pins, and the Notification matcher.
ENV_ID=env_018rXWwWKQcidkjjtsCxfQaa
MATCHER='idle_prompt|permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input'

fail() {
  echo "FAIL: $*" >&2
  echo "--- stdout:" >&2
  printf '%s\n' "${out:-}" >&2
  echo "--- stderr:" >&2
  printf '%s\n' "${err:-}" >&2
  if [ -s "${FAKE_DIR:-/nonexistent}/payload.json" ]; then
    echo "--- payload:" >&2
    cat "$FAKE_DIR/payload.json" >&2
    echo >&2
  fi
  exit 1
}

setup() {
  mkdir -p "$TMP_ROOT"
  T="$(mktemp -d "$TMP_ROOT/case.XXXXXX")"
  export FAKE_DIR="$T/fake"
  mkdir -p "$FAKE_DIR"
  export PATH="$dir/test-fakes:$PATH"
  unset FACTORY_PING_DEBUG FAKE_CURL_FAIL FAKE_CURL_SLEEP FAKE_CURL_CODE \
    GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
  export CLAUDE_CODE_REMOTE_SESSION_ID="$FAKE_SESSION" FACTORY_PING_URL="$FAKE_URL" FACTORY_PING_KEY="$FAKE_KEY"
  # A repo with a fixed origin and one empty commit on a fixed branch.
  REPO="$T/repo"
  git init -q -b "$FIXTURE_BRANCH" "$REPO"
  git -C "$REPO" remote add origin "https://github.com/$FIXTURE_REPO.git"
  local commit
  commit="$(GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t \
    git -C "$REPO" commit-tree -m fixture "$(git -C "$REPO" hash-object -t tree -w --stdin </dev/null)")"
  git -C "$REPO" update-ref "refs/heads/$FIXTURE_BRANCH" "$commit"
  printf '{}' >"$T/hook.json"
}

# ping <event> [note]: run the hook from the fixture repo with $T/hook.json on
# stdin. Leaves $out, $err and $status.
ping() {
  status=0
  (cd "$REPO" && bash "$PING" "$@" <"$T/hook.json" >"$T/stdout" 2>"$T/stderr") || status=$?
  out="$(cat "$T/stdout")"
  err="$(cat "$T/stderr")"
  [ "$status" = 0 ] || fail "exit $status, want 0"
}

# hook <json>: the hook JSON the next ping reads on stdin.
hook() { printf '%s' "$1" >"$T/hook.json"; }

# A transcript in $T/transcript.jsonl, one JSON entry per argument.
transcript() {
  : >"$T/transcript.jsonl"
  local line
  for line; do printf '%s\n' "$line" >>"$T/transcript.jsonl"; done
}

# An assistant transcript entry whose only content is one text block.
said() {
  python3 -c 'import json,sys; print(json.dumps({"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":sys.argv[1]}]}}))' "$1"
}

posted() { [ -s "$FAKE_DIR/payload.json" ] || fail "nothing was posted"; }
not_posted() { [ ! -e "$FAKE_DIR/curl.argv" ] || fail "curl was called"; }

# field <name>: one field of the posted JSON.
field() {
  posted
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$FAKE_DIR/payload.json" "$1"
}
is() {
  local got
  got="$(field "$1")"
  [ "$got" = "$2" ] || fail "$1 is '$got', want '$2'"
}

# --- reason: done, question, error, ended ------------------------------------

# 1
t_stop_plain_finished_text_is_done() {
  hook "{\"hook_event_name\":\"Stop\",\"last_assistant_message\":\"Pushed the branch and opened the pull request. All checks are green.\"}"
  ping Stop
  is reason "done"
  is hook_event Stop
  is note "Pushed the branch and opened the pull request. All checks are green."
  is session_id "$FAKE_BARE"
  is session_url "https://claude.ai/code/session_$FAKE_BARE"
  is repo "$FIXTURE_REPO"
  is branch "$FIXTURE_BRANCH"
}

# 2
t_stop_transcript_question_before_a_trailing_tool_use() {
  local q='The tests pass on the probe branch. Should I open the pull request to main now?'
  transcript \
    '{"type":"user","message":{"role":"user","content":"Run the probe."}}' \
    "$(said "$q")" \
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"true"}}]}}'
  hook "{\"hook_event_name\":\"Stop\",\"transcript_path\":\"$T/transcript.jsonl\"}"
  ping Stop
  is reason question
  is note "$q"
}

# 3
t_stop_asking_without_a_question_mark_is_done() {
  hook '{"hook_event_name":"Stop","last_assistant_message":"Tell me which branch you want next and I will carry on."}'
  ping Stop
  is reason "done"
}

# 4
t_stop_question_mark_before_markdown_is_a_question() {
  hook '{"hook_event_name":"Stop","last_assistant_message":"The build is green.\n\n**Merge it now?**"}'
  ping Stop
  is reason question
  is note "**Merge it now?**"
}

# 5
t_stop_prefers_last_assistant_message_to_the_transcript() {
  transcript "$(said 'Everything is finished and pushed.')"
  hook "{\"hook_event_name\":\"Stop\",\"transcript_path\":\"$T/transcript.jsonl\",\"last_assistant_message\":\"Which of the two fixes do you want?\"}"
  ping Stop
  is reason question
  is note "Which of the two fixes do you want?"
}

# 6
t_stop_rhetorical_question_early_in_a_long_message_is_done() {
  hook '{"hook_event_name":"Stop","last_assistant_message":"Why did the smoke test fail? A stale build.\n\nI rebuilt and re-ran it.\n\nAll 211 tests pass.\n\nThe pull request is ready."}'
  ping Stop
  is reason "done"
}

# 7
t_stop_question_mark_only_in_a_url_is_done() {
  hook '{"hook_event_name":"Stop","last_assistant_message":"Done. The run is at https://example.invalid/runs?id=42&page=2 for reference."}'
  ping Stop
  is reason "done"
}

# 8
t_notification_is_a_question() {
  hook '{"hook_event_name":"Notification","message":"Claude needs your permission to use Bash","notification_type":"permission_prompt"}'
  ping Notification
  is reason question
  is note "Claude needs your permission to use Bash"
}

# 9
t_manual_error_is_an_error() {
  ping manual-error "the build broke"
  is reason error
  is hook_event manual-error
  is note "the build broke"
}

# 10
t_stop_failure_is_an_error() {
  hook '{"hook_event_name":"StopFailure","error":"rate_limit"}'
  ping StopFailure
  is reason error
  is note rate_limit
}

# 11
t_session_end_carries_its_reason() {
  hook '{"hook_event_name":"SessionEnd","reason":"prompt_input_exit"}'
  ping SessionEnd
  is reason ended:prompt_input_exit
}

# --- never in the way --------------------------------------------------------

# 12
t_malformed_hook_json_still_posts() {
  hook 'this is {not json'
  ping Stop
  is reason "done"
  is hook_event Stop
}

# 13
t_outside_a_cloud_session_it_stays_quiet() {
  unset CLAUDE_CODE_REMOTE_SESSION_ID
  export FACTORY_PING_DEBUG=1
  ping Stop
  not_posted
  [ "$err" = "session-ping: skipped (not a cloud session)" ] || fail "debug line"
  [ -z "$out" ] || fail "stdout not empty"
}

# 14
t_without_the_key_it_stays_quiet() {
  unset FACTORY_PING_KEY
  export FACTORY_PING_DEBUG=1
  ping Stop
  not_posted
  [ "$err" = "session-ping: skipped (env not set)" ] || fail "debug line"
}

# 15
t_a_missing_transcript_is_fine() {
  hook "{\"hook_event_name\":\"Stop\",\"transcript_path\":\"$T/no-such-transcript.jsonl\"}"
  ping Stop
  is reason "done"
}

# 16
t_a_failing_curl_never_fails_the_hook() {
  export FAKE_CURL_FAIL=1 FAKE_CURL_SLEEP=1 FACTORY_PING_DEBUG=1
  ping Stop
  posted
  # --max-time 5, as two consecutive arguments.
  [ "$(awk 'p { print; exit } $0 == "--max-time" { p = 1 }' "$FAKE_DIR/curl.argv")" = 5 ] ||
    fail "no --max-time 5 in curl argv"
  case "$err" in "session-ping: http "*) ;; *) fail "debug line" ;; esac
}

# 17
t_without_debug_it_prints_nothing() {
  hook '{"hook_event_name":"Stop","last_assistant_message":"Done."}'
  ping Stop
  posted
  [ -z "$out" ] || fail "stdout not empty"
  [ -z "$err" ] || fail "stderr not empty"
  # And with debug on, one line and nothing else.
  export FACTORY_PING_DEBUG=1
  ping Stop
  [ -z "$out" ] || fail "stdout not empty with debug"
  [ "$err" = "session-ping: http 200" ] || fail "debug line"
}

# --- guards ------------------------------------------------------------------

# 18
t_the_key_never_leaves_the_curl_config() {
  export FACTORY_PING_DEBUG=1
  hook "{\"hook_event_name\":\"Stop\",\"last_assistant_message\":\"Should I go on?\"}"
  ping Stop
  posted
  grep -qF -- "$FAKE_KEY" "$FAKE_DIR/curl.argv" && fail "the key is in curl argv"
  grep -qF -- "$FAKE_KEY" "$FAKE_DIR/payload.json" && fail "the key is in the payload"
  case "$out$err" in *"$FAKE_KEY"* | *"$FAKE_URL"*) fail "the key or the URL was printed" ;; esac
  grep -qxF -- "header = \"Authorization: Bearer $FAKE_KEY\"" "$FAKE_DIR/curl.config" ||
    fail "the bearer is not in the stdin config"
  grep -qx -- -K "$FAKE_DIR/curl.argv" || fail "curl is not reading its config from stdin"
  grep -qxF -- "$FAKE_URL" "$FAKE_DIR/curl.argv" || fail "curl was not given the ping URL"
  # Same for every way out of the script: skipped, failing, erroring.
  unset CLAUDE_CODE_REMOTE_SESSION_ID
  ping Stop
  case "$out$err" in *"$FAKE_KEY"*) fail "the key was printed when skipped" ;; esac
  export CLAUDE_CODE_REMOTE_SESSION_ID="$FAKE_SESSION" FAKE_CURL_FAIL=1
  ping manual-error oops
  case "$out$err" in *"$FAKE_KEY"*) fail "the key was printed when curl failed" ;; esac
}

# 19
t_settings_pin_the_environment_and_the_four_hooks() {
  python3 - "$SETTINGS" "$ENV_ID" "$MATCHER" <<'PY' || fail ".claude/settings.json"
import json, sys
path, env_id, matcher = sys.argv[1:]
s = json.load(open(path))
assert s["remote"]["defaultEnvironmentId"] == env_id, "remote.defaultEnvironmentId"
hooks = s["hooks"]
assert sorted(hooks) == ["Notification", "SessionEnd", "Stop", "StopFailure"], sorted(hooks)
for event, groups in hooks.items():
    assert len(groups) == 1, event
    group = groups[0]
    if event == "Notification":
        assert group.get("matcher") == matcher, "Notification matcher"
    else:
        assert "matcher" not in group, event + " has a matcher"
    (h,) = group["hooks"]
    assert h["type"] == "command", event
    assert h["timeout"] == 10, event + " timeout"
    want = 'bash "$CLAUDE_PROJECT_DIR/scripts/factory/session-ping.sh" ' + event
    assert h["command"] == want, event + ": " + h["command"]
PY
}

cases="$(declare -F | sed -n 's/^declare -f t_//p')"
case "${1:-}" in
  --list) printf '%s\n' "$cases"; exit 0 ;;
  '') ;;
  *)
    grep -qx -- "$1" <<<"$cases" || { echo "no such case: $1" >&2; exit 2; }
    setup
    "t_$1"
    rm -rf "$T"
    echo "ok $1"
    exit 0 ;;
esac
failed=0
n=0
for c in $cases; do
  n=$((n + 1))
  # Each case in its own process, so set -e and the env stay per case.
  if res="$(bash "$0" "$c" 2>&1 </dev/null)"; then
    echo "ok $c"
  else
    echo "not ok $c"
    printf '%s\n' "$res" | sed 's/^/  /'
    failed=$((failed + 1))
  fi
done
echo "$((n - failed))/$n passed"
[ "$failed" = 0 ]
