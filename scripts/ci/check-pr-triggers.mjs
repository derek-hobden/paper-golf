#!/usr/bin/env node
// Fails if a full code-check workflow re-runs on PR text edits.
// Rule: pull_request / pull_request_target `types` may include `edited` only in workflows listed in
// PR_TEXT_WORKFLOWS (small jobs that really read the PR title/body). Every other PR workflow must list
// exactly opened, synchronize, reopened, ready_for_review (or omit types and not run on edited).
// No dependencies: a tiny line scanner for the `on:` block, enough for normal workflow YAML.
import { readdirSync, readFileSync } from 'node:fs'
const DIR = process.argv[2] || '.github/workflows'
const PR_TEXT_WORKFLOWS = (process.env.PR_TEXT_WORKFLOWS || 'pr-text.yml').split(/[ ,]+/).filter(Boolean) // EDIT per repo
const problems = []
for (const f of readdirSync(DIR).filter((x) => /\.ya?ml$/.test(x))) {
  const src = readFileSync(`${DIR}/${f}`, 'utf8')
  const on = src.match(/^on:\s*\n([\s\S]*?)(?=^\S)/m)?.[1] ?? ''
  for (const ev of ['pull_request', 'pull_request_target']) {
    const block = on.match(new RegExp(`^  ${ev}:\\s*\\n((?:^    .*\\n|^\\s*\\n|^\\s*#.*\\n)*)`, 'm'))?.[1]
    if (block === undefined) continue
    // Both ways YAML writes a list: the flow form `types: [a, b]` and the block form `types:` then `- a` lines
    // (PR 109 review: the block form went unread, so `- edited` passed). Quotes around an item are dropped.
    const flow = block.match(/types:\s*\[([^\]]*)\]/)?.[1]?.split(',') ?? []
    const list = block.match(/^(\s*)types:\s*\n((?:\1\s+-.*\n?)*)/m)?.[2]?.split('\n').map((l) => l.replace(/^\s*-/, '')) ?? []
    const types = [...flow, ...list].map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    if (types.includes('edited') && !PR_TEXT_WORKFLOWS.includes(f))
      problems.push(`${f}: ${ev} runs on 'edited'; only PR-text workflows (${PR_TEXT_WORKFLOWS.join(', ')}) may. Use [opened, synchronize, reopened, ready_for_review].`)
  }
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
console.log('pr triggers ok')
