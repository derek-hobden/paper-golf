// Parsing half of block-push-from-main.sh (see that file for the why).
//
// Reads the PreToolUse payload on stdin, splits tool_input.command into shell
// segments, follows `cd` and `git -C` to the checkout each `git push` acts on,
// and works out where an implicit push goes. Exit 2 with the reason on stderr
// when that is main/master; exit 0 otherwise, including on any error.

import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const MAIN = /^(refs\/heads\/)?(main|master)$/
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const WRAPPERS = new Set(['command', 'time', 'nice', 'nohup'])
// git push options that take their value as the next word.
const PUSH_VALUE_OPTS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])

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

function git(dir, ...args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

const expand = (dir, p) => resolve(dir, p.replace(/^~(?=\/|$)/, homedir()))

/** The branch an implicit push sends to, or '' when it can't tell. */
function implicitDestination(dir) {
  const pushRef = git(dir, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{push}')
  if (pushRef) return pushRef.slice(pushRef.indexOf('/') + 1)
  return git(dir, 'branch', '--show-current')
}

/** Why this `git push` (args after `push`) implicitly ships main, or null. */
function implicitMainPush(args, dir) {
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--all' || a === '--mirror' || a === '--branches') {
      return `\`git push ${a}\` includes main`
    }
    if (PUSH_VALUE_OPTS.has(a)) i++
    else if (!a.startsWith('-')) positional.push(a)
  }
  const refspecs = positional.slice(1)
  if (refspecs.length === 0) {
    const dest = implicitDestination(dir)
    return MAIN.test(dest) ? `a push with no branch named goes to '${dest}' from ${dir}` : null
  }
  for (const spec of refspecs) {
    const src = spec.replace(/^\+/, '')
    if (src === 'HEAD' || src === '@') {
      const branch = git(dir, 'branch', '--show-current')
      if (MAIN.test(branch)) return `${src} is '${branch}' in ${dir}`
    }
  }
  return null
}

function check(command, cwd) {
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
    if (words[i] !== 'push') continue
    const reason = implicitMainPush(words.slice(i + 1), gitDir)
    if (reason) return reason
  }
  return null
}

try {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const payload = JSON.parse(input)
  const command = payload?.tool_input?.command
  if (payload?.tool_name === 'Bash' && typeof command === 'string') {
    const reason = check(command, payload.cwd || process.cwd())
    if (reason) {
      process.stderr.write(
        `🛑 Blocked: this git push would ship main (${reason}).\n` +
          'Nothing pushes to main in Paper Golf: every change is a pull request to main\n' +
          '(AGENTS.md, Ship process), and branch protection refuses a direct push.\n' +
          'Push your branch and open a pull request: git push -u origin <branch>.\n',
      )
      process.exit(2)
    }
  }
} catch {
  // Fail-soft: never wedge a command the guard can't reason about.
}
process.exit(0)
