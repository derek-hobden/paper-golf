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

## No prompts, and the session pings

- Sessions here run without permission prompts (fleet template, Derek, 1 Nov 2026). `.claude/settings.json` has
  no `ask` list: an allow list, and a deny list that is the only safety. Denied whatever you say: a push to
  main, master or production (`push-to-main.sh` included), a force push or a branch delete, every merge path
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
  path prompts even then. `scripts/claude-hooks/bot-ping.sh`, the PermissionRequest hook, answers what still
  prompts with "allow" in a cloud session (`BOT_AUTO_APPROVE=0` turns that off); deny rules are checked first.
  To change `.claude/` itself, stage the files outside any `.claude` path and copy them in with one Bash
  command whose text names no protected path (the fleet template's `bootstrap/install-claude-dir.sh`).
- The same hook pings the bot that owns the session on PermissionRequest, Notification (every wait and quota
  auto-resume), Stop, StopFailure, SessionEnd, SessionStart, PermissionDenied, Elicitation, and after a
  `git push` (`pushed`) or a pull request opened any way (`pr_opened`). One small JSON POST to
  `BOT_WEBHOOK_URL` with `Authorization: Bearer BOT_WEBHOOK_KEY` (https only, 5 s, always exit 0, prints
  nothing), with `waiting` and `kind` (`alert` or `info`) saying whether anyone has to act. The two variables
  live on the repo's Claude cloud environment, never in the repo; without them it sends nothing.
  `FACTORY_PING_URL` / `FACTORY_PING_KEY` are still read as a fallback. The note is up to 2,000 characters of
  the prompt, the command or the assistant's last message, so anything pasted into a session's last reply
  leaves with it: keep secrets out of what Claude says. Each send logs one line, the event and the HTTP status
  only, to `/tmp/bot-ping.log` (`BOT_PING_LOG`).
- GitHub pings the same bot for a bot's pull request (author `golf-gus-bot[bot]`, or a `claude/` branch — cloud
  sessions open pull requests as derek-hobden, so the branch is what marks them): opened, a failed `CI` or
  `Claude review` run, a review, a comment, inline review comments, closed without merging, a conflict with
  main or falling behind it (`.github/workflows/bot-ping-*.yml`), and every staging and production deploy
  (`deploy.yml`), through `scripts/ci/bot-event-ping.sh` and the repo's `BOT_WEBHOOK_URL` / `BOT_WEBHOOK_KEY`
  Actions secrets. They gate nothing (AGENTS.md "Guard rules").
- `scripts/factory/session-ping.sh` is no longer wired to any hook; it stays, with its tests, because the
  session-ping explainer walkthrough (`e2e/walkthroughs/session-ping.spec.ts`) still covers it.
