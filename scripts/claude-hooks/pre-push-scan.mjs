// Parsing and scanning half of pre-push-scan.sh (see that file for the why).
//
// Reads the PreToolUse payload on stdin, splits tool_input.command into shell
// segments, follows `cd` and `git -C` to the checkout each `git push` acts on,
// works out what each push publishes (the branches and commits its refspecs name,
// HEAD for a bare push), and runs secretProblems (push-guards.mjs) over every
// commit each of those adds since it left origin/main. Exit 2 with the problems
// on stderr when it finds one; exit 0 otherwise, including on any error.

import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { secretProblems } from './push-guards.mjs'

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const WRAPPERS = new Set(['command', 'time', 'nice', 'nohup', 'env'])

/** Split a command into segments of words, honouring quotes and escapes. */
function segments(command) {
  const out = []
  let words = []
  let word = ''
  let inWord = false
  const endWord = () => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endSegment = () => {
    endWord()
    if (words.length) out.push(words)
    words = []
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (c === "'") {
      const end = command.indexOf("'", i + 1)
      word += command.slice(i + 1, end === -1 ? undefined : end)
      inWord = true
      i = end === -1 ? command.length : end
    } else if (c === '"') {
      let j = i + 1
      for (; j < command.length && command[j] !== '"'; j++) {
        if (command[j] === '\\' && j + 1 < command.length) j++
        word += command[j]
      }
      inWord = true
      i = j
    } else if (c === '\\' && i + 1 < command.length) {
      word += command[++i]
      inWord = true
    } else if (';&|()\n'.includes(c)) {
      endSegment()
    } else if (c === ' ' || c === '\t') {
      endWord()
    } else {
      word += c
      inWord = true
    }
  }
  endSegment()
  return out
}

const expand = (dir, p) => resolve(dir, p.replace(/^~(?=\/|$)/, homedir()))

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

// git push options that take their value as the next word.
const PUSH_VALUE_OPTS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])

/**
 * What one `git push` (its words after `push`) publishes: every local branch
 * (`--all`, `--branches`, `--mirror`, or a glob refspec), every tag (`--tags`),
 * and the source of each refspec it names (`src` of `src:dst`, a leading `+`
 * dropped). A bare push, or one naming only the remote, pushes HEAD. A delete
 * (`:dst`, `--delete`) and a negative refspec (`^x`) publish nothing.
 */
function pushSources(args) {
  const positional = []
  let all = false
  let tags = false
  let deleting = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--all' || a === '--branches' || a === '--mirror') all = true
    else if (a === '--tags') tags = true
    else if (a === '--delete' || a === '-d') deleting = true
    else if (PUSH_VALUE_OPTS.has(a)) i++
    else if (!a.startsWith('-')) positional.push(a)
  }
  const revs = []
  const refspecs = positional.slice(1)
  if (!deleting) {
    for (const spec of refspecs) {
      const s = spec.replace(/^\+/, '')
      if (s.startsWith('^')) continue
      const src = s.includes(':') ? s.slice(0, s.indexOf(':')) : s
      if (src === '') continue
      if (src.includes('*')) all = true
      else revs.push(src)
    }
    if (refspecs.length === 0 && !all && !tags) revs.push('HEAD')
  }
  return { all, tags, revs }
}

/** Each `git push` in the command: the checkout it acts on and what it publishes. */
function pushes(command, cwd) {
  const out = []
  let dir = cwd
  for (let words of segments(command)) {
    while (words.length && (ENV_ASSIGNMENT.test(words[0]) || WRAPPERS.has(words[0]))) {
      words = words.slice(1)
    }
    if (words[0] === 'cd') {
      dir = expand(dir, words[1] ?? homedir())
      continue
    }
    if (words[0] !== 'git') continue
    let gitDir = dir
    let i = 1
    for (; i < words.length && words[i].startsWith('-'); i++) {
      if (words[i] === '-C') gitDir = expand(gitDir, words[++i] ?? '.')
      else if (words[i] === '-c') i++
    }
    if (words[i] === 'push') out.push({ dir: gitDir, sources: pushSources(words.slice(i + 1)) })
  }
  return out
}

/** The commits a push's sources name in the checkout at `top`; one that does not resolve is left out. */
function sourceCommits(top, { all, tags, revs }) {
  const refs = [...revs]
  const list = (pattern) => {
    try {
      return git(top, 'for-each-ref', '--format=%(refname)', pattern).split('\n').filter(Boolean)
    } catch {
      return []
    }
  }
  if (all) refs.push(...list('refs/heads'))
  if (tags) refs.push(...list('refs/tags'))
  const commits = new Set()
  for (const ref of refs) {
    try {
      commits.add(git(top, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`))
    } catch {
      // git push would refuse an unknown source itself.
    }
  }
  return [...commits]
}

/** What a push from `dir` would publish that looks like a secret: every commit of every source since origin/main. */
function problemsIn({ dir, sources }) {
  let top
  try {
    top = git(dir, 'rev-parse', '--show-toplevel')
    git(top, 'rev-parse', '--verify', '--quiet', 'origin/main')
  } catch {
    return [] // not a repo, or no origin/main to compare with
  }
  const problems = []
  for (const commit of sourceCommits(top, sources)) {
    try {
      const base = git(top, 'merge-base', 'origin/main', commit)
      problems.push(...secretProblems(base, commit, top))
    } catch {
      // no history shared with origin/main: nothing this scan can compare
    }
  }
  return problems
}

try {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const payload = JSON.parse(input)
  const command = payload?.tool_input?.command
  if (payload?.tool_name === 'Bash' && typeof command === 'string') {
    const problems = [...new Set(pushes(command, payload.cwd || process.cwd()).flatMap(problemsIn))]
    if (problems.length) {
      process.stderr.write(
        '🛑 Blocked: this push would publish a secret (the pre-push secret scan, run by\n' +
          'scripts/claude-hooks/pre-push-scan.sh because git runs no pre-push hook here):\n' +
          problems.map((p) => `  ${p}\n`).join(''),
      )
      process.exit(2)
    }
  }
} catch {
  // Fail-soft: never wedge a command this hook cannot reason about.
}
process.exit(0)
