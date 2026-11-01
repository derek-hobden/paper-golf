#!/usr/bin/env bash
# PreToolUse guard for Derek's rule (1 Nov 21:14 Dubai): "code must go through PRs".
# Closes gaps the text-matching deny rules in settings.json miss: curl via a
# variable, sh -c / bash -c / eval wrappers, /usr/bin/curl full paths, graphql
# bodies read from files, contents DELETE, git push refspecs to the default
# branch, and GitHub MCP write tools aimed at main/default.
# Exit 2 = block (reason on stderr). Exit 0 = allow. Needs bash + jq.
set -uo pipefail
payload=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
tool=$(jq -r '.tool_name // empty' <<<"$payload")
cwd=$(jq -r '.cwd // empty' <<<"$payload"); [ -n "$cwd" ] && [ -d "$cwd" ] && cd "$cwd"

default_branch() {
  [ -n "${DEFAULT_BRANCH:-}" ] && { echo "$DEFAULT_BRANCH"; return; }
  local r; r=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null) && { echo "${r#refs/remotes/origin/}"; return; }
  echo main
}
DEF=$(default_branch)
is_protected() { local b="${1#refs/heads/}"; b="${b#heads/}"; [ "$b" = main ] || [ "$b" = master ] || [ "$b" = "$DEF" ]; }
block() { echo "BLOCKED by no-main-without-pr: $1. Code must go through a PR (push a claude/ branch, gh pr create; merges stay with Derek/owning bot)." >&2; exit 2; }

# ---------- MCP ----------
if [[ "$tool" == mcp__* ]]; then
  if [[ "$tool" =~ (push_files|create_or_update_file|delete_file|merge_pull_request|update_ref|create_commit) ]]; then
    [[ "$tool" =~ merge_pull_request ]] && block "$tool merges a PR from the session"
    br=$(jq -r '.tool_input.branch // .tool_input.ref // empty' <<<"$payload")
    [ -z "$br" ] && block "$tool with no branch writes to the default branch ($DEF)"
    is_protected "$br" && block "$tool writes to $br"
  fi
  exit 0
fi
[ "$tool" = Bash ] || exit 0
cmd=$(jq -r '.tool_input.command // empty' <<<"$payload")
[ -z "$cmd" ] && exit 0

# ---------- normalise ----------
# a $VAR or $(...) in program position is suspicious (checked after expansion below)
# 1. expand simple VAR=value assignments made in the same command
declare -A V
while IFS= read -r a; do
  k=${a%%=*}; v=${a#*=}; v=${v#\"}; v=${v%\"}; v=${v#\'}; v=${v%\'}; V[$k]=$v
done < <(grep -oE "(^|[[:space:];&|(])(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=(\"[^\"]*\"|'[^']*'|[^[:space:];&|]*)" <<<"$cmd" | sed -E 's/^[[:space:];&|(]*(export[[:space:]]+)?//')
n=$cmd
for _ in 1 2 3; do
  for k in "${!V[@]}"; do n=${n//"\${$k}"/${V[$k]}}; n=$(sed -E "s/\\\$$k([^A-Za-z0-9_]|\$)/$(printf '%s' "${V[$k]}" | sed 's/[\/&]/\\&/g')\\1/g" <<<"$n"); done
done
# 2. unwrap sh -c / bash -c / eval and drop quotes (strings become plain words)
n=$(sed -E 's/(^|[[:space:];&|(])((ba|z|da)?sh|eval)([[:space:]]+-[a-z]*c)?[[:space:]]+/\1 /g; s/[\\]?["'"'"'`]/ /g' <<<"$n")
# 3. strip full paths on programs (/usr/bin/curl -> curl)
n=$(sed -E 's#(^|[[:space:];&|(])(/[^[:space:]/]+)*/(curl|wget|gh|git|http|xh)([[:space:]]|$)#\1\3\4#g' <<<"$n")

# program position = start, or after ; & | ( or sh -c / eval
grep -qE '(^|[;&|(]|\b(sh|bash|eval)( -c)?)[[:space:]]*\$(\(|\{?[A-Za-z_])' <<<"$n" && block "program is an unresolved \$VAR or \$(...) substitution"
http_write_check() { # $1=segment text (method/data already known to be write)
  local s="$1" body="$1" f
  # pull in files referenced as bodies: @file, --input file, -T file, --post-file file
  for f in $(grep -oE '(@|--input[[:space:]]+|--post-file[=[:space:]]+|-T[[:space:]]+|--upload-file[[:space:]]+)[^[:space:]]+' <<<"$s" | sed -E 's/^(@|--input[[:space:]]+|--post-file[=[:space:]]+|-T[[:space:]]+|--upload-file[[:space:]]+)//'); do
    f=${f#*@}; [ -f "$f" ] && body+=" $(tr '\n"' '  ' < "$f")"
  done
  grep -qE 'statuses/' <<<"$s" && block "commit-status write (could forge staging/CI green)"
  grep -qE 'pulls/[^/[:space:]]+/merge|/merges([^a-z]|$)|merge-upstream' <<<"$s" && block "API merge/merge-upstream write"
  grep -qE 'mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest' <<<"$body" && block "graphql merge mutation"
  local target=0
  grep -qE 'git/refs|contents/' <<<"$s" && target=1
  grep -qE 'createCommitOnBranch|updateRef|updateRefs|createRef' <<<"$body" && target=1
  [ $target = 1 ] || return 0
  # gather named branches
  local names
  names=$( { grep -oE 'git/refs/heads/[^[:space:]?]+' <<<"$s" | sed 's#git/refs/heads/##'
             grep -oE '[?&](ref|branch)=[^[:space:]&]+' <<<"$s" | sed -E 's/^.[a-z]+=//'
             grep -oE '(branch|branchName|ref|qualifiedName)[[:space:]]*[:=][[:space:]]*\\?[^[:space:],}\\)]+' <<<"$body" | sed -E 's/^[A-Za-z]+[[:space:]]*[:=][[:space:]]*\\?//'
             grep -oE 'refs/heads/[^[:space:],}\\)]+' <<<"$body" | sed 's#refs/heads/##'; } | sed 's#^refs/heads/##' | grep -v '^\$' )
  [ -z "$names" ] && block "contents/ref/graphql write naming no branch (= default branch $DEF)"
  local b; while read -r b; do is_protected "$b" && block "write to $b via API"; done <<<"$names"
  return 0
}

check_segment() {
  local seg="$1"; local -a t; read -ra t <<<"$seg"; [ ${#t[@]} -eq 0 ] && return
  local i=0
  while [ $i -lt ${#t[@]} ] && [[ "${t[$i]}" =~ ^[A-Za-z_][A-Za-z0-9_]*=|^(export|env|command|exec|time|nohup|timeout|xargs)$|^[0-9]+[smh]?$ ]]; do i=$((i+1)); done
  local p=${t[$i]:-}; [ -z "$p" ] && return
  [[ "$p" == \$* ]] && block "program is an unresolved variable/substitution ($p)"
  case "$p" in
    curl|wget|http|xh|gh)
      if [ "$p" = gh ] && [ "${t[$((i+1))]:-}" != api ]; then
        [ "${t[$((i+1))]:-} ${t[$((i+2))]:-}" = "pr merge" ] && block "gh pr merge"
        return
      fi
      local write=0 m
      m=$(grep -oE '(-X|--request|--method)[[:space:]=]*[A-Za-z]+|-X[A-Za-z]+' <<<"$seg" | sed -E 's/^(-X|--request|--method)[[:space:]=]*//' | tr a-z A-Z | tail -1)
      if [ -n "$m" ]; then [ "$m" != GET ] && [ "$m" != HEAD ] && write=1
      elif grep -qE '(^|[[:space:]])(-d|--data[a-z-]*|-f|-F|--field|--raw-field|--form|--input|-T|--upload-file|--post-data|--post-file|--body-data|--body-file)([[:space:]=]|$)|(^|[[:space:]])-d[^[:space:]]' <<<"$seg"; then write=1; fi
      if [ $write = 1 ]; then
        grep -qE '(^|[[:space:]])\$' <<<"${t[*]:$((i+1))}" && grep -qvE 'https?://|repos/|graphql' <<<"$seg" && block "$p write whose URL is an unresolved variable/substitution"
        http_write_check "$seg"
      fi ;;
    git)
      local j=$((i+1))
      while [ $j -lt ${#t[@]} ] && [[ "${t[$j]}" == -* ]]; do [[ "${t[$j]}" =~ ^-(C|c)$ ]] && j=$((j+1)); j=$((j+1)); done
      [ "${t[$j]:-}" = push ] || return
      local -a pos=(); j=$((j+1))
      while [ $j -lt ${#t[@]} ]; do
        case "${t[$j]}" in --repo|-o|--push-option|--receive-pack) j=$((j+1));; -*) ;; *) pos+=("${t[$j]}");; esac; j=$((j+1)); done
      local cur; cur=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
      if [ ${#pos[@]} -le 1 ]; then [ -n "$cur" ] && is_protected "$cur" && block "git push from $cur (pushes to $cur)"; return; fi
      local r dst
      for r in "${pos[@]:1}"; do
        r=${r#+}; dst=${r##*:}; [ "$dst" = HEAD ] && dst=$cur
        case "${dst#refs/tags/}" in released|ci-green|staging-green) block "push of release-gate tag $dst ($r)";; esac
        case "${dst#refs/heads/}" in released|ci-green|staging-green) block "push of release-gate ref $dst ($r)";; esac
        [[ "$dst" == refs/tags/* ]] && continue
        [ -z "$dst" ] && continue
        is_protected "$dst" && block "git push to $dst ($r)"
      done ;;
  esac
}

grep -qE '(^|[^A-Za-z0-9_-])(set-released-tag|move-ci-green|vercel-deploy)\.sh' <<<"$n" && block "release-gate script (set-released-tag/move-ci-green/vercel-deploy) is owner-only"
while IFS= read -r seg; do check_segment "$seg"; done < <(sed -E 's/(\&\&|\|\||;|\||&)/\n/g; s/\$\(/\n/g; s/`/\n/g' <<<"$n")
exit 0
