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

## Session pings

- When a Claude Code cloud session here stops, asks a question, errors or ends, the hooks in `.claude/settings.json`
  run `scripts/factory/session-ping.sh`, which POSTs one small JSON signal (session, repo, branch, event, a reason
  of `done`, `question`, `error` or `ended:<reason>`, and a short note) to the factory webhook, so the bot that owns
  the session hears about it. It always exits 0 and gives curl 5 s, so it never holds up a session.
- It only sends from a Claude cloud session (`CLAUDE_CODE_REMOTE_SESSION_ID` set) and needs two environment
  variables on the repo's Claude cloud environment, never in the repo: `FACTORY_PING_URL` and `FACTORY_PING_KEY`.
  Missing either, it does nothing. `FACTORY_PING_DEBUG=1` prints one line: `session-ping: http NNN` or
  `session-ping: skipped (...)`.
