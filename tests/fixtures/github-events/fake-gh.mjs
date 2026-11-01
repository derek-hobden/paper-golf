#!/usr/bin/env node
// A fake `gh` for the bot-ping workflow tests (tests/bot-gh-event-pings.test.ts)
// and their act simulation. `gh api [-X M] [--paginate] [--jq F] [-f k=v]... <path>`
// answers from the routes file named by $FAKE_GH_ROUTES ({"METHOD path": answer})
// and logs every call as one JSON line to $STUB/gh.log. Nothing leaves the machine.
//
// An answer is the response JSON, or {"__status": 422, "__body": {...}} for an
// HTTP error, or {"__sequence": [a, b, ...]} for one answer per call (the last
// one repeats). A GET with no route is a 404; a write with no route succeeds.
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const stub = process.env.STUB || '.'

if (args[0] !== 'api') {
  console.error(`fake gh: only "gh api" is stubbed, not "${args[0] ?? ''}"`)
  process.exit(2)
}

let method = null
let jq = null
let paginate = false
let path = null
const fields = []
for (let i = 1; i < args.length; i++) {
  const a = args[i]
  if (a === '-X' || a === '--method') method = args[++i]
  else if (a === '--jq' || a === '-q') jq = args[++i]
  else if (a === '--paginate') paginate = true
  else if (['-f', '-F', '--raw-field', '--field'].includes(a)) fields.push(args[++i])
  else if (a === '-H' || a === '--header') i++
  else if (a.startsWith('-')) {
    console.error(`fake gh: unknown flag ${a}`)
    process.exit(2)
  } else path = a
}
// Like gh: parameters without -X make the request a POST.
method = (method ?? (fields.length ? 'POST' : 'GET')).toUpperCase()

appendFileSync(
  join(stub, 'gh.log'),
  JSON.stringify({ method, path, fields, jq, paginate, token: process.env.GH_TOKEN ?? null }) +
    '\n',
)

const routesFile = process.env.FAKE_GH_ROUTES
const routes =
  routesFile && existsSync(routesFile) ? JSON.parse(readFileSync(routesFile, 'utf8')) : {}
const key = `${method} ${path}`
let answer = routes[key]

if (answer && Array.isArray(answer.__sequence)) {
  const countsFile = join(stub, 'gh.calls.json')
  const counts = existsSync(countsFile) ? JSON.parse(readFileSync(countsFile, 'utf8')) : {}
  const n = counts[key] ?? 0
  counts[key] = n + 1
  writeFileSync(countsFile, JSON.stringify(counts))
  answer = answer.__sequence[Math.min(n, answer.__sequence.length - 1)]
}

if (answer === undefined) {
  if (method === 'GET') {
    console.error('gh: Not Found (HTTP 404)')
    process.exit(1)
  }
  answer = {}
}

if (answer && typeof answer.__status === 'number') {
  process.stdout.write(JSON.stringify(answer.__body ?? {}) + '\n')
  console.error(`gh: ${answer.__body?.message ?? 'error'} (HTTP ${answer.__status})`)
  process.exit(1)
}

if (jq) {
  // gh prints a string result raw and anything else as JSON, like `jq -r`.
  const r = spawnSync('jq', ['-r', jq], { input: JSON.stringify(answer), encoding: 'utf8' })
  process.stdout.write(r.stdout ?? '')
  process.stderr.write(r.stderr ?? '')
  process.exit(r.status ?? 1)
}
process.stdout.write(JSON.stringify(answer, null, 2) + '\n')
