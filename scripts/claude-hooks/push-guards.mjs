// The secret scan pre-push-scan.mjs runs before a Claude session's `git push`.
//
// The fleet template's pre-push-scan.mjs (RuckBee PR 473) imports secretProblems
// from RuckBee's own push-guards.mjs, which the template does not carry, so this
// is Paper Golf's: Node builtins only (a cloud container has no node_modules),
// and one line per hit in the words the template's tests expect:
// `<file>:<line> looks like <a kind of secret>. (commit <sha>)`
//
// It reads what every commit in base..head adds, one commit at a time, not the
// net diff between the two trees: a token one commit adds and a later commit
// removes is still in the history the push publishes (PR 109 review). A merge
// commit is read as what its resolution added over git's own automatic merge
// (`--diff-merges=remerge`), so a clean merge of main brings in nothing of
// main's to flag, and a token typed into a conflict resolution is still seen.
// A deleted file, a binary file and a removed line publish nothing new.

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
 * What the commits in base..head add that looks like a secret, as
 * `<file>:<line> looks like <kind>. (commit <sha>)` lines, in the checkout at
 * `cwd`. Throws when git does.
 */
export function secretProblems(base, head, cwd = process.cwd()) {
  const log = execFileSync(
    'git',
    [
      'log',
      '-p',
      '--no-color',
      '--no-ext-diff',
      '--unified=0',
      '--no-renames',
      '--diff-merges=remerge',
      '--format=%x00%h',
      `${base}..${head}`,
    ],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 },
  )
  const problems = new Set()
  let commit = ''
  let file = null
  let line = 0
  // A file's header runs from `diff --git` to its first hunk: a `+++ ` there names the
  // file, and anywhere after it is an added line that happens to start with `++`.
  let inHeader = false
  for (const text of log.split('\n')) {
    if (text.startsWith('\0')) {
      commit = text.slice(1)
      file = null
      inHeader = false
      continue
    }
    if (text.startsWith('diff --git ')) {
      file = null
      inHeader = true
      continue
    }
    if (inHeader) {
      if (text.startsWith('+++ ')) file = text === '+++ /dev/null' ? null : text.replace(/^\+\+\+ b\//, '')
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
      if (hunk) {
        line = Number(hunk[1])
        inHeader = false
      }
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    if (hunk) {
      line = Number(hunk[1])
      continue
    }
    if (file === null || !text.startsWith('+')) continue
    for (const kind of secretKinds(text.slice(1))) problems.add(`${file}:${line} looks like ${kind}. (commit ${commit})`)
    line++
  }
  return [...problems]
}
