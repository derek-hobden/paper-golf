// Parsing and scanning half of pre-push-scan.sh (see that file for the why).
//
// Reads the PreToolUse payload on stdin, splits tool_input.command into shell
// segments, follows `cd` and `git -C` to the checkout each `git push` acts on,
// and runs secretProblems (push-guards.mjs) over merge-base(origin/main, HEAD)..HEAD
// there: everything the branch adds since it left main. Exit 2 with the problems
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

/** The checkouts the command's `git push`es act on. */
function pushCheckouts(command, cwd) {
  const dirs = []
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
    if (words[i] === 'push') dirs.push(gitDir)
  }
  return dirs
}

/** What pushing from `dir` would publish that looks like a secret. */
function problemsIn(dir) {
  let top, base
  try {
    top = git(dir, 'rev-parse', '--show-toplevel')
    base = git(top, 'merge-base', 'origin/main', 'HEAD')
  } catch {
    return [] // not a repo, or no origin/main to compare with
  }
  const here = process.cwd()
  try {
    process.chdir(top) // push-guards runs git in the current directory
    return secretProblems(base, 'HEAD')
  } catch {
    return []
  } finally {
    process.chdir(here)
  }
}

try {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const payload = JSON.parse(input)
  const command = payload?.tool_input?.command
  if (payload?.tool_name === 'Bash' && typeof command === 'string') {
    const dirs = [...new Set(pushCheckouts(command, payload.cwd || process.cwd()))]
    const problems = dirs.flatMap(problemsIn)
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
