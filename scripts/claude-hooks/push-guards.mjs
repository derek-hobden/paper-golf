// The secret scan pre-push-scan.mjs runs before a Claude session's `git push`.
//
// The fleet template's pre-push-scan.mjs (RuckBee PR 473) imports secretProblems
// from RuckBee's own push-guards.mjs, which the template does not carry, so this
// is Paper Golf's: Node builtins only (a cloud container has no node_modules),
// git run in the current directory, and one line per hit in the words the
// template's tests expect: `<file>:<line> looks like <a kind of secret>.`
//
// It reads only what the push would add: the `+` lines of `git diff base head`.
// A deleted file, a binary file and a removed line are not published by the push.

import { execFileSync } from 'node:child_process'

// AWS's own documentation key, which every scanner lets through.
const AWS_DOCS_KEY = 'AKIA' + 'IOSFODNN7' + 'EXAMPLE'

/** [what it looks like, the pattern]. Each pattern is a token, never a word in prose. */
const KINDS = [
  ['a GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g],
  ['an AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['a private key', new RegExp('-{5}BEGIN (?:[A-Z]+ )*PRIVATE KEY-{5}', 'g')],
  ['an Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['an OpenRouter API key', /\bsk-or-v1-[A-Za-z0-9]{32,}/g],
  ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
]

/** The kinds of secret one added line looks like (the AWS docs key is not one). */
export function secretKinds(line) {
  return KINDS.flatMap(([kind, re]) => {
    const hits = [...line.matchAll(re)].map((m) => m[0]).filter((hit) => hit !== AWS_DOCS_KEY)
    return hits.length > 0 ? [kind] : []
  })
}

/**
 * What `git diff base head` adds that looks like a secret, as
 * `<file>:<line> looks like <kind>.` lines. Throws when git does.
 */
export function secretProblems(base, head) {
  const diff = execFileSync(
    'git',
    ['diff', '--no-color', '--no-ext-diff', '--unified=0', '--no-renames', base, head],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 },
  )
  const problems = []
  let file = null
  let line = 0
  for (const text of diff.split('\n')) {
    if (text.startsWith('+++ ')) {
      file = text === '+++ /dev/null' ? null : text.replace(/^\+\+\+ b\//, '')
      continue
    }
    if (text.startsWith('--- ') || text.startsWith('diff --git ')) continue
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    if (hunk) {
      line = Number(hunk[1])
      continue
    }
    if (file === null || !text.startsWith('+')) continue
    for (const kind of secretKinds(text.slice(1))) problems.push(`${file}:${line} looks like ${kind}.`)
    line++
  }
  return problems
}
