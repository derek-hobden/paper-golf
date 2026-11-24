# Paper Golf — notes for Claude Code

The repo's rules live in one place, for whoever is working here, whatever they work with:

@AGENTS.md

Read that first and follow it. Only the Claude-specific bits are below.

## Claude Code only

- The done-when of every job is the `verify-paper-golf` skill (`.claude/skills/verify-paper-golf/`), which runs
  `npm run verify` and must end `PASS`. Other tools run `npm run verify` directly; it is the same check.
- Quote the `npm run check` output as evidence that it passed.
- A cloud session cannot mint a Golf Gus Bot installation token: Anthropic's GitHub proxy answers
  `403 Access to this GitHub API path is not permitted through this proxy` to
  `POST /app/installations/<id>/access_tokens`, so `scripts/gh-as-gus.sh` fails there with
  `GitHub refused the installation token (HTTP 403)`. Open the pull request on the credentials you have and say
  so in the body. Nothing else depends on it — CI makes the explainer video as the app, not as the session.
- `scripts/claude-review.mjs` is the pull-request reviewer. It reads `AGENTS.md`, `README.md` and `REVIEW.md`
  from the base commit as the rules; a change to those files changes what the review enforces.
- Review first, then the video (AGENTS.md "Paid jobs"). When the review asks for changes, the wake is the app's
  `<!-- pr-blocked -->` line: read the **Problems found** comment it links to, fix each problem, push, and wait —
  the push starts the next round. Do not mark the pull request ready again to get around it. After 3 rounds the
  automatic reviews stop and a person decides.
- The PR video is best effort and never a reason to hold a pull request (AGENTS.md "PR explainer videos", Derek,
  1 Nov 2026). Never re-run or remake a video to get a merge through: once the review has passed, `pr-video` is
  green whatever the video did, and a missing, failed or stale video is only a note in the step summary. If the
  video for your own pull request fails, say so in the result and ship anyway.

## Session model

- Every Claude Code session here runs on **Opus 5.5 at high effort** (Derek, 1 Nov 2026: "I want all Claude code
  sessions from now on to be opus 5.5 ... reliably 100% of the time", then 2 Nov 2026 11:08 Dubai: "We need to be on Opus 5.5 high not medium"). Launch a session with:

  ```sh
  env -u ANTHROPIC_API_KEY -u BOT_WEBHOOK_URL -u BOT_WEBHOOK_KEY -u FACTORY_PING_URL -u FACTORY_PING_KEY claude --model claude-opus-5-5 --effort high --permission-mode bypassPermissions
  ```

- `.claude/settings.json` pins it: `model` `claude-opus-5-5`, `effortLevel` `high`, `modelSettings` for that model
  with `effortLevel` `high`, and `env.CLAUDE_CODE_EFFORT_LEVEL` `high` (the env outranks `--effort` and the settings).
- The SessionStart hook `.claude/hooks/check-model-effort.sh` checks the model and the effort a session started
  on. On anything else it warns in the session; it sends nothing anywhere, never blocks and always exits 0.
  Tested by `tests/model-guard.test.ts` and `scripts/__tests__/check-model-effort.test.sh`.
- CI's own Claude calls are not sessions and stay on `claude-sonnet-5-5`: the review (`scripts/claude-review.mjs`)
  and the narration (`scripts/ship/pr-video-script.sh`). No workflow runs the claude CLI.

## No prompts, and no pings

- Sessions here run without permission prompts (fleet template, Derek, 1 Nov 2026). `.claude/settings.json` has
  no `ask` list: an allow list, and a deny list that is the only safety. Denied whatever you say: a `git push` to
  main, master or production (`push-to-main.sh` included), a force push or a branch delete, any `gh api` call on
  branch protection or rulesets (every other write to main, such as the contents API or the GitHub MCP file
  tools, meets main's branch protection, so a session may not change it), every merge path
  (`gh pr merge`, the merge and auto-merge API and GraphQL calls, the GitHub MCP merge and auto-merge tools),
  `vercel --prod`, `promote`, `rollback` and `alias` by hand, nuke-live, wipe-live and direct prod database
  commands, and reading or writing real `.env` files. Releases and live-data scripts are allowed (Derek,
  1 Nov 20:50 Dubai), and so is the emergency production dispatch — which still needs Derek's yes for that
  exact change (AGENTS.md "Ship process" 6). `AskUserQuestion` is denied: end the result with the question
  instead. Two PreToolUse guards in `.claude/hooks/` refuse a `git push` that would ship main without naming
  it, and an edit in a checkout that is on main; `scripts/claude-hooks/pre-push-scan.sh` refuses a push whose
  commits look like they carry a secret (a cloud container runs no git hooks: no `node_modules`, no
  `core.hooksPath`). `tests/claude-no-prompts.test.ts` pins all of it.
- A cloud session cannot run `bypassPermissions` (the UI shows "Accept edits"), and a write under any `.claude`
  path prompts even then. `scripts/claude-hooks/auto-approve.sh`, the PermissionRequest hook (fleet template),
  answers what still prompts with "allow", and **fails closed**: no or an empty `permissions.deny` approves
  nothing, a deny-list match or its built-in deny set (force pushes, repo/release deletes, secret reads, ...)
  approves nothing, and so does any error. `FACTORY_AUTO_APPROVE=0` (or `BOT_AUTO_APPROVE=0`) turns it off.
  Tested by `tests/fleet-hooks.test.ts` and `scripts/__tests__/*.test.sh`.
  To change `.claude/` itself, stage the files outside any `.claude` path and copy them in with one Bash
  command whose text names no protected path (the fleet template's `bootstrap/install-claude-dir.sh`).
- Nothing pings a bot (Derek, 14 Nov 2026: "Remove both: the Claude hooks and the GitHub PR/deploy pings"). No
  Claude Code hook and no workflow posts to a webhook: the hooks are the guards above, `auto-approve.sh` and the
  model check, and nothing else. `tests/claude-no-prompts.test.ts` pins that exact set of hooks, and
  `test-ship.sh` case `ci_no_bot_pings` keeps pings out of the workflows and `scripts/ci/`.
