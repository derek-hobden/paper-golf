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
