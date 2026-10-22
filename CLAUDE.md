# Paper Golf — notes for agents

Vite + TypeScript static site (no framework, no WebGL). Read README.md for the game rules, layout and the
performance rules; they are binding.

## Verify (always, before saying "done")

```sh
npm install
npm run check    # typecheck (TS 7) → lint (ESLint, zero warnings) → vitest → production build
npm run smoke    # Playwright smoke test against `vite preview` (system Chrome); not part of check
npm run smoke:quick  # @quick Chrome tests only (start page + solo round); production's post-deploy check
```

- Every job's done-when runs the `verify-paper-golf` skill (`.claude/skills/verify-paper-golf/`, `npm run verify`): it must end `PASS`.
- Quote the `npm run check` output as evidence. CI (`.github/workflows/ci.yml`) runs the same on push to main.
- Node 22 (`.nvmrc`, `engines`). Pre-commit: husky (set up by `npm install` via `prepare`) runs `.husky/pre-commit`
  → lint-staged (`eslint --fix` on staged files). Don't bypass it with `--no-verify`.
- Type-check with `npm run typecheck`, not `npx tsc`: the root `typescript` package is 6.0 only because
  typescript-eslint needs its JS API; the app compiler is TS 7 (`node_modules/typescript7`).

## Architecture

- `src/engine/` — pure, deterministic rules: `rules.ts` (moves, terrain), `generator.ts` (60 seeded holes,
  validated solvable), `solver.ts` (expected Dice Golf strokes), `rng.ts`, `types.ts`. No DOM here.
- `src/game/game.ts` — pass-and-play state machine: turns, dice, mulligans, scoring. No DOM here.
- `src/ui/` — SVG board, 2D effects (die, ball, pencil), shot flight timing. `src/ui/layout.ts` fits the notebook to the
  screen (`layout()`: the mode classes, the score line's rows, the spiral, and the notebook's ResizeObserver; the board
  itself is sized by CSS, `src/style.css` "layout"), `src/boot.ts` restores the saved round and starts the cover or a
  `?play=` round, `src/main.ts` wires the screens to the game.
- `tests/` — vitest unit tests for engine, game flow and flight; `e2e/` — Playwright smoke test.
- `scripts/claude-review.mjs` — the pull-request reviewer. The workflow runs the copy on main. It calls the
  Anthropic Messages API and reads `CLAUDE.md`, `README.md` and `REVIEW.md` from that same commit.
- `scripts/ship/` — bash ship tooling (`check.sh`, PR risk `pr-risk.sh`, auto-merge `auto-merge.sh`,
  deploy-watch `wait-for-next-stage.sh`, `reconcile-ci.sh` (dispatches `ci.yml` for a main HEAD with no CI
  run), `retry.sh` (one more attempt, each under a hard timeout, for a deploy step that can hang; it talks on
  stderr so a step still reads the command's stdout), `container-chrome.sh` (the image's Chromium as
  `CHROME_PATH`), `deploy-summary.sh` (the Deploy run's one-line verdict),
  shared `lib.sh`, `review-status.sh` for the claude-review sticky comment (`explain` fails the check with the
  reason, `pass` and `blocked` refresh the comment and exit 0), deploy gate `deploy-gate.sh`, and `push-to-main.sh`, which is retired and refuses), tested by `scripts/ship/test-ship.sh`
  (fakes in `scripts/ship/test-fakes/`, temp local fixture repos), run from vitest by `tests/ship.test.ts`.
- `scripts/hooks/notify-bot.sh` — the session-event hook. `.claude/settings.json` runs it on `Stop`,
  `Notification` and `SessionEnd`; it POSTs `{session_id, remote_session_id, branch, event, event_id, event_at,
  cwd_repo, last_message}` to `$GROKBOT_EVENTS_URL` with the key from `$GROKBOT_EVENTS_KEY`, so the owning bot
  hears about a stop, a question or an ended session straight away and never polls. The URL and the key live in
  the environment only; neither is ever written in this repo. Tested by `tests/hooks.test.ts`.
- Logic belongs in `engine`/`game` with a unit test; keep `ui`/`main.ts` thin.

## Ship process

Origin is GitHub `derek-hobden/paper-golf` (private); the canonical checkout is `~/repos/paper-golf`. There are
**no tags at all**, and **every change is a pull request to main: nothing ever pushes to main**
(`scripts/ship/push-to-main.sh` is retired and only says so; branch protection refuses a direct push).

1. **Build and check** on your branch: `npm run check` and `npm run smoke`, committed.
2. **Open a pull request to main**: `git push -u origin HEAD`, then `gh pr create`. The body always
   includes a `## Spec` section with the original request and its done-criteria (start from
   `.github/pull_request_template.md`), except a `dependabot[bot]` dependency-only PR, whose spec is the
   section in `REVIEW.md`. On every PR `.github/workflows/ci.yml` runs `check` and `smoke`
   (the same jobs main runs), `.github/workflows/signoff.yml` runs `signoff`, and
   `.github/workflows/claude-review.yml` runs `claude-review`: the copy of `scripts/claude-review.mjs` on main
   calls the Anthropic Messages API, reads this file, README.md and REVIEW.md from main as the rules, reads that
   Spec, comments `BLOCKING:` or `NIT:` per finding, and the job fails on a blocking comment. `check`, `smoke`, `signoff` and `claude-review` are
   main's required checks. `signoff` is the one branch protection does not grow on its own: add it next to
   the other three (Settings → Branches → main). Do not require `mutation`.
3. **Auto-merge** is on for `risk:low` alone. The `claude-review` job labels `risk:low` or `risk:high` from
   `scripts/ship/pr-risk.sh`, and nothing more: GitHub's auto-merge is turned on from that label by
   `.github/workflows/auto-merge.yml` (`scripts/ship/auto-merge.sh`), which runs on `workflow_run` after the
   review, because the review job's `GITHUB_TOKEN` is read-only on a PR opened by Dependabot and the
   `enablePullRequestAutoMerge` mutation is refused there. That workflow reads the PR through `gh api` and never
   checks out or runs its head. Low needs the review green with no blocking comment, every check green, and a diff
   that touches no CI or deploy config (`.github/`, `vercel.json`, `scripts/ship/`, `playwright.config.ts`), no
   secrets or env vars, no auth or payment code, no dependency major bump, and under about 400 changed lines
   outside tests and lockfiles. Everything else is `risk:high` and waits for Derek's approval and merge in GitHub.
   **Signing off a risk:high PR.** Derek adds the `signed-off` label on the PR himself (the PR → Labels →
   `signed-off`; the signoff workflow creates the label). `signoff` passes for `risk:low` on its own. For
   `risk:high` it passes only when the issue events API shows the latest `signed-off` change is a `labeled`
   event by `derek-hobden`. A label added by anyone else, or a label that is present without that event, does
   not pass. Removing the label fails the check again. Adding the label re-runs signoff; it does not need a new push.
4. **The merge ships it**: on the push to main, `check` + `smoke` run again unless `scripts/ship/same-tree.sh`
   proves the merged tree is the head tree of a PR whose `check` and `smoke` already passed (any doubt runs
   the tests). **A merge GitHub makes itself raises no push event**, so auto-merge leaves main with no CI run
   and nothing to deploy (main d75953a, PR 22). `.github/workflows/reconcile-ci.yml` closes that hole: every 10
   minutes (and after the Auto-merge workflow) `scripts/ship/reconcile-ci.sh` asks whether main HEAD has a
   `ci.yml` run of its own — **only a push-event run on main counts**: a PR's run tested a branch, and the
   emergency dispatch's run carries main's tip as its `head_sha` while testing the older sha Derek confirmed,
   so neither proves the tip — and whether it has already dispatched one itself, which it knows from the
   `run-name` `ci.yml` gives that path (`CI reconcile dispatch of main HEAD`, against `CI production dispatch
   of <sha>` for the emergency one). Only when both are no does it dispatch `ci.yml` on main, which a
   `GITHUB_TOKEN` may do, unless the tip is younger than `RECONCILE_MIN_AGE_S` (2 minutes), in which case its own
   push run may simply not be listed yet and the next tick decides. After dispatching it waits (up to
   `RECONCILE_CONFIRM_S`, 30s) for GitHub to list the run it started, so the next tick — which cannot begin
   until this one ends — sees it and stands down. That **normal dispatch path** (the `ci.yml` dispatch on main with *no
   inputs*) runs the same pipeline as the push: `check`, `smoke`, then the same deploy. One dispatch per sha,
   and none at all on any doubt.
   Then `.github/workflows/deploy.yml` (triggered by that CI run completing on main)
   decides with `scripts/ship/deploy-gate.sh` whether it may deploy at all and which commit: the triggering CI
   run has to be `completed` with conclusion `success`, on `main`, in this repo, from a push or a dispatch,
   and its `deploy-request.json` has to name a full sha and that same event. On a push, and on the normal
   dispatch (`mode=reconcile`, gated exactly as a push because it stands in for one), it deploys exactly that
   run's `head_sha` (the request has to name it too), never main's tip, and only while that sha is still what
   main points at: a run whose commit main has moved past deploys nothing at all — the newer commit's own CI run
   deploys it (and the reconciler dispatches one for a newer commit that has none). Cancelled, skipped, failed and unfinished CI never deploys, and so does any doubt (a missing
   field, an unreadable request, a tip lookup that fails): a promote cannot be taken back, a deploy not taken is
   one merge away. The emergency dispatch (step 6) deploys the **request's** sha, not its run's `head_sha` —
   a `workflow_dispatch` run's `head_sha` is the tip of the ref it ran on, not the `sha=` input — and main's tip
   does not gate it, because a confirmed commit behind main is what that path is for (`resolve` has already
   proved the input is a commit on main). Then `staging` — that sha deployed to Vercel's preview target and aliased to
   `paper-golf-staging-derek-hobden.vercel.app`, smoked there with the full suite
   (`SMOKE_BASE_URL`, `npm run smoke`) — then `production`: the same sha promoted (`vercel deploy --prebuilt --prod`)
   and checked with the fast `@quick` Chrome smoke (`npm run smoke:quick`). Those `@quick` tests fail on any
   browser console error or uncaught page error, so a bad page rolls back. A red production smoke rolls Vercel
   back to the last good deployment, smokes that with the full suite, and fails the run. One deploy at a time;
   a newer commit already waiting is the one that deploys — and **only a deployable CI run (green, on main,
   from a push or a dispatch) enters the `paper-golf-deploy` concurrency group**: GitHub keeps one pending run
   per group, so runs whose jobs all skip used to replace the real deploy waiting there (PR 23, bd648a0, whose
   deploy was cancelled with no jobs). A PR's CI run does not reach deploy.yml at all (`branches: [main]` on
   the trigger), and any other run gets a group of its own. A staging, production or rollback failure opens a
   GitHub issue labelled `pipeline-failure` mentioning @derek-hobden. A red PR check does not. Whatever the
   run did, it ends with one line in its summary — `LIVE <url> <sha>` or `FAILED <job>`
   (`scripts/ship/deploy-summary.sh`, the `summary` job).
   **Nothing in the pipeline waits without a limit.** The jobs that run Playwright (ci.yml's `smoke`,
   deploy.yml's `staging` and `production`) run in `mcr.microsoft.com/playwright:v<the @playwright/test
   version in package-lock.json>-noble`, so no workflow installs a browser — the install hung for 15 and 19
   minutes in two deploy jobs on 22 Oct 2026 (run 39781080561) and has no step left to hang in. Every job has
   `timeout-minutes` (a deploy job at most 15), every long step has its own (the suite at most 8, a `vercel
   build` or `deploy` at most 6), and every `vercel` call runs through `scripts/ship/retry.sh`, which gives it
   one more attempt under a hard per-attempt timeout. The full suite runs once per job: a failing test is
   already retried by Playwright itself (`retries: 1` in CI).
   `bash scripts/ship/wait-for-next-stage.sh <sha> --from pushed` watches a merged sha through CI and Vercel.
5. **No previews**: no branch or PR deploys at all, by hand or in CI. To see a change running, `npm run dev`,
   `npm run smoke` or `npm run verify` locally.
6. **Emergency production path**: the `ci.yml` dispatch on `main` with `sha=<full sha>` and
   `confirm=deploy-production` (it runs `check` + `smoke` on that sha; deploy.yml then promotes it and skips
   staging) — only after Derek's explicit production yes for that exact change. Those two inputs are what
   tells this path from the normal dispatch in 4, which carries neither.
7. **Never spend money** (purchases, plan upgrades, new paid services) without Derek's yes.
8. **Flaky tests** get one automatic retry in CI (vitest and Playwright). A pass on that retry opens or updates
   a GitHub issue titled `flaky test: <name>` (label `flaky`). The test is not skipped or quarantined.
9. **Changed src needs a test.** `check` fails a PR that changes non-test `src/**` without also changing
   `tests/**`, `e2e/**` or a `*.test.ts` file. A PR that only touches docs, config or workflows is exempt, and so
   is `dependabot[bot]`.
10. **Changed-line coverage.** Vitest's v8 coverage of `src/engine` and `src/game` must cover at least 80% of the
    changed lines in those directories (statements only; comments and types do not count).
11. **Mutation testing** (Stryker, the `mutation` job) is advisory: it prints the score in the job summary and
    never fails the run. It becomes a blocking check after two weeks of scores, at a threshold chosen from that
    data. Do not add `mutation` to the required checks before then. `@stryker-mutator/vitest-runner` 10.0.0
    mis-filters Vitest 5 test names (stryker-js#6210), so a score from a run that hits that bug is not data to
    choose the threshold from; the two weeks start once the summary shows a score that is not flagged for it.
12. **Dependabot** (`.github/dependabot.yml`) opens one weekly PR per ecosystem for minor and patch updates
    (npm, github-actions). Major updates are their own PRs. `ANTHROPIC_API_KEY` has to exist as a Dependabot
    secret as well as an Actions secret, or the review job cannot run on those PRs.
13. **Weekly numbers.** Mondays 06:00 UTC, `.github/workflows/metrics.yml` writes deploys per day,
    merge-to-production time, failed release share and recovery time for the past week to one GitHub issue
    (label `pipeline-metrics`).

## PR explainer videos

A pull request's explainer video never goes in the repo. Record and narrate the mp4, push it **only** to a
throwaway branch `qa-video/<PR branch>`, let the bot upload it as a PR comment attachment, and put the
`https://github.com/user-attachments/assets/...` URL GitHub answers with on the **first line of the PR body** —
the very first thing at the very top, above the Spec. A product video (a trailer, a feature demo) committed
anywhere else in the repo is fine; this rule is only about the explainer for a pull request.

`.github/workflows/pr-video.yml` runs `scripts/ship/pr-video.sh` on every pull request (and on every edit of
the body) and fails one whose diff adds a `pr-explainer-*` `.mp4`, `.mov`, `.webm`, `.txt` or `.md` file,
anything under `qa-video/`, or anything under `docs/pr-videos/`, and one whose body does not open with that
link. Names and paths are matched case-insensitively (`pr-explainer-x.MP4` is an explainer), a renamed file
counts as an added one, and the link is accepted bare or wrapped as `<url>`, `[text](url)` or `![text](url)`,
which are the forms GitHub produces when a video is dropped into a comment. Dependabot and Renovate are exempt.
It is not a required check yet (Gus adds `pr-video` to branch protection).
`.github/pull_request_template.md` starts with the placeholder for that link.

## Rules

- TypeScript is strict with `noUncheckedIndexedAccess`; ESLint is typescript-eslint `strictTypeChecked`.
  Fix the code. Never add `eslint-disable`, `@ts-ignore`, `!` non-null assertions or silencing casts, and never
  loosen `tsconfig.json`, `eslint.config.js` or a test to get green.
- Cap test parallelism: keep vitest at `--maxWorkers=4` (as in `npm test`) and never run a test runner with its default
  worker count; at most 8 parallel workers in total.
- Reuse the checked-access primitives instead of inventing new ones: `itemAt`/`must` (`src/engine/assert.ts`),
  `gridAt` (`src/engine/grid.ts`), `byId`/`query` (`src/ui/dom.ts`), and `at`/`defined` (`tests/helpers.ts`).
- A gameplay rule decision that is not in Derek's words goes in the result as a question, not into the code.
- When you stop because you need a decision, end with the question as one clear line, the last line of the
  result: the Stop hook posts that line to the owning bot (`scripts/hooks/notify-bot.sh`), which answers it.
- **The repo is memory:** a mistake or bad pattern that happens twice becomes a check that fails — prefer
  structure/types, then a lint rule in `eslint.config.js`, then a test — committed with the fix, plus one row in
  the "Guard rules" table below (Rule | How enforced | Past bad commit).

## Guard rules

| Rule | How enforced | Past bad commit |
| --- | --- | --- |
| Strict types and lint are fixed in code: no `eslint-disable`, `@ts-ignore`, `!` assertions, silencing casts, or loosened config/tests | `tsconfig.json` strict + `noUncheckedIndexedAccess`, typescript-eslint `strictTypeChecked` with `--max-warnings 0`, run by `npm run check`, the lint-staged pre-commit hook and CI | - |
| typescript-eslint does not support TS 7's API yet: keep `typescript` at 6.0 for lint, `typescript7` for builds | `package.json` pins (`typescript` ~6.0, `typescript7` alias) | - |
| Nothing pushes to main: every change is a PR, `push-to-main.sh` only refuses (it holds no push, no refspec), and the deploy-watch reads only (GETs, token never in argv/output) | `scripts/ship/test-ship.sh` cases `push_to_main_retired`, `wait_*`, `check_*` (incl. shellcheck), run by `tests/ship.test.ts` in `npm test` | 9a22160, 6d21d8f (merges green on `npm run check` broke e2e; caught only by CI after main was pushed) |
| A ship test never pipes into `grep -q`: under `pipefail` that exits at the first hit and can SIGPIPE the writer, so a real match is counted as missing | `test-ship.sh` case `no_pipe_into_grep_q` (comments do not count), run by `tests/ship.test.ts` in `npm test` | 7ac1577 (the production job continues past its deploy step; `ci_no_branch_or_pr_preview_deploys` then dropped it, run 39479511977) |
| Every change is a pull request: `check`, `smoke`, `signoff` and `claude-review` run on every `pull_request` to main, under those names (the required checks). `check` and `smoke` are not gated by the event; a push skips them only when `same-tree.sh` proves that tree already passed | `test-ship.sh` cases `ci_triggers_pr_main_and_dispatch_only`, `ci_check_and_smoke_run_on_every_pr`, `ci_claude_review_on_every_pr`, `ci_signoff_on_risk_high`, `same_tree_*` | - |
| A risk:high PR is signed off only by derek-hobden adding the `signed-off` label (issue events API, not the label's presence). risk:low passes `signoff` on its own | `scripts/ship/signoff.sh`; `test-ship.sh` cases `signoff_*` and `ci_signoff_on_risk_high` | - |
| CI retries a failed test once (vitest and Playwright) and files `flaky test: <name>` when the retry passes. Tests are not skipped | `vite.config.ts` `retry`, `playwright.config.ts` `retries`, `scripts/ship/report-flaky.sh`; `test-ship.sh` cases `flaky_*` and `ci_flaky_retry` | - |
| A whole-course sweep is never one test: generating, solving or playing all 90 holes runs as one `it.each` case per hole or per course (`EVERY_HOLE`/`EVERY_COURSE` in `tests/sweep.ts`), because one case carrying the whole sweep spends tens of seconds against the 30s per-test timeout and times out on a loaded runner (v8 coverage and four workers roughly triple each test's wall clock) | `no-restricted-syntax` block for `tests/**/*.test.ts` in `eslint.config.js` (the generator or the solver called inside a test body under two nested iterations — loops, `map`/`flatMap`/`forEach`/`Array.from`; one level, `it.each` and module scope are allowed), run by `npm run lint` in `npm run check`, lint-staged and CI, and proved by `tests/sweepguard.test.ts` (it lints the three shapes that timed out, and the shapes the suite uses, through the real config); plus `tests/sweep.ts` with the `it.each` sweeps in `tests/proper.test.ts`, `tests/green.test.ts` and `tests/game.test.ts`, and `tests/proper.test.ts` "is the only round", which fails if `EVERY_HOLE` stops covering all 90 holes exactly once | f17f219 (#8 `game flow > plays every course...` and #9 `solver with the green and tap-ins > values every cup neighbour...` timed out at 30s on the first attempt, run 39491920577), 80bb620 (#17 `Proper golf course > keeps the same hole layouts (pinned seeds)`, run 39590662071) |
| A PR explainer video is never in the repo: no added `pr-explainer-*` `.mp4`/`.mov`/`.webm`/`.txt`/`.md`, nothing under `qa-video/` or `docs/pr-videos/`, and the PR body opens with the `github.com/user-attachments/assets/` link. A product video elsewhere is fine | `scripts/ship/pr-video.sh` in the `pr-video` job (`.github/workflows/pr-video.yml`); `test-ship.sh` cases `video_*` and `ci_pr_video_workflow` | - |
| A PR that changes non-test `src/**` also changes a test file, unless it is dependabot or only docs/config/workflows | `scripts/ship/test-touch.sh` in the `check` job; `test-ship.sh` cases `touch_*` | - |
| At least 80% of changed lines in `src/engine` and `src/game` are covered | `tests/diffcover.ts`, `scripts/ship/diff-cover.sh`, vitest v8 coverage in the `check` job; `tests/diffcover.test.ts` and `test-ship.sh` case `diff_cover_*` | - |
| Stryker on changed `src/engine` and `src/game` files is advisory and never fails the job | `scripts/ship/mutate.sh`, the `mutation` job (`continue-on-error`); `test-ship.sh` cases `mutate_*` and `ci_mutation_advisory` | - |
| Post-merge staging, production and rollback failures open a `pipeline-failure` issue mentioning @derek-hobden. PR check failures do not | `scripts/ship/pipeline-failure.sh` in `deploy.yml`; `test-ship.sh` case `ci_pipeline_failure_notifies` | - |
| Production's `@quick` smoke fails on a browser console error or an uncaught page error | `e2e/console.ts` `watchConsole`, `tests/quickconsole.test.ts`, `npm run smoke:quick` in the production job | - |
| Auto-merge takes `risk:low` only: the review green with no blocking comment, and a diff touching no CI/deploy config, secrets or env vars, auth or payment code, no dependency major bump, under ~400 changed lines outside tests and lockfiles | `scripts/ship/pr-risk.sh` with the `test-ship.sh` cases `risk_*` (one per rule, both verdicts); `ci_claude_review_on_every_pr` (the label, and that the job makes no `gh pr merge` call) | - |
| GitHub's auto-merge is turned on outside the review job, from the `risk:low` label alone and only with the review green: a `workflow_run` workflow with `contents: write` that reads the PR through `gh api` and never checks out or runs its head. A closed or merged PR is a no-op, and a refused mutation says which refusal it was instead of blaming the repo setting | `scripts/ship/auto-merge.sh`, `.github/workflows/auto-merge.yml`; `test-ship.sh` cases `auto_merge_*` and `ci_auto_merge_after_the_review` | 9f5ae88 (the review job ran `gh pr merge --auto --squash` with a token that may not: `Resource not accessible by integration (enablePullRequestAutoMerge)` on every Dependabot PR, e.g. PR 13 run 39659612854, under a warning that blamed Settings → Allow auto-merge) |
| Every commit on main gets a `ci.yml` run, so every merge deploys. Only a push-event run on main is main HEAD's own CI run (a PR's run tested a branch; the emergency dispatch's run carries the tip's `head_sha` but tested an older sha), and a main HEAD without one is dispatched exactly once — the reconciler's own dispatch is recognised by `ci.yml`'s `run-name`, a tip younger than 2 minutes waits a tick, and a dispatch waits for its own run to be listed before the next tick can begin, so it never dispatches twice. On doubt nothing is dispatched | `scripts/ship/reconcile-ci.sh`, `.github/workflows/reconcile-ci.yml`; `test-ship.sh` cases `reconcile_*` and `ci_reconcile_workflow` | d75953a (PR 22, auto-merged by GitHub with `GITHUB_TOKEN` on 22 Oct 2026: GitHub starts no push workflow for its own push, so main had no CI run and every Deploy run after it was skipped) |
| A CI run from `ci.yml`'s normal dispatch path (no inputs, main HEAD) is gated and deployed exactly like a push run — the commit CI proved, still main's tip, then staging, its smoke, production, its smoke and the rollback — and the emergency path (`sha` + `confirm=deploy-production`) stays production-only | `mode=reconcile` in `scripts/ship/deploy-gate.sh` and the `staging`/`production` gates in `deploy.yml`; `test-ship.sh` cases `deploy_gate_normal_dispatch_deploys_like_a_push`, `deploy_gate_stale_normal_dispatch_does_not`, `deploy_gate_push_request_carries_no_confirm` and `ci_dispatch_path_runs_the_push_pipeline` | - |
| Only a deployable CI run (green, on main, from a push or a dispatch) enters the `paper-golf-deploy` concurrency group; a PR's CI run never triggers deploy.yml, and every other run gets a group of its own. GitHub keeps one pending run per group | `branches: [main]` and the `concurrency.group` expression in `.github/workflows/deploy.yml`; `test-ship.sh` case `ci_deploy_group_only_for_main_ci_runs` and `tests/ship.test.ts` | bd648a0 (PR 23: a green main CI run whose Deploy runs were cancelled with no jobs, displaced in the group by the Deploy runs of PR-branch CI completions; production stayed on 1d12653) |
| There are no preview deploys: the only deploys are the staging deploy of main and the production promote, both gated to a push to main or the dispatch, never a branch or a PR | `test-ship.sh` case `ci_no_branch_or_pr_preview_deploys` (every job that runs `vercel deploy`, in every workflow) | - |
| One smoke suite, local or deployed: `SMOKE_BASE_URL` points the same specs at a deployment (with the Vercel SSO bypass header from `VERCEL_AUTOMATION_BYPASS_SECRET`), and unset it is `vite preview` exactly as before | `playwright.config.ts` (one `baseURL`, `webServer` only when it is unset); `test-ship.sh` cases `ci_staging_after_ci_on_push` and `ci_production_needs_staging_smoke` (the deploys smoke through it) | - |
| Production's post-deploy smoke is the fast `@quick` Chrome check (`npm run smoke:quick`: the start-page turn and the solo round); the PR smoke job and the staging smoke stay the full `npm run smoke`, and the rollback re-smokes with the full suite | `package.json` `smoke:quick`; `test-ship.sh` cases `ci_check_and_smoke_run_on_every_pr`, `ci_staging_after_ci_on_push` and `ci_production_needs_staging_smoke`; `tests/ship.test.ts` | - |
| `npm run smoke` never tests a stale `dist/`: it builds first | `package.json` `presmoke` (`npm run build`) | - |
| Paper Golf uses no tags: no ship script or workflow pushes, creates or triggers on a tag (a `refs/tags/*` refspec read as a production tag push by the gate) | `test-ship.sh` case `no_tags_in_ship_scripts_or_workflows` (greps `scripts/ship/*.sh` and `.github/workflows/*.yml`, fails while `mirror-to-github.sh` exists) and `ci_triggers_pr_main_and_dispatch_only` | bfbfb25 (`mirror-to-github.sh:118`, never on GitHub) |
| A Deploy run deploys only for a CI run that is completed, green, on main and in this repo, from a push, `ci.yml`'s normal dispatch or the confirmed dispatch. A push, and the normal dispatch that stands in for one (`mode=reconcile`, request carrying no confirm), deploy exactly that run's `head_sha` — never main's tip — and only while it is still main's tip; the confirmed dispatch deploys its request's confirmed sha, which is behind main by design, so its run's `head_sha` (the ref's tip) is never compared to it. Cancelled, skipped, failed and unfinished CI, and any doubt, deploy nothing | `scripts/ship/deploy-gate.sh` in `deploy.yml`'s `prepare` job, whose verdict `staging`, `production` and `notify` all need; `test-ship.sh` cases `deploy_gate_*` (one per rule) and `ci_deploy_only_after_a_green_ci_run`, run by `tests/ship.test.ts` in `npm test` | 76d9a5c (which added both `deploy.yml` and `deploy-batch.sh`: the only staleness guard counted queued Deploy runs, not commits, so on 22 Oct run 39744635505 promoted 48d5d48 to production while main was three commits on at fdb6b12, whose CI smoke was still running and then cancelled) |
| No workflow installs a browser: every job that runs the Playwright suite runs in `mcr.microsoft.com/playwright:v<the @playwright/test version in package-lock.json>-noble`, pinned to the lockfile, and takes the image's Chromium for the `chrome` project through `scripts/ship/container-chrome.sh` (`CHROME_PATH`, with `CHROME_NO_SANDBOX=1`, which the container needs as root) | `tests/workflows.test.ts` (every workflow, every job); `test-ship.sh` cases `ci_browsers_come_from_the_playwright_container`, `ci_smoke_timeout_has_headroom`, `ci_check_and_smoke_run_on_every_pr` and `container_chrome_*`, run by `tests/ship.test.ts` in `npm test` | run 39781080561 (`npx playwright install --with-deps webkit` hung 15m04s in staging and 18m45s in production, both cancelled by hand; the same step took 34s on the attempt that got through), fdb6b12 (main's smoke cancelled at the 10-minute limit after a 7m40s install, run 39743508384 attempt 1 — which is how the 22 Oct deploy gap came to be noticed), d029d4c (the same, at test 192 of ~210 after a 4m35s install, run 39757413720) |
| Every job in every workflow has `timeout-minutes` (a deploy job at most 15, nothing over 25), every long step has its own (the suite at most 8, a `vercel build` or `deploy` at most 6), and every `vercel` call goes through `scripts/ship/retry.sh` — one more attempt, each under a hard timeout, chatter on stderr so the step still reads the deploy URL | `tests/workflows.test.ts`; `test-ship.sh` cases `retry_*` and `ci_smoke_timeout_has_headroom` | run 39781080561 (one unbounded step held a deploy for 15 and 19 minutes under 20- and 30-minute job limits) |
| Every Deploy run ends with one line in its summary — `LIVE <url> <sha>`, `FAILED <job>` or `NO DEPLOY <why>` — and the `pipeline-failure` notify job stays next to it | `scripts/ship/deploy-summary.sh` and deploy.yml's `summary` job (`if: always()`); `test-ship.sh` cases `deploy_summary_*` and `ci_deploy_summary_and_notify`; `tests/workflows.test.ts` | - |
| Production is the merge pipeline, the normal dispatch of main HEAD or the confirmed dispatch, nothing else: no `--prod` outside the `production` job, which needs `check` + `smoke` and either the staging smoke green on a push or on that normal dispatch (`mode == 'reconcile'`, gated exactly as the push it stands in for) or `confirm == 'deploy-production'`; a production run is never cancelled; `VERCEL_TOKEN` only from the repo secret via env, never `--token`; Vercel CLI pinned exactly | `test-ship.sh` cases `ci_production_needs_staging_smoke`, `ci_dispatch_path_runs_the_push_pipeline`, `deploy_gate_normal_dispatch_deploys_like_a_push`, `ci_vercel_token_from_secret_env_only`, `ci_staging_after_ci_on_push` and `actionlint` | - |
| Phone tap targets are at least 44×44 CSS px, overlapping hit areas play the nearest marker, and the viewport allows pinch-zoom | `e2e/taptargets.spec.ts` (390x844 and 844x390, 1 and 4 players, isMobile, hasTouch) in `npm run smoke`; `tests/hit.test.ts` in `npm test` | 8de8d4a (17-26 px markers, `user-scalable=no`) |
| The start screen fits its card on short landscape phones: title, pill and buttons inside the green card, the footer over no button, no console errors | `e2e/landscapestart.spec.ts` (card, footer, 44 px, console) plus `e2e/fit.spec.ts` (overflow), in `npm run smoke` | 70a5443 (GOLF ran off the card, footer over "How to play" at 844x390) |
| The phone play screen fits Safari's visible viewport: the Roll button and tray fully inside `innerHeight` and `visualViewport.height` with no scrolling, the strip under the board spaced (`Hole 1 · Par 4 · Strokes 0/4 · Total 0`) and never clipped | `e2e/iphone.spec.ts` (`@webkit`, WebKit iPhone 14 at 390x664, 390x844 and 375x548) in `npm run smoke`; `e2e/fourplayer.spec.ts` | 93f049e (fixed 118px tray overflowed: Roll 9.8px under Safari's toolbar at 390x664; strip read "Par 4Strokes: /4Total:") |
| Multiplayer turns follow golf etiquette: honour on the tee (setup order on hole 1, then lowest previous score, ties by previous tee), then the ball furthest away in dots; re-rolls and mulligans never pass the turn; round-robin saves continue with whoever is away | `tests/turns.test.ts` in `npm test`; `e2e/turnorder.spec.ts` (Chrome, and WebKit iPhone 14 via `@webkit`, 3 players over two holes) in `npm run smoke` | - |
| The notebook look renders: every spiral loop resolves the `#coil` SVG symbol, evenly spaced, rising above the page edge; the desk is `src/assets/wood.webp` (served as WebP, under 150 KB, decoding), with no console errors | `e2e/look.spec.ts` (Chrome, and WebKit iPhone 14 via `@webkit`, 390x844 and 1440x900, cover and play screen) in `npm run smoke` | - |
| The wind pushes a hit its full vector and only the dot it ends on counts: never clamped at the edge or stopped early by water or trees; ending off the page, in water or in trees means the shot is not offered. A hit from the fairway is in the air over its aim, so a wind carries it on over trees there; water on the aim, trees on it from off the fairway, and every aim in a calm are unchanged (open questions, not decided) | `tests/windrule.test.ts` (the rule stated once, checked against `resolveShot` on ~250,000 seeded hits over all 90 holes; fails on 581f606, b2c6d1a, 1592349 and de40ff9), `tests/wind.test.ts` (applyWind), `tests/windbugs.test.ts` bugs 2, 3 and 4 plus "judged only by the dot it ends on" and "the wind carries a hit from the fairway on over trees at its aim" in `npm test`; `e2e/wind.spec.ts` `fix-*` cases in `npm run smoke` | de40ff9 (push stopped before trees: Lakeside hole 1, W 1, the N hit offered); fdb6b12 (main before this fix: trees on the aim stopped a fairway hit the wind carried off them — issue 1, Thunder Peaks hole 11, NE 1, the NE hit not offered) |
| The layout's ResizeObserver (on the notebook; the board itself is sized by CSS) never re-fits inside its own callback: it goes through `deferredObserver` in `src/ui/layout.ts` (skips unchanged sizes, re-fits on the next frame), so WebKit never raises "ResizeObserver loop completed with undelivered notifications" | `e2e/iphone.spec.ts` "no ResizeObserver loop" (WebKit iPhone 14 at 390x664 and 390x844, new round and `?play=3&players=1&hole=1`, full motion, late web fonts, zero page/console errors) in `npm run smoke` | eee1735 (tray and HUD observers called `layout()` synchronously: page error on every load at 390x664) |
| e2e tests tap board markers only through `tapMarker()` (`e2e/tap.ts`: waits for the marker, taps its hit circle's centre), never `click({ force: true })` or a `click()` on a `circle.hit`/`g.target` locator, because overlapping hit circles make `click()` hang on some die rolls | `no-restricted-syntax` block for `e2e/**/*.ts` in `eslint.config.js`, run by `npm run lint` in `npm run check`, lint-staged and CI | 40cd666 (`click({ force: true })`); 9a2f7ff (merge dropped `e2e/tap.ts` from 6d21d8f) |
| The iPhone WebKit project runs exactly the tests tagged `@webkit` (`{ tag: '@webkit' }` on the `test` or `test.describe`); `playwright.config.ts` lists no spec names for it | `iphone-webkit` project `grep: /@webkit/` in `playwright.config.ts`; `npx playwright test --list --project=iphone-webkit` | - (hand-synced `testMatch` list, audit item 4) |
| Every screen fits every phone and desktop size: every control and must-see box (HUD, chips, board, strip, die, hole card) inside `innerHeight`, `visualViewport` and the width, not cut off by the page or a sheet (scrolling a scrollable box is fine), no page overflow, no console or page errors; no known overflows remain, and a new one fails (no `fixme` entries) | `e2e/fit.spec.ts` (cover, setup, play before/after a roll, How to play, hole card, scorecard × 390x844, 390x664, 375x548, 844x390, 740x360, 1440x900 × 1 and 4 players × Chrome and WebKit iPhone 14 via `@webkit`) in `npm run smoke` | 04c7d2d (main on 17 Oct: 4-player chips wholly off the page at 390x664; hole-card buttons cut off by the page edge on narrow pages) |
| A HUD player chip reads on one line ("● Player 1 0"): its name and strokes never wrap onto a second line or run out of the chip | `e2e/fit.spec.ts` (every chip on every play and hole card case, Chrome and WebKit iPhone 14 via `@webkit`) in `npm run smoke` | e3d3a49 (main on 19 Oct: "Player 1" on two lines in WebKit at 390x664) |
| Every saved field has a guard, and every array and object in a save is checked per element: `loadState`/`isValidState` are built from `STATE_GUARDS` (`satisfies GuardTable<GameState>`); objects and arrays need a `Checked` guard that only `shape`/`arrayOf` (and `optional`/`nullable`/`orElse` around them) make, never a bare `Array.isArray` | Types: `GuardTable`/`FieldGuard` in `src/game/game.ts`, run by `npm run typecheck` (a `GameState` field without a guard, or `Array.isArray` for an array, fails); `tests/saveguards.test.ts` (one malformed case per guard, a coverage test over every `STATE_GUARDS` key, legacy and pre-wind saves, `expectTypeOf` checks) in `npm test` | 583a387 (balls checked as an array, not per element); `current`, `dice`, `holeDone`, `finished` never checked |
| Only a real round is saved: `saveGame` takes a `PersistedGame`, which only `newGame` and `loadState` return; a `?play=` round comes from `newLinkGame` (a plain `GameState`) and can never be saved or clear the save | Types (`saveGame(g: PersistedGame)` in `src/main.ts`), `tests/saveguards.test.ts` "only a saved round can be saved", `e2e/playlink.spec.ts` and `e2e/smoke.spec.ts` in `npm run smoke` | 223b814 (a `?play=` round overwrote the real save) |
| The verify doctor accepts Chrome on macOS and Linux: `CHROME_PATH` if set, then the macOS app, `/usr/bin/google-chrome`, then `google-chrome-stable` and `chromium` on `PATH`. WebKit may live in the macOS Library cache or `~/.cache/ms-playwright` | `scripts/verify.sh`; `test-ship.sh` case `verify_chrome_doctor` | - |
| The pull-request review calls the Anthropic Messages API. It does not use claude-code-action. The script and the rules are the copies on the base commit, and an API error is quoted on the sticky comment | `scripts/claude-review.mjs`; `test-ship.sh` cases `ci_claude_review_on_every_pr` and `review_status_api_error`; `tests/claude-review.test.ts` | 9f5ae88 (claude-code-action; every run failed, e.g. 39590742159, credit balance) |
| The sticky review-status comment is listed and created under the pull request (`issues/<pr>/comments`) but edited on its own path (`issues/comments/<id>`): the nested edit path is not a route. Every claude-review run refreshes that one comment, the blocking verdict included, and a run that cannot write it says so in plain English instead of leaking gh's `Not Found (HTTP 404)` | `scripts/ship/review-status.sh`; `test-ship.sh` cases `review_status_comment_endpoint`, `review_status_comment_created`, `review_status_comment_gone`, `review_status_comment_no_permission` and `review_status_blocked` | a9e82eb (`issues/${pr}/comments/${id}`: 404 on every run after the first, e.g. PR 10 run 39603791868; PR 15 kept the previous run's words, run 39603839014) |
| The session-event hook never blocks, fails or leaks a session: exit 0 and silence on every failure (no `$GROKBOT_EVENTS_URL` or `$GROKBOT_EVENTS_KEY`, no node or curl, unparsable hook JSON, a failing, refused or never-answering endpoint), a 5-second cap on the POST, the key in a curl config on stdin and never in argv, and nothing in the payload but the session's own fields | `scripts/hooks/notify-bot.sh`; `tests/hooks.test.ts` (the real script against a real localhost receiver: payload shape and header, the 1000-character cut, one id per event, each missing env var, the three failing endpoints, no env value in the payload, and the `.claude/settings.json` wiring) in `npm test` | - |
| qs stays on a patched release: `typed-rest-client` (under `@stryker-mutator/core`) pins `qs` exactly, so only the `overrides` entry in package.json holds it there, and a lockfile regenerated without that entry brings the vulnerable version back | `overrides` in `package.json`; `tests/deps.test.ts` (the override is declared, and every `qs` the lockfile resolves is at least the patched release) in `npm test` | - (Dependabot alert 1: qs 6.15.1, `qs.stringify` DoS GHSA-q8mj-m7cp-5q26) |
