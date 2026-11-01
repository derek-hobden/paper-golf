#!/usr/bin/env bash
# Replay harness for .claude/hooks/no-main-without-pr.sh: pipes PreToolUse JSON
# into the hook and checks the exit code (2 = block, 0 = allow).
# Run: bash scripts/__tests__/no-main-without-pr.test.sh
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/../.." && pwd)/.claude/hooks/no-main-without-pr.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export DEFAULT_BRANCH=main
printf 'mutation { createCommitOnBranch(input:{branch:{repositoryNameWithOwner:"o/r", branchName:"main"}}) { commit { oid } } }' > "$T/commit-main.graphql"
printf 'mutation { createCommitOnBranch(input:{branch:{repositoryNameWithOwner:"o/r", branchName:"claude/x"}}) { commit { oid } } }' > "$T/commit-claude.graphql"
printf '{"query":"mutation { mergePullRequest(input:{pullRequestId:\\"X\\"}) { clientMutationId } }"}' > "$T/merge.json"
printf 'query { repository(owner:"o",name:"r") { defaultBranchRef { name } } }' > "$T/read.graphql"
pass=0 fail=0
bash_case() { run "$1" "$(jq -nc --arg c "$2" --arg d "$T" '{tool_name:"Bash",cwd:$d,tool_input:{command:$c}}')" "$2"; }
mcp_case()  { run "$1" "$(jq -nc --arg t "$2" --argjson i "$3" '{tool_name:$t,tool_input:$i}')" "$2 $3"; }
run() { local want=$1 json=$2 label=$3 got
  printf '%s' "$json" | bash "$HOOK" 2>/dev/null; got=$?
  if { [ "$want" = block ] && [ $got = 2 ]; } || { [ "$want" = allow ] && [ $got = 0 ]; }; then pass=$((pass+1)); echo "PASS $want: $label"
  else fail=$((fail+1)); echo "FAIL $want (exit $got): $label"; fi; }
B=block A=allow
# ---- gaps that must block ----
bash_case $B 'U=https://api.github.com/repos/o/r/pulls/5/merge; curl -X PUT -H "Authorization: token $T" $U'
bash_case $B 'C=curl; $C -X PUT https://api.github.com/repos/o/r/pulls/5/merge'
bash_case $B '$(which curl) -X PUT https://api.github.com/repos/o/r/pulls/5/merge'
bash_case $B 'sh -c "curl -X PUT https://api.github.com/repos/o/r/pulls/5/merge"'
bash_case $B "bash -c 'gh api -X PUT repos/o/r/pulls/5/merge'"
bash_case $B "eval 'curl -XPOST https://api.github.com/repos/o/r/merges -d {\"base\":\"main\",\"head\":\"claude/x\"}'"
bash_case $B '/usr/bin/curl -X PUT https://api.github.com/repos/o/r/pulls/5/merge'
bash_case $B '/usr/local/bin/gh api -X POST repos/o/r/merge-upstream -f branch=main'
bash_case $B 'gh api graphql -F query=@commit-main.graphql'
bash_case $B 'gh api graphql --input merge.json'
bash_case $B 'curl -X POST https://api.github.com/graphql -d @merge.json'
bash_case $B 'gh api graphql -f query="mutation { enablePullRequestAutoMerge(input:{pullRequestId:\"X\"}) { clientMutationId } }"'
bash_case $B 'gh api graphql -f query="mutation { updateRef(input:{refId:\"R\", oid:\"abc\"}) { ref { name } } }"'
bash_case $B 'curl -X DELETE https://api.github.com/repos/o/r/contents/README.md -d {"message":"x","sha":"abc"}'
bash_case $B 'curl -X DELETE https://api.github.com/repos/o/r/contents/README.md -d {"message":"x","sha":"abc","branch":"main"}'
bash_case $B 'gh api -X PUT repos/o/r/contents/a.txt -f message=x -f content=eA=='
bash_case $B 'gh api -X PUT repos/o/r/contents/a.txt -f message=x -f content=eA== -f branch=main'
bash_case $B 'curl -X PATCH https://api.github.com/repos/o/r/git/refs/heads/main -d {"sha":"abc"}'
bash_case $B 'wget --method=PATCH --body-data={"sha":"abc"} https://api.github.com/repos/o/r/git/refs/heads/master'
bash_case $B 'git push origin HEAD:main'
bash_case $B 'git push origin claude/x:refs/heads/main'
bash_case $B 'git push origin +claude/x:master'
bash_case $B 'git push origin main'
bash_case $B 'cd /tmp && /usr/bin/git push origin HEAD:main'
bash_case $B 'gh pr merge 5 --squash'
bash_case $B 'gh api repos/o/r/statuses/abc -f state=success'
bash_case $B 'gh api -f state=success repos/o/r/statuses/abc'
bash_case $B 'gh api --method POST repos/o/r/statuses/abc --input s.json'
bash_case $B 'curl -X POST https://api.github.com/repos/o/r/statuses/abc -d x'
bash_case $B 'curl -d {"state":"success"} https://api.github.com/repos/o/r/statuses/abc'
bash_case $B 'sh -c "curl --data x https://api.github.com/repos/o/r/statuses/abc"'
bash_case $B 'git push -f origin released'
bash_case $B 'git push --force origin HEAD:refs/tags/ci-green'
bash_case $B 'git push origin +abc:refs/tags/staging-green'
bash_case $B 'git -C . push origin +released'
bash_case $B 'bash scripts/ship/set-released-tag.sh abc'
bash_case $B 'sh -c "scripts/ci/move-ci-green.sh abc"'
bash_case $B '/repo/scripts/ship/vercel-deploy.sh --prod'
bash_case $B "bash -c '/abs/path/scripts/ci/move-ci-green.sh staging-green abc'"
mcp_case $B mcp__github__push_files '{"owner":"o","repo":"r","branch":"main","files":[],"message":"x"}'
mcp_case $B mcp__github__push_files '{"owner":"o","repo":"r","files":[],"message":"x"}'
mcp_case $B mcp__github__create_or_update_file '{"owner":"o","repo":"r","path":"a","content":"x","message":"x","branch":"main"}'
mcp_case $B mcp__github__create_or_update_file '{"owner":"o","repo":"r","path":"a","content":"x","message":"x"}'
mcp_case $B mcp__github__delete_file '{"owner":"o","repo":"r","path":"a","message":"x","branch":"master"}'
mcp_case $B mcp__cursor-github__merge_pull_request '{"owner":"o","repo":"r","pull_number":5}'
mcp_case $B mcp__github__update_ref '{"ref":"refs/heads/main","sha":"abc"}'
# ---- must pass ----
bash_case $A './scripts/release.sh v1.2.3'
bash_case $A 'bash scripts/release.sh'
bash_case $A 'gh release create v1.2.3 --notes x'
bash_case $A 'gh workflow run deploy.yml -f env=staging'
bash_case $A 'git push -u origin claude/fix-login'
bash_case $A 'git push origin HEAD:claude/x'
bash_case $A 'git push origin feature/main-menu'
bash_case $A 'git push origin claude/x:refs/heads/claude/x'
bash_case $A 'git push origin v1.2.3:refs/tags/v1.2.3'
bash_case $A 'gh pr create --base main --head claude/x --title t --body b'
bash_case $A 'gh pr view 5 --json state'
bash_case $A 'curl -s https://api.github.com/repos/o/r/pulls/5/merge'
bash_case $A 'gh api repos/o/r/contents/README.md'
bash_case $A 'gh api repos/o/r/git/refs/heads/main'
bash_case $A 'curl -X GET https://api.github.com/repos/o/r/contents/a.txt?ref=main'
bash_case $A 'gh api graphql -f query="query { repository(owner:\"o\",name:\"r\") { defaultBranchRef { name } } }"'
bash_case $A 'gh api graphql -F query=@read.graphql'
bash_case $A 'gh api -X PUT repos/o/r/contents/a.txt -f message=x -f content=eA== -f branch=claude/x'
bash_case $A 'curl -X PUT https://api.github.com/repos/o/r/contents/a.txt -d {"message":"x","content":"eA==","branch":"claude/x"}'
bash_case $A 'curl -X DELETE https://api.github.com/repos/o/r/contents/a.txt -d {"message":"x","sha":"abc","branch":"claude/x"}'
bash_case $A 'gh api graphql -F query=@commit-claude.graphql'
bash_case $A 'gh api -X POST repos/o/r/git/refs -f ref=refs/heads/claude/x -f sha=abc'
bash_case $A 'gh api -X POST repos/o/r/pulls -f title=t -f head=claude/x -f base=main'
bash_case $A 'echo $(date) && npm test'
bash_case $A 'gh api repos/o/r/statuses/abc'
bash_case $A 'gh api -X GET repos/o/r/commits/abc/statuses'
bash_case $A 'curl -s https://api.github.com/repos/o/r/statuses/abc'
bash_case $A 'gh api -X POST repos/o/r/deployments -f ref=main'
bash_case $A 'bash scripts/ship/release.sh --yes'
bash_case $A 'git push origin HEAD:claude/released-notes'
mcp_case $A mcp__github__push_files '{"owner":"o","repo":"r","branch":"claude/x","files":[],"message":"x"}'
mcp_case $A mcp__github__create_or_update_file '{"owner":"o","repo":"r","path":"a","content":"x","message":"x","branch":"claude/x"}'
mcp_case $A mcp__github__create_pull_request '{"owner":"o","repo":"r","head":"claude/x","base":"main","title":"t"}'
mcp_case $A mcp__github__get_file_contents '{"owner":"o","repo":"r","path":"a"}'
echo "cases: $((pass+fail))  pass: $pass  failures: $fail"
[ $fail = 0 ]
