# Paper Golf — the repo's rules

The one place the rules live, for whoever is working here: a person hand-coding, Claude Code, Codex, Cursor,
anything else. Nothing here needs a particular tool or a personal API key. (`CLAUDE.md` points at this file.)

Vite + TypeScript static site (no framework, no WebGL). Read README.md for the game rules, layout and the
performance rules; they are binding.

## Verify (always, before saying "done")

```sh
npm install
npm run check    # typecheck (TS 7) → lint (ESLint, zero warnings) → vitest → production build
npm run smoke    # Playwright smoke test against `vite preview` (system Chrome); not part of check
npm run smoke:quick  # @quick Chrome tests only (start page + solo round); production's post-deploy check
```

- Every job's done-when runs `npm run verify` (the doctor, the suite and a real browser): it must end `PASS`.
- Quote the `npm run check` output as evidence. CI (`.github/workflows/ci.yml`) runs the same on push to main.
- Node 22 (`.nvmrc`, `engines`). Pre-commit: husky (set up by `npm install` via `prepare`) runs `.husky/pre-commit`
  → lint-staged (`eslint --fix` on staged files). Don't bypass it with `--no-verify`.
- Type-check with `npm run typecheck`, not `npx tsc`: the root `typescript` package is 6.0 only because
  typescript-eslint needs its JS API; the app compiler is TS 7 (`node_modules/typescript7`).

## Architecture

- `src/engine/` — pure, deterministic rules: `rules.ts` (moves, terrain), `generator.ts` (60 seeded holes,
  validated solvable), `solver.ts` (expected Dice Golf strokes, and `finishableCells`: the cells a hole can be holed
  out from, judged by the shots the rules offer), `rng.ts`, `types.ts`, `holeid.ts` (a hole's id in the
  library: `b:<course>:<number>`, `s:<key>`). No DOM here.
- `src/game/game.ts` — pass-and-play state machine: turns, dice, mulligans, scoring. No DOM here. `src/game/guards.ts`
  is the guard kit every saved shape is built from, and `src/game/library.ts` the saved holes and custom courses kept
  on the device (`paper-golf:library:v1`), with the lookups the screens draw.
- `src/ui/` — SVG board, 2D effects (die, ball, pencil), shot flight timing, `library.ts` (My holes & courses, the
  course editor and the shared hole picker). `src/ui/layout.ts` fits the notebook to the
  screen (`layout()`: the mode classes, the score line's rows, the spiral, and the notebook's ResizeObserver; the board
  itself is sized by CSS, `src/style.css` "layout"), `src/boot.ts` restores the saved round and starts the cover or a
  `?play=` round, `src/main.ts` wires the screens to the game.
- `tests/` — vitest unit tests for engine, game flow and flight; `e2e/` — Playwright smoke test.
- `scripts/claude-review.mjs` — the pull-request reviewer. The workflow runs the copy on the base commit
  and never the pull request's own copy. It calls the Anthropic Messages API and reads `AGENTS.md`, `README.md` and
  `REVIEW.md` from that same commit. It judges the diff against the `## Spec`. A finding outside that scope, and a
  description that is out of date, are notes. A finding already raised and addressed is not raised again. A blocking
  finding is addressed only when its thread is resolved, or the code it points at changed. Only a bug, a security
  issue, failing behaviour, or a broken repo rule blocks.
- `scripts/ship/` — bash ship tooling (`check.sh`, PR risk `pr-risk.sh`, auto-merge `auto-merge.sh`,
  deploy-watch `wait-for-next-stage.sh`, `reconcile-ci.sh` (dispatches `ci.yml` for a main HEAD with no CI
  run), `retry.sh` (one more attempt, each under a hard timeout, for a deploy step that can hang; it talks on
  stderr so a step still reads the command's stdout), `container-chrome.sh` (the image's Chromium as
  `CHROME_PATH`), `deploy-summary.sh` (the Deploy run's one-line verdict),
  shared `lib.sh`, `review-status.sh` for the claude-review sticky comment (`explain` fails the check with the
  reason, `pass` and `blocked` refresh the comment and exit 0), deploy gate `deploy-gate.sh`, and `push-to-main.sh`, which is retired and refuses), tested by `scripts/ship/test-ship.sh`
  (fakes in `scripts/ship/test-fakes/`, temp local fixture repos), run from vitest by `tests/ship.test.ts`.
- Logic belongs in `engine`/`game` with a unit test; keep `ui`/`main.ts` thin.

## Ship process

Origin is GitHub `derek-hobden/paper-golf` (private); the canonical checkout is `~/repos/paper-golf`. There is
**one family of tags, the PR video shelves** — the legacy `pr-videos`, then `pr-videos-YYYY-MM` and its rolls
`pr-videos-YYYY-MM-N`: the prereleases the explainer videos hang on as assets, whose prefix is
set in `scripts/ship/lib.sh` and nowhere else, created only through the releases API by `pr-video-upload.sh`,
which nothing triggers on and which are never a version of the game — and **every change is a pull request to
main: nothing ever pushes to main**
(`scripts/ship/push-to-main.sh` is retired and only says so; branch protection refuses a direct push).

This pipeline is meant to be copied. `docs/pipeline-rollout.md` is the checklist for giving another repository
the same one: every workflow and script to copy, the handful of values that are Paper Golf's own, the repository
and branch-protection settings, the labels, the variables and secrets (in the Actions **and** Dependabot
stores), installing the app, and the Claude Console workspace — whose spend limit stays unset, because a low
workspace cap does not fail loudly, it just turns `claude-review` red with an API error.

1. **Build and check** on your branch: `npm run check` and `npm run smoke`, committed.
2. **Open a pull request to main**, as a draft while you are still working: `git push -u origin HEAD`, then
   open it however you like (`gh pr create --draft`, the web UI, your editor, your coding tool). Nobody has to
   be a particular person or a particular tool. One wrinkle, not a requirement: main's branch protection asks
   for one approving review and GitHub will not let the author approve their own pull request, so a pull
   request Derek opens cannot be approved by Derek. Where the credentials allow it,
   `scripts/gh-as-gus.sh pr create` opens it as Golf Gus Bot (`golf-gus-bot`) instead, which leaves him free to
   approve. The body always includes a `## Spec` section with the original
   request and its done-criteria, and a `## How to see it` section — a few plain steps that show the change
   working — which CI films for the explainer video (start from `.github/pull_request_template.md`). A
   `dependabot[bot]` dependency-only PR is the exception: its spec is the section in `REVIEW.md`, and it gets
   no video.
   **Mark it ready for review when it is finished.** That is the one action that spends money: see
   "Paid jobs" below.
   On every push `.github/workflows/ci.yml` runs `check` and `smoke` (the same jobs main runs),
   `.github/workflows/pr-video.yml` runs `pr-video` and `.github/workflows/ready-gate.yml` runs `ready-gate`.
   On a ready mark `.github/workflows/claude-review.yml` runs `claude-review`: the copy of
   `scripts/claude-review.mjs` on main
   calls the Anthropic Messages API, reads this file, README.md and REVIEW.md from main as the rules, reads that
   Spec, and comments `BLOCKING:` or `NIT:` per finding. It judges the diff against the Spec: a finding outside
   that scope and a description that is out of date are NITs, a finding already raised and addressed is not
   raised again (a blocking finding only when its thread is resolved, or the code it points at changed), and the
   job fails only on a blocking comment (a bug, a security issue, failing behaviour, or a broken repo rule). The workflow is `pull_request_target`, so a PR that changes `.github/workflows` or the review script is still reviewed by the copy on main. `check`, `smoke`, `pr-video` and `ready-gate` are
   main's required checks — `claude-review` is not, because it does not run on every commit; `ready-gate`
   carries its verdict instead. Do not require `mutation`.
3. **Auto-merge** is on for every open pull request. `.github/workflows/auto-merge.yml` (`scripts/ship/auto-merge.sh`) turns on squash auto-merge, and deletes the head branch, when the pull request opens. **GitHub requires Derek's Approve review, then auto-merge merges the pull request once the required checks are green.** That approval is GitHub's own: main's branch protection requires 1 approving review, so no workflow of ours checks it (the custom `signoff` check is gone — it posted a red cross for every commit nobody had approved yet, and a wait is not a failure). He can press Approve, or add the `approved` label and let the app submit the review for him — which is the only way a pull request opened under his own account can be approved at all ("Owner approval" below). GitHub holds the merge until that review is in, and he never clicks Merge. The workflow is `pull_request_target` plus a `workflow_run` of `PR video`, and a `workflow_dispatch` that takes one pull request number by hand. The mutation runs as the **Golf Gus Bot app** (`actions/create-github-app-token` with `GOLF_GUS_APP_ID` and `GOLF_GUS_APP_KEY`), never on `GITHUB_TOKEN`: GitHub refuses `enablePullRequestAutoMerge` to a workflow's own token, and a Dependabot pull request gets a read-only one on every path here, `pull_request_target` and the `workflow_run` alike, because both runs are attributed to `dependabot[bot]`. Those two secrets have to be in the Dependabot store as well as the Actions store, and a missing one fails the job in plain English. It reads the pull request through `gh api` and never checks out or runs its head. The `claude-review` job still labels `risk:low` or `risk:high` from `scripts/ship/pr-risk.sh`; the label does not gate the merge.
   **When main moves.** `.github/workflows/update-branches.yml` (`scripts/ship/update-pr-branches.sh`) runs on
   that push. An open pull request with auto-merge on that is behind main is brought up to date. **One run at a
   time**: the workflow holds the whole repository in one concurrency group with `cancel-in-progress: false`, so
   several merges close together queue instead of racing (GitHub keeps one run pending per group, so the queue
   collapses to the newest wait rather than growing), and the pull requests are taken **oldest first** — the
   order is the merge order, not whatever order GitHub lists them in. A push made
   with `GITHUB_TOKEN` starts no `pull_request` workflows, so the same script dispatches `ci.yml` on the pull request branch with `refresh_pr` set, and `ready-gate.yml` on main (Derek's approval is GitHub's own, so there is no check to dispatch for it). It **never dispatches the review or the video**: a branch update is not a ready mark, and `FREE_WORKFLOWS` in the script is the one call site's allowlist, so adding a paid dispatch is refused rather than merely frowned upon. The CI refresh is named
   `CI refresh of pull request <n>`, its mode is `pr`, and it uploads no deploy request. Drafts, forks and
   pull requests without auto-merge are left alone. A merge conflict is left for a person. The script never
   pushes to main.
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
   inputs*) runs the same pipeline as the push: `check`, `smoke`, then the same deploy. A CI run started with
   `GITHUB_TOKEN` does not trigger Deploy's `workflow_run` (that token starts `workflow_dispatch` and
   `repository_dispatch` only; main 1d81308, run 39874595880), so the `start-deploy` job dispatches Deploy
   in that case, and only when the actor is `github-actions[bot]`. A person's push or dispatch still deploys
   through `workflow_run` alone. Deploy does not start CI, so the dispatch cannot loop. One dispatch per sha,
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
   proved the input is a commit on main).    Then `staging` — that sha deployed to Vercel's preview target and aliased to
   `paper-golf-staging-derek-hobden.vercel.app`, smoked there with the full suite in parallel shards
   (`SMOKE_BASE_URL`, the same Playwright split as CI) — then `production`: the same sha promoted (`vercel deploy --prebuilt --prod`)
   and checked with the fast `@quick` Chrome smoke (`npm run smoke:quick`). Those `@quick` tests fail on any
   browser console error or uncaught page error, so a bad page rolls back. A red production smoke rolls Vercel
   back to the last good deployment, smokes that with the full suite, and fails the run. One deploy at a time;
   a newer commit already waiting is the one that deploys — and **only a deployable CI run (green, on main,
   from a push or a dispatch) enters the `paper-golf-deploy` concurrency group**: GitHub keeps one pending run
   per group, so runs whose jobs all skip used to replace the real deploy waiting there (PR 23, bd648a0, whose
   deploy was cancelled with no jobs). A PR's CI run does not reach deploy.yml at all (`branches: [main]` on
   the trigger), and any other run gets a group of its own. A staging, production or rollback failure opens a
   GitHub issue labelled `pipeline-failure` mentioning @derek-hobden. A red PR check does not. A run that
   deployed ends with one line in its summary — `LIVE <url> <sha>` or `FAILED <job>`, and one that deployed
   nothing says nothing (`scripts/ship/deploy-summary.sh`, the `summary` job).
   **Nothing in the pipeline waits without a limit.** The jobs that run Playwright (ci.yml's `smoke-shard`,
   deploy.yml's `staging-smoke` and `production`) run in `mcr.microsoft.com/playwright:v<the @playwright/test
   version in package-lock.json>-noble`, so no workflow installs a browser — the install hung for 15 and 19
   minutes in two deploy jobs on 22 Oct 2026 (run 39781080561) and has no step left to hang in. Every job has
   `timeout-minutes` (a deploy job at most 15), every long step has its own (a Playwright shard step at most 8,
   the full suite in one deploy step at 12, the
   `@quick` check at most 5, a `vercel build` or `deploy` at most 6). The whole suite in one step measured
   7m40s in CI (and 7m22s-7m58s before the container), so ci.yml and the staging smoke run it as shards
   (chrome in four, iphone-webkit in two) with `fail-fast` off. Playwright shards whole spec files, so a file that outgrows the step is split in two (`e2e/fit.spec.ts` and `e2e/fitwide.spec.ts`, both from `e2e/fitcases.ts`) rather than given more shards. The required check stays the job named `smoke`,
   and production still waits on the job named `staging`. Against a deployment the full suite outgrew 8 minutes
   (run 39841475142 passed 208 of 211 tests and was cut off), so the rollback's one step is 12 minutes, which
   still fits the 15-minute deploy job. The browsers stay the image's;
   caching a second copy would not shorten the tests. Every `vercel pull`, `build`, `deploy` and
   `alias` call, with `npm ci`, runs through `scripts/ship/retry.sh`, which gives it one more attempt under a
   hard per-attempt timeout that fits inside the step's own limit. A failing test is already retried by Playwright
   itself (`retries: 1` in CI). The image carries neither `gh` nor `jq`, so ci.yml's `flaky` job files the
   `flaky test:` issue on the runner from each shard's retry record, and every container job sets
   `defaults.run.shell: bash` (a container's default shell is `sh`, which has no `pipefail`).
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
    (npm, github-actions). Major updates are their own PRs. `ANTHROPIC_API_KEY`, `GOLF_GUS_APP_ID` and
    `GOLF_GUS_APP_KEY` have to exist as Dependabot secrets as well as Actions secrets, or the review job and
    the auto-merge job cannot run on those PRs.
13. **Weekly numbers.** Mondays 06:00 UTC, `.github/workflows/metrics.yml` writes deploys per day,
    merge-to-production time, failed release share and recovery time for the past week to one GitHub issue
    (label `pipeline-metrics`).

## Owner approval

GitHub never counts an author approving their own pull request, so a pull request opened under Derek's account
— by him, or by a coding session using his credentials — could only ever merge by admin override, and he had to
say "approved" in chat instead of pressing Approve. **Adding the `approved` label is pressing Approve.**

`.github/workflows/owner-approval.yml` (`scripts/ship/owner-approve.sh`) takes it from there, for a pull
request by any author:

- An approver adds the `approved` label. The **Golf Gus Bot app** submits the APPROVE review branch protection
  asks for, naming who approved and at which head commit. The same thing happens on a `workflow_dispatch` of
  that workflow with a pull request number: whoever ran it is the approver.
- **The approval is pinned to the commit the approver saw.** Anyone who can push to the branch could otherwise
  wait for the label and push, and have their own commit approved. So the head from the label event is passed in
  as `EVENT_HEAD_SHA`, the run refuses (and drops the label) when the live head has moved past it, the review
  carries that `commit_id` rather than GitHub's default of "whatever the head is now", and a push that lands
  while the review is being submitted is dismissed again on the way out. The approve and dismiss runs are not
  ordered by anything, so neither order can leave an approval on a commit nobody approved.
- Anyone else loses the label again, with a comment saying why. The approvers are the repository variable
  `APPROVERS` when it is set (logins separated by commas, spaces or newlines), otherwise `.github/pr-approvers`
  — one login per line, `#` for a comment, the check ignoring case as GitHub does. Both are read on the **base**
  commit, so a pull request can add neither itself to the list nor a step to the workflow. Teammates are
  deliberately not on the list: they open pull requests, Derek approves them. An empty allowlist approves
  nobody.
- A push dismisses it. On `synchronize` the app dismisses **its own** approval (its review body carries
  `<!-- owner-approved -->`, so a person's Approve is never touched) and removes the label, so it has to be
  asked for again on the new head. That holds whether or not branch protection dismisses stale reviews — and
  main's does, so usually GitHub has dropped the review already and only the label is left to clear.

The label is therefore only ever on a pull request the app has approved at that head. The workflow is
`pull_request_target` and checks out the base: nothing from the head is checked out or run, and the app token is
the only thing that writes. It spends nothing.

**An App review and the required review.** GitHub counts a review submitted by a GitHub App installation
towards branch protection's "require approvals", which is what this leans on. Two settings can still withhold
the merge, and neither is ours to change: *Require review from Code Owners* (an App is not a code owner unless
`CODEOWNERS` names it) and *Require approval of the most recent reviewable push* (GitHub does not let the
pusher's own approval count, and the app is not the pusher here, so this one is satisfied). If an App approval
ever stops counting on this repository, the smallest alternative is a second human on `APPROVERS` — not a
change to branch protection, and never an admin override as the normal path.

## The ready signal

A bot that owns a pull request used to wake on every comment and every review, which is nearly all noise.
There are two things worth waking for, and `.github/workflows/pr-signal.yml` (`scripts/ship/pr-signal.sh`)
posts each as **one** comment, by the Golf Gus Bot app, with a hidden marker at the very start of its body:

- `<!-- pr-ready -->` — the pull request is fully ready: every required check (`check`, `smoke`, `pr-video`,
  `ready-gate`) is green on the head commit, and CI's explainer video link is the first line of the body. **At
  most once per head commit**, and the same comment is edited rather than a second one added. A pull request
  that never gets a video — Dependabot, Renovate — is ready without one. A draft, a fork and a closed pull
  request get no signal at all.
- `<!-- pr-blocked -->` — a job that costs money, or the video publish, did not come back clean: what failed and
  the link to the run. Cancelled counts, because a recording cancelled in flight never reaches the publish
  workflow and that went unnoticed before (PR 51).

Both comments are **the app's**, and that is part of the signal: anyone who can comment can write
`<!-- pr-ready -->` in one, so the script only ever finds and edits a comment by an app (`user.type`, which
comes from GitHub and not from the body), and a watcher matches the app's login as well as the marker.

So a bot — or a person with a filter — watches those two markers and nothing else. Being ready is not a pull
request event (it is the last check going green), so the workflow also listens for the runs that can make it
true: `CI`, `Ready gate`, `Claude review` and the video workflows. It is `pull_request_target` with a base
checkout, like the gate: nothing from the head is checked out or run, and it spends nothing.

## Paid jobs

Almost everything here runs on GitHub minutes and is free: `check`, `smoke`, `mutation`, `pr-video`,
`ready-gate`. Two jobs are not — the **Claude review** and the **explainer video** (a Claude call, then an
OpenRouter call for the voice). Those run only when a pull request is **marked ready**, and never on a push:

- opened as a non-draft, or
- marked ready for review, or
- the `ready` label added (adding it again asks for another run).

So **open a draft and push to it as often as you like** — that is the intended way to work, and it costs
nothing. The decision is `scripts/ship/paid-trigger.sh`; a fork, `dependabot[bot]`, `renovate[bot]` and a draft
never pay.

A push after the review would otherwise dead-lock the merge: that commit has no review of its own. The
`ready-gate` check is the answer, and it spends nothing — `scripts/ship/ready-gate.sh` reads the pull request
and asks whether the review passed **since the pull request was last marked ready**, not since the last commit.
Push your fix; the gate stays green. Want a fresh review of it? Mark the pull request ready again, or add
`ready` again — that moves the mark forward and the gate goes red until the new review lands.

A typical pull request therefore costs one review and one video, however many commits it has. The video half
of that is a hard cap, not a convention: job 1 runs on a `pull_request` event, so its copy of the workflow and
of `paid-trigger.sh` belongs to the pull request and a branch could record whenever it liked — so
`scripts/ship/pr-video-publish.sh`, which is main's copy and is where the money is spent, drops a recording
whose ready mark already has a video before it buys anything.

## PR explainer videos

Every pull request that is ready for review opens with a link to a short narrated video of the change. **You do
not make it, and you do not need a key, a browser or any particular tool.** CI does all of it:

1. Open the pull request and write a `## How to see it` section — a few plain steps in your own words.
2. Mark it ready for review (or add the `ready` label).
3. `.github/workflows/pr-video-record.yml` builds the app, serves it and films those steps at a phone size and
   a desktop size. `.github/workflows/pr-video-publish.yml` narrates the recording, listens to the result,
   uploads the mp4 and writes its link as the very first line of the body, above the `---` divider, keeping
   everything you wrote below it.

The narration is written by `claude-sonnet-5-5`, pinned exactly in `scripts/ship/pr-video-script.sh`, called
as the reviewer calls it (no thinking field) with room for 1024 tokens, with no fallback — an API error, an empty
or cut-off answer fails the run and says why — and only speakable text (no URL, path, backtick or 25-character
token) ever reaches the voice. The mux pads the narration with silence to the picture's length. Then
`scripts/ship/pr-video-audio-gate.sh` listens to the finished video — speech coverage, silence, loudness, and
Whisper's transcript against the script — and a video that fails is not published: the publish run is red with
every reason, and `pr-video` stays red. There is no retry loop. The narration, the voice, the gate's report and
the model's log line are kept as the run's `pr-video-debug` artifact for 14 days, never committed.

The two workflows are split on the secrets, and that split is the security story: job 1 runs the pull request's
own code and holds nothing; job 2 is a `workflow_run`, so GitHub runs main's copy of it, and it never checks
out or executes a line of the pull request. It confirms against the API which pull request the recording
belongs to rather than believing the artifact. Job 2 is itself three jobs, each holding only what it needs:
`make` (the two keys and a read-only `GITHUB_TOKEN`: narrate, voice, mux), `gate` (no secret at all and
Contents read: the audio gate, with faster-whisper installed `--require-hashes --no-deps` from
`scripts/ship/audio-gate-requirements.txt` and the Whisper model at a pinned Hugging Face revision) and
`upload` (the app token, and only when the gate passed). Every action in every video workflow
(`pr-video*.yml`, the tidy-up included) is pinned to a full commit sha, its tag in a comment.

The link is a bare `github.com/<owner>/<repo>/releases/download/<shelf>/pr-<n>-<short sha>.mp4` URL: the mp4
is an **asset on a PR video shelf**, a prerelease never marked latest. The shelf is the month's,
`pr-videos-YYYY-MM` (the UTC month of the upload), found by tag and created if it is missing. GitHub caps a
release at 1,000 assets, so once a shelf holds `SHELF_ROLL_AT` (900) the next upload rolls early to
`pr-videos-YYYY-MM-2`, then `-3`, up to `MAX_SHELVES_PER_MONTH`, which fails loud. One asset per head commit:
remaking a video for the same commit replaces its asset on the shelf it lands on. The legacy `pr-videos` shelf
takes no new video, and its links stay valid; the `pr-video` check accepts a link on any shelf. It costs
nothing, outlives the merge, and — the point — it is reachable through a **documented** API.

**The tidy-up.** When a pull request to main merges or closes, `.github/workflows/pr-video-tidy.yml` runs
`scripts/ship/pr-video-tidy.sh` (main's copy, the default branch checked out, no repository secret: the job's own
`github.token` with `contents: write` and nothing else is the only writer, since deleting a release asset needs no more).
It keeps the video the body's first line links to and deletes the pull request's other `pr-<n>-*` videos from
every shelf, every month and roll and the legacy one, keeping also the one for the final head commit, so a
publish still in flight cannot lose its file. It builds the full list before deleting anything, and **in doubt
it deletes nothing**: a body with no video link, a link to another repository, pull request or release, a
linked file that is missing or not uploaded, or more than `MAX_DELETES` (100) to delete. Merged and
closed-unmerged are the same: the linked video is kept for good, nothing expires, and no shelf is ever deleted.

It used to be a `github.com/user-attachments/assets/` URL, which is the only GitHub URL that **plays** in a
browser in one click rather than downloading. That endpoint (`uploads.github.com/user-attachments/assets`) is
the undocumented one GitHub's own web upload uses, and it answers **404 to an App or Actions token** — there is
no user to attach the asset to — so it failed on every pull request that reached it, after the video had been
recorded and narrated ([PR 52](https://github.com/derek-hobden/paper-golf/pull/52), run 40265860037). A link
that downloads and works beats one that plays and does not.

The `pr-video` check asks for exactly that asset link, as the first thing in the
body; a draft passes, since there is no video yet. **The video is never a file in the pull request.** A product
video committed elsewhere in the repo is fine.

Writing the steps: `open /some/path`, `click Roll`, `type "Amna" into the name box`, `expect the scorecard`,
`take a shot`, `wait 3s`. Anything else becomes a pause the narration talks over, and a step that cannot be
followed never fails the pull request — the video just shows what it could. With no `## How to see it` section
CI tours the app, or shows a title card when the diff has no screen to show. A pull request that wants
something specific on film can check in its own Playwright spec under `e2e/walkthroughs/`; the recorder films
that instead of the generic walkthrough.

## Rules

- TypeScript is strict with `noUncheckedIndexedAccess`; ESLint is typescript-eslint `strictTypeChecked`.
  Fix the code. Never add `eslint-disable`, `@ts-ignore`, `!` non-null assertions or silencing casts, and never
  loosen `tsconfig.json`, `eslint.config.js` or a test to get green.
- Cap test parallelism: keep vitest at `--maxWorkers=4` (as in `npm test`) and never run a test runner with its default
  worker count; at most 8 parallel workers in total.
- Reuse the checked-access primitives instead of inventing new ones: `itemAt`/`must` (`src/engine/assert.ts`),
  `gridAt` (`src/engine/grid.ts`), `byId`/`query` (`src/ui/dom.ts`), and `at`/`defined` (`tests/helpers.ts`).
- A gameplay rule decision that is not in Derek's words goes in the result as a question, not into the code.
- When you stop because you need a decision, end with the question as one clear line, the last line of the result.
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
| Every change is a pull request: `check`, `smoke`, `pr-video` and `ready-gate` run on every pull request to main, under those names (the required checks), and `claude-review` runs on a ready mark. `check` and `smoke` are not gated by the event; a push skips them only when `same-tree.sh` proves that tree already passed | `test-ship.sh` cases `ci_triggers_pr_main_and_dispatch_only`, `ci_check_and_smoke_run_on_every_pr`, `ci_claude_review_on_every_pr`, `ci_pr_video_workflow`, `ci_ready_gate_workflow`, `same_tree_*` | - |
| Every open pull request is set to squash auto-merge, and the head branch is deleted, when it opens. GitHub merges when the required checks are green | `scripts/ship/auto-merge.sh`, `.github/workflows/auto-merge.yml`; `test-ship.sh` cases `auto_merge_*` and `ci_auto_merge_on_open` | - |
| Adding the `approved` label is pressing Approve: the Golf Gus Bot app submits the APPROVE review, pinned with `commit_id` to the head the label event carried and refused when the live head has moved past it (a push that lands mid-submit is dismissed on the way out, so neither order of the approve and dismiss runs can approve a commit nobody saw), naming who approved and at which head sha, only for a login on the allowlist (the `APPROVERS` variable, else `.github/pr-approvers`, read from the base commit, case-insensitive). Anyone else loses the label with a comment saying why, and so does a draft, a fork and a repository with no approvers configured — the label is only ever on a pull request the app approved at that head. A push dismisses the app's own review (never a person's) and removes the label. Nothing from the head is checked out or run | `scripts/ship/owner-approve.sh`, `.github/workflows/owner-approval.yml`; `test-ship.sh` cases `approve_*`, `ci_owner_approval_workflow` and `approve_never_runs_pull_request_code` | - (PRs opened under Derek's account could only merge by admin override, because GitHub never counts an author approving their own pull request) |
| Derek's approval is GitHub's, not a check of ours: main's branch protection requires 1 approving review, and auto-merge merges once the required checks are green. No workflow or ship script checks the sign-off, and none handles an `/approve` comment — a custom check posts a red cross while it waits for a person, and a wait is not a failure | `test-ship.sh` case `no_signoff_check` (the two files are gone, and no `scripts/ship/*.sh` or `.github/workflows/*.yml` names signoff, `/approve` or `issue_comment`), run by `tests/ship.test.ts` in `npm test` | - |
| CI retries a failed test once (vitest and Playwright) and files `flaky test: <name>` when the retry passes. Tests are not skipped | `vite.config.ts` `retry`, `playwright.config.ts` `retries`, `scripts/ship/report-flaky.sh`; `test-ship.sh` cases `flaky_*` and `ci_flaky_retry` | - |
| A whole-course sweep is never one test: generating, solving or playing all 90 holes runs as one `it.each` case per hole or per course (`EVERY_HOLE`/`EVERY_COURSE` in `tests/sweep.ts`), or outside the test altogether with the cases asserting the answer it left (`tests/windrule.test.ts`, `tests/proper.sim.test.ts`), because one case carrying the whole sweep spends tens of seconds against the 30s per-test timeout and times out on a loaded runner (v8 coverage and four workers roughly triple each test's wall clock) | `no-restricted-syntax` block for `tests/**/*.test.ts` in `eslint.config.js` (the generator, the solver or the typical player — `playHoleTypically` — called inside a test body under two nested iterations, loops or `map`/`flatMap`/`forEach`/`Array.from`; one level, `it.each` and module or describe scope are allowed), run by `npm run lint` in `npm run check`, lint-staged and CI, and proved by `tests/sweepguard.test.ts` (it lints the four shapes that timed out, and the shapes the suite uses, through the real config); plus `tests/sweep.ts` with the `it.each` sweeps in `tests/proper.test.ts`, `tests/green.test.ts` and `tests/game.test.ts`, and `tests/proper.test.ts` "is the only round", which fails if `EVERY_HOLE` stops covering all 90 holes exactly once | f17f219 (#8 `game flow > plays every course...` and #9 `solver with the green and tap-ins > values every cup neighbour...` timed out at 30s on the first attempt, run 39491920577), 80bb620 (#17 `Proper golf course > keeps the same hole layouts (pinned seeds)`, run 39590662071), 15edee9 (#44 `Proper golf simulation ... with wind`: the windy case made one test 6000 simulated holes, 24.4s of the 30s budget under coverage, run 39957808581) |
| A PR explainer's narration is `https://openrouter.ai/api/v1/audio/speech`, model `google/gemini-3.8-flash-lite-tts`, voice `Kore`, through `scripts/ship/pr-video-narrate.sh`, called by the publish workflow: none of the three is overridable, no key means a hard failure, and an answer that is not audio is refused | `scripts/ship/pr-video-narrate.sh`; `test-ship.sh` cases `narrate_pins_the_model_and_voice` (which asserts the endpoint, model and voice from the config curl was handed), `narrate_needs_the_key`, `narrate_refuses_a_bad_answer` and `narrate_rule_is_written_down` | 881ad5c (PR 28's explainer, narrated with espeak-ng because nothing said which voice) |
| A PR explainer's narration is written by `claude-sonnet-5-5`, pinned exactly with no thinking field and `max_tokens` 1024; there is no fallback: an API error (named by its HTTP status and the error's type and message), an empty reply, a `max_tokens` stop or too few words publishes no video; only speakable text reaches the voice (no URL, no path — a slash between two words such as `and/or` is speech — no backtick and no token of 25+ characters); the audio is padded to the video's length; and `pr-video-audio-gate.sh` blocks the publish on missing or short audio, too little speech, too much silence or a long gap (speech and silence measured over the raw narration, so the padding after it is never silence that fails), loudness outside -24 to -10 LUFS, or a Whisper transcript that does not match the script | `scripts/ship/pr-video-script.sh`, `pr-video-mux.sh`, `pr-video-audio-gate.sh` (+ `.py`), called by `pr-video-publish.sh` between the mux and the upload; `test-ship.sh` cases `narration_*`, `mux_pads_the_audio_when_the_video_is_longer`, `mux_audio_fills_the_video`, `audio_gate_*` (incl. `audio_gate_requirements_are_hash_pinned`), `publish_gates_the_audio_before_the_upload`, `publish_upload_*`, `ci_audio_gate_job_holds_no_secret`, `ci_video_publish_pins_every_action`, `ci_video_workflows_pin_every_action` (every `pr-video*.yml`) and `ci_video_publish_keeps_the_debug_files` | f7f4144 ([PR 51](https://github.com/derek-hobden/paper-golf/pull/51): Haiku at 400 tokens left no narration, the fallback read PR 54's base64 link aloud and the voice stopped at 25 s of a 60 s video, run 40289576297; the mux never padded the audio, 17 s over 60 s in run 40283786694; the only check was that an audio stream existed) |
| No pr-video workflow installs anything with apt: ffmpeg and ffprobe come from `scripts/ship/install-ffmpeg.sh`, a static Linux x86_64 build from one GitHub release at a fixed tag (`FFMPEG_RELEASE`), each archive checked against its pinned SHA-256 (`FFMPEG_SHA256`, `FFPROBE_SHA256`) before it is unpacked — a mismatch, cached or fresh, fails the step — every download with `--fail`, three retries and a connect and total timeout, cached by a pinned `actions/cache` keyed on those checksums, and a no-op when both tools are already on `PATH`. The gate job stays secret-free with Contents read | `scripts/ship/install-ffmpeg.sh` in the `make` and `gate` jobs of `.github/workflows/pr-video-publish.yml`; `test-ship.sh` cases `install_ffmpeg_*`, `ci_video_workflows_install_ffmpeg_without_apt` and `ci_audio_gate_job_holds_no_secret` | PR video publish runs 40345686952 and 40350234858 (both attempts): `sudo apt-get update` / `apt-get install ffmpeg` hung to the 5-minute step limit, so no narration, gate or upload ran |
| A PR explainer video is never in the pull request: no added `pr-explainer-*` `.mp4`/`.mov`/`.webm`/`.txt`/`.md`, no added root `video.mp4`, nothing under `qa-video/` or `docs/pr-videos/`, and a ready pull request's body opens with the asset link CI wrote there, on one of the repository's PR video shelves (`pr-videos`, `pr-videos-YYYY-MM`, `pr-videos-YYYY-MM-N`) — a draft is exempt, because its video has not been made yet. A product video elsewhere is fine | `scripts/ship/pr-video.sh` in the `pr-video` job (`.github/workflows/pr-video.yml`), `/video.mp4` and `/pr-video/` in `.gitignore`; `test-ship.sh` cases `video_*` and `ci_pr_video_workflow` | - |
| CI makes the explainer video, and nobody needs a key, a browser or a particular tool for it. Job 1 runs the pull request's code and holds no secret; job 2 is a `workflow_run` of job 1, so GitHub runs main's copy, it never checks out or runs the head, and it confirms against the API which pull request the recording belongs to instead of believing the artifact. It hosts the mp4 as an asset on the month's PR video shelf, `pr-videos-YYYY-MM` (found by tag, created when missing, never latest, rolled to `-2`, `-3`… once it holds 900 assets, counted over every page, never the legacy `pr-videos`, one asset per head commit, on the **app's** Contents write, in the `upload` job that runs only after the `gate` job passed — no job's own `GITHUB_TOKEN` calls the releases API or gets a write) — a documented endpoint, free, and it outlives the merge — and writes that link as the first line of the body, above the first `---`, keeping everything below it; the App's body edit is what turns `pr-video` green | `.github/workflows/pr-video-record.yml`, `.github/workflows/pr-video-publish.yml`, `scripts/ship/pr-video-{record,script,join,upload,body,publish}.sh`; `test-ship.sh` cases `ci_video_record_holds_no_secret`, `ci_video_publish_runs_no_pull_request_code`, `upload_*` (against the stateful releases fake), `shelf_names_and_the_current_shelf`, `body_*`, `publish_*`, `narration_script_*`, `join_*`, `record_*`; `tests/walkthrough.test.ts` | [PR 52](https://github.com/derek-hobden/paper-golf/pull/52) run 40265860037 (the undocumented `uploads.github.com/user-attachments/assets` endpoint answers 404 to an App or Actions token, so every explainer failed at the upload after being recorded and narrated, and the tests only ever faked that endpoint); Anthropic's GitHub proxy answered 415 to a cloud session's explainer upload, 23 Oct 2026; [PR 43](https://github.com/derek-hobden/paper-golf/pull/43), where a later body edit wiped the attach off the top — the body rewrite is now `pr-video-body.sh`, which only ever replaces the block above the first `---` |
| The jobs that cost money run on a ready mark and nowhere else — opened as a non-draft, marked ready for review, or the `ready` label added — and never on a push, a fork or a bot. A draft is the intended way to work in progress and costs nothing. The review reads that decision from the **base** commit's copy, because `pull_request_target` pins its workflow file to main; the recorder's file is the pull request's own, so reading it from the base would buy nothing, and the cap that holds is in `pr-video-publish.sh` (main's copy, and the one that spends): one video per ready mark, whatever the recording job does | `scripts/ship/paid-trigger.sh`, read from `base.sha` by `.github/workflows/claude-review.yml`; the `ship_ready_mark` cap in `scripts/ship/pr-video-publish.sh`; `test-ship.sh` cases `paid_trigger_*`, `ci_paid_jobs_only_on_a_ready_mark`, `ci_video_record_holds_no_secret` and `publish_buys_one_video_per_ready_mark` | [PR 51](https://github.com/derek-hobden/paper-golf/pull/51) review comment [4371544221](https://github.com/derek-hobden/paper-golf/pull/51#discussion_r4371544221): the first cut had no cap at all, so a branch could edit `paid-trigger.sh` to answer `yes` on a draft and buy a narration and a voice on every push |
| A label the paid workflows do not act on cancels nothing. Their trigger takes every `labeled` event, and the Claude review's own last steps set a `risk:` label, so with one concurrency group per pull request that label cancelled the recording in flight — and a cancelled recording never reaches the publish workflow, so no video was ever made. Both groups are keyed on the label, the gate's dispatch has a group of its own, and a record run that filmed nothing does not start the publish workflow at all | the `concurrency.group` expressions in `.github/workflows/pr-video-record.yml`, `claude-review.yml` and `ready-gate.yml`, and the `recorded` job in `pr-video-publish.yml`; `test-ship.sh` cases `ci_a_stray_label_cancels_nothing` and `ci_video_publish_skips_a_run_that_filmed_nothing` | [PR 51](https://github.com/derek-hobden/paper-golf/pull/51) review comments [4371610436](https://github.com/derek-hobden/paper-golf/pull/51#discussion_r4371610436) and [4371584338](https://github.com/derek-hobden/paper-golf/pull/51#discussion_r4371584338) |
| A watcher has two markers to watch and no more: `<!-- pr-ready -->` once per head commit when every required check is green and the video link is the first line of the body, and `<!-- pr-blocked -->` when a paid job or the video publish fails, cancels or times out, naming it and its run. One comment per marker, edited in place, posted by the app and only ever found by the app (`user.type`, so a marker a person wrote is not the signal); a draft, a fork and a closed pull request get none, and a pull request that earns no video is ready without one | `scripts/ship/pr-signal.sh`, `.github/workflows/pr-signal.yml`; `test-ship.sh` cases `signal_*`, `ci_pr_signal_workflow` and `signal_never_runs_pull_request_code` | - (the owning bot woke on every comment and every review) |
| The merge never dead-locks on a push after the review: `ready-gate` asks whether the review passed since the pull request was last marked ready, not since the last commit, and spends nothing to answer. Marking it ready again moves that mark forward. The review records its verdict as a check run on the pull request head on every path, and dispatches the gate when it is done, because a later run of one workflow cannot turn a check an earlier run of another left red | `scripts/ship/ready-gate.sh`, `.github/workflows/ready-gate.yml`, the `record the review on the pull request head` step in `.github/workflows/claude-review.yml`; `test-ship.sh` cases `ready_gate_*`, `ci_ready_gate_workflow` and `update_api_then_dispatch` (a branch update re-runs the free checks and the gate, never the review) | - |
| A PR that changes non-test `src/**` also changes a test file, unless it is dependabot or only docs/config/workflows | `scripts/ship/test-touch.sh` in the `check` job; `test-ship.sh` cases `touch_*` | - |
| At least 80% of changed lines in `src/engine` and `src/game` are covered | `tests/diffcover.ts`, `scripts/ship/diff-cover.sh`, vitest v8 coverage in the `check` job; `tests/diffcover.test.ts` and `test-ship.sh` case `diff_cover_*` | - |
| Stryker on changed `src/engine` and `src/game` files is advisory and never fails the job | `scripts/ship/mutate.sh`, the `mutation` job (`continue-on-error`); `test-ship.sh` cases `mutate_*` and `ci_mutation_advisory` | - |
| Post-merge staging, production and rollback failures open a `pipeline-failure` issue mentioning @derek-hobden. PR check failures do not | `scripts/ship/pipeline-failure.sh` in `deploy.yml`; `test-ship.sh` case `ci_pipeline_failure_notifies` | - |
| Production's `@quick` smoke fails on a browser console error or an uncaught page error | `e2e/console.ts` `watchConsole`, `tests/quickconsole.test.ts`, `npm run smoke:quick` in the production job | - |
| `pr-risk.sh` still labels `risk:low` or `risk:high` (CI or deploy config, secrets, auth, a dependency major, or a large diff). The label does not gate the merge | `scripts/ship/pr-risk.sh` with the `test-ship.sh` cases `risk_*` (one per rule, both verdicts); `ci_claude_review_on_every_pr` (the label, and that the review job makes no `gh pr merge` call) | - |
| GitHub's auto-merge is turned on outside the pull request's own token: `pull_request_target` when the pull request opens, a `workflow_run` after `PR video`, and a `workflow_dispatch` for one pull request by hand. The workflow reads the pull request through `gh api` and never checks out or runs its head. A closed, merged, draft or fork pull request is a no-op, and a refused mutation says which refusal it was | `scripts/ship/auto-merge.sh`, `.github/workflows/auto-merge.yml`; `test-ship.sh` cases `auto_merge_*` and `ci_auto_merge_on_open` | 9f5ae88 (the review job ran `gh pr merge --auto --squash` with a token that may not: `Resource not accessible by integration (enablePullRequestAutoMerge)` on every Dependabot PR, e.g. PR 13 run 39659612854, under a warning that blamed Settings → Allow auto-merge) |
| `enablePullRequestAutoMerge` never runs on `GITHUB_TOKEN`: GitHub refuses the mutation to a workflow's own token, and a Dependabot pull request gets a read-only one on every path, `pull_request_target` and the `workflow_run` that follows alike, because both runs are attributed to `dependabot[bot]`. The job mints a Golf Gus Bot installation token instead, keeps no `pull-requests: write` of its own, and a missing app secret fails it in plain English naming the Actions **and** Dependabot stores | `actions/create-github-app-token` in `.github/workflows/auto-merge.yml` and the refusal text in `scripts/ship/auto-merge.sh`; `test-ship.sh` cases `ci_auto_merge_app_token` and `auto_merge_explains_a_refused_enable` | ac0bac7 (PR 36 head 6a1da66: `Resource not accessible by integration (enablePullRequestAutoMerge)` on both paths, runs 39929545604 and 39929569432, so no pull request ever had auto-merge on and Derek clicked Merge on 31, 34, 38 and 40) |
| A pull request that changes `.github/workflows` or `scripts/claude-review.mjs` is still reviewed by the copy on main. The workflow is `pull_request_target`, the checkout is the base commit, and the reviewer is `git show` of that commit. A workflow validation skip is not a pass | `.github/workflows/claude-review.yml`; `scripts/ship/review-status.sh`; `test-ship.sh` cases `ci_claude_review_on_every_pr` and `review_status_workflow`; `tests/claude-review.test.ts` | - |
| An open auto-merge pull request that falls behind main is updated on the push to main, and its checks are dispatched again. The update never pushes to main, and a refresh run does not deploy. One update run at a time for the whole repository (one concurrency group, `cancel-in-progress: false`), pull requests taken oldest first, and only the free workflows dispatched — `FREE_WORKFLOWS` is the single call site's allowlist, so a branch update can never buy a review or a video | `scripts/ship/update-pr-branches.sh`, `.github/workflows/update-branches.yml`, `refresh_pr` in ci.yml; `test-ship.sh` cases `update_*` (incl. `update_oldest_first`, `update_never_dispatches_the_paid_jobs`, `update_rule_is_written_down`), `refresh_fields_*`, `ci_refresh_does_not_deploy` and `ci_update_branches_workflow` | - |
| Every commit on main gets a `ci.yml` run, so every merge deploys. Only a push-event run on main is main HEAD's own CI run (a PR's run tested a branch; the emergency dispatch's run carries the tip's `head_sha` but tested an older sha), and a main HEAD without one is dispatched exactly once — the reconciler's own dispatch is recognised by `ci.yml`'s `run-name`, a tip younger than 2 minutes waits a tick, and a dispatch waits for its own run to be listed before the next tick can begin, so it never dispatches twice. On doubt nothing is dispatched | `scripts/ship/reconcile-ci.sh`, `.github/workflows/reconcile-ci.yml`; `test-ship.sh` cases `reconcile_*` and `ci_reconcile_workflow` | d75953a (PR 22, auto-merged by GitHub with `GITHUB_TOKEN` on 22 Oct 2026: GitHub starts no push workflow for its own push, so main had no CI run and every Deploy run after it was skipped) |
| A CI run started with `GITHUB_TOKEN` still deploys. That token does not trigger `workflow_run`, so `start-deploy` dispatches Deploy with `workflow_dispatch` only when the actor is `github-actions[bot]`. A person's push or dispatch still deploys through `workflow_run` alone. Deploy never starts CI | `scripts/ship/start-deploy.sh`, `scripts/ship/read-ci-run.sh`, ci.yml `start-deploy`, deploy.yml `workflow_dispatch`; `test-ship.sh` cases `start_deploy_*`, `read_ci_run_*` and `ci_token_run_dispatches_deploy` | 1d81308 (PR 37, CI run 39874595880, reconcile dispatch by `github-actions[bot]`: CI was green and no Deploy run was created) |
| A CI run from `ci.yml`'s normal dispatch path (no inputs, main HEAD) is gated and deployed exactly like a push run — the commit CI proved, still main's tip, then staging, its smoke, production, its smoke and the rollback — and the emergency path (`sha` + `confirm=deploy-production`) stays production-only | `mode=reconcile` in `scripts/ship/deploy-gate.sh` and the `staging`/`production` gates in `deploy.yml`; `test-ship.sh` cases `deploy_gate_normal_dispatch_deploys_like_a_push`, `deploy_gate_stale_normal_dispatch_does_not`, `deploy_gate_push_request_carries_no_confirm` and `ci_dispatch_path_runs_the_push_pipeline` | - |
| Only a deployable CI run (green, on main, from a push or a dispatch) enters the `paper-golf-deploy` concurrency group; a PR's CI run never triggers deploy.yml, and every other run gets a group of its own. GitHub keeps one pending run per group | `branches: [main]` and the `concurrency.group` expression in `.github/workflows/deploy.yml`; `test-ship.sh` case `ci_deploy_group_only_for_main_ci_runs` and `tests/ship.test.ts` | bd648a0 (PR 23: a green main CI run whose Deploy runs were cancelled with no jobs, displaced in the group by the Deploy runs of PR-branch CI completions; production stayed on 1d12653) |
| There are no preview deploys: the only deploys are the staging deploy of main and the production promote, both gated to a push to main or the dispatch, never a branch or a PR | `test-ship.sh` case `ci_no_branch_or_pr_preview_deploys` (every job that runs `vercel deploy`, in every workflow) | - |
| One smoke suite, local or deployed: `SMOKE_BASE_URL` points the same specs at a deployment (with the Vercel SSO bypass header from `VERCEL_AUTOMATION_BYPASS_SECRET`), and unset it is `vite preview` exactly as before | `playwright.config.ts` (one `baseURL`, `webServer` only when it is unset); `test-ship.sh` cases `ci_staging_after_ci_on_push` and `ci_production_needs_staging_smoke` (the deploys smoke through it) | - |
| Production's post-deploy smoke is the fast `@quick` Chrome check (`npm run smoke:quick`: the start-page turn and the solo round); the PR smoke and the staging smoke are the full suite in parallel shards, and the rollback re-smokes with the full suite | `package.json` `smoke:quick`; `test-ship.sh` cases `ci_check_and_smoke_run_on_every_pr`, `ci_staging_after_ci_on_push` and `ci_production_needs_staging_smoke`; `tests/shards.test.ts` | - |
| The smoke suite runs in parallel shards (chrome × 4, iphone-webkit × 2) and the pass/fail gate stays one required check named `smoke`. Staging's shards report through the job named `staging`, and the rollback stays one full `npm run smoke`. A shard that outgrows its 8-minute step is fixed by splitting the spec file it is stuck on — Playwright shards whole files, so more shards move a long file around rather than break it up — never by a longer step. The shard step also refuses a shard its matrix does not list | `smoke-shard` / `staging-smoke` matrices in ci.yml and deploy.yml; `tests/workflows.test.ts` (both matrices are the same list, and the shard step's own list of accepted shards holds every row of them); `tests/shards.test.ts` (the shards are the project exactly once); `test-ship.sh` cases `ci_check_and_smoke_run_on_every_pr`, `ci_smoke_timeout_has_headroom`, `ci_staging_smoke_has_headroom` | run 40120215534 ([PR 50](https://github.com/derek-hobden/paper-golf/pull/50): 36 new fit cases pushed `iphone-webkit 1/2` past 8 minutes with 147 of ~150 passing), run 40120259282 (the matrix was split 2 → 3 without the step's list of accepted shards, so every WebKit shard failed as `unknown shard`), run 40120338680 (the three-way split changed nothing: `e2e/fit.spec.ts` was one file, so one shard still carried all of it — the file had to be split instead) |
| `npm run smoke` never tests a stale `dist/`: it builds first | `package.json` `presmoke` (`npm run build`) | - |
| Paper Golf has one family of tags, the PR video shelves: the legacy `pr-videos`, `pr-videos-YYYY-MM` and its rolls `pr-videos-YYYY-MM-N` (N from 2), the prereleases the explainer videos hang on. The prefix is set in `scripts/ship/lib.sh` and nowhere else, a shelf is created only through the releases API by `pr-video-upload.sh` (a prerelease, never draft, never latest), and the only other caller of the releases API is `pr-video-tidy.sh`, which never creates a release and whose one write is `DELETE releases/assets/<id>`. No ship script or workflow pushes a tag, creates one with `git tag`, names a `refs/tags/*` refspec (read as a production tag push by the gate) or triggers on one, and no tag is ever a version of the game | `test-ship.sh` case `no_tags_in_ship_scripts_or_workflows` (greps `scripts/ship/*.sh` and `.github/workflows/*.yml` for a tag push or a tag trigger, holds the shelf prefix to `lib.sh` and the releases API to `pr-video-upload.sh` and `pr-video-tidy.sh`, and fails while `mirror-to-github.sh` exists), `shelf_names_and_the_current_shelf` and `ci_triggers_pr_main_and_dispatch_only` | bfbfb25 (`mirror-to-github.sh:118`, never on GitHub) |
| When a pull request to main merges or closes, its superseded explainer videos come off the shelves and the linked one stays for good: `pr-video-tidy.sh` reads the body's first line as the check does, goes ahead only for a link on this repository, on a shelf, named `pr-<n>-`, lists every release and every asset on every shelf (every page) before deleting anything, and deletes only assets named exactly `pr-<n>-` (never `pr-<n>5-`), less the linked one and the final head's. In doubt — no link, another repository, pull request or release, a linked file missing or not uploaded, more than `MAX_DELETES` (100) — it deletes nothing and exits 0; a failed listing exits 1 with nothing deleted. Merged and closed-unmerged are the same, nothing expires, and no shelf is deleted. The workflow is main's copy on `pull_request_target` `closed`, checks out the default branch, skips a fork's close (forks get no video), uses no secret and mints no app token: its one permission is `contents: write` on the job's own `github.token`, passed only to the tidy step. Over `MAX_DELETES` it also raises a `::warning::` with the pull request and the count, and every `gh` call inside a `while read` loop reads `/dev/null`, never the loop's input. The fake it is tested against is the stateful releases model (`FAKE_GH_RELEASES_DIR`, `test-fakes/gh-releases`): GitHub's 404 and 422 bodies, `per_page`, `--paginate` running `--jq` per page, and the 1,000-asset cap | `scripts/ship/pr-video-tidy.sh`, `.github/workflows/pr-video-tidy.yml`; `test-ship.sh` cases `tidy_*`, `ci_pr_video_tidy_workflow`, `fake_releases_*`, `no_tags_in_ship_scripts_or_workflows` and `ci_triggers_pr_main_and_dispatch_only` | - (nothing ever deleted a video, and one release holds at most 1,000 assets) |
| A Deploy run deploys only for a CI run that is completed, green, on main and in this repo, from a push, `ci.yml`'s normal dispatch or the confirmed dispatch. A push, and the normal dispatch that stands in for one (`mode=reconcile`, request carrying no confirm), deploy exactly that run's `head_sha` — never main's tip — and only while it is still main's tip; the confirmed dispatch deploys its request's confirmed sha, which is behind main by design, so its run's `head_sha` (the ref's tip) is never compared to it. Cancelled, skipped, failed and unfinished CI, and any doubt, deploy nothing | `scripts/ship/deploy-gate.sh` in `deploy.yml`'s `prepare` job, whose verdict `staging`, `production` and `notify` all need; `test-ship.sh` cases `deploy_gate_*` (one per rule) and `ci_deploy_only_after_a_green_ci_run`, run by `tests/ship.test.ts` in `npm test` | 76d9a5c (which added both `deploy.yml` and `deploy-batch.sh`: the only staleness guard counted queued Deploy runs, not commits, so on 22 Oct run 39744635505 promoted 48d5d48 to production while main was three commits on at fdb6b12, whose CI smoke was still running and then cancelled) |
| No workflow installs a browser: every job that runs the Playwright suite runs in `mcr.microsoft.com/playwright:v<the @playwright/test version in package-lock.json>-noble`, pinned to the lockfile, and takes the image's Chromium for the `chrome` project through `scripts/ship/container-chrome.sh` (`CHROME_PATH`, with `CHROME_NO_SANDBOX=1`, which the container needs as root) | `tests/workflows.test.ts` (every workflow, every job, including that a container job sets `defaults.run.shell: bash`, since a container's default shell is `sh` and has no `pipefail`); `test-ship.sh` cases `ci_browsers_come_from_the_playwright_container`, `ci_smoke_timeout_has_headroom`, `ci_check_and_smoke_run_on_every_pr` and `container_chrome_*`, run by `tests/ship.test.ts` in `npm test` | run 39781080561 (`npx playwright install --with-deps webkit` hung 15m04s in staging and 18m45s in production, both cancelled by hand; the same step took 34s on the attempt that got through), fdb6b12 (main's smoke cancelled at the 10-minute limit after a 7m40s install, run 39743508384 attempt 1 — which is how the 22 Oct deploy gap came to be noticed), d029d4c (the same, at test 192 of ~210 after a 4m35s install, run 39757413720) |
| Every job in every workflow has `timeout-minutes` (a deploy job at most 15, nothing over 25), every long step has its own (a Playwright shard step at most 8, the full suite in one deploy step at 12, the `@quick` check at most 5, a `vercel build` or `deploy` at most 6 — and because the whole suite in one step measured 7m40s, ci.yml and staging run it as shards rather than pretend 8 fits it), and every `vercel pull`/`build`/`deploy`/`alias` call goes through `scripts/ship/retry.sh` — one more attempt, each under a hard timeout that fits the step's own, chatter on stderr so the step still reads the deploy URL | `tests/workflows.test.ts`; `test-ship.sh` cases `retry_*`, `ci_smoke_timeout_has_headroom` and `ci_staging_smoke_has_headroom` | run 39781080561 (one unbounded step held a deploy for 15 and 19 minutes under 20- and 30-minute job limits); run 39841475142 (staging smoke cut at 8 minutes with 208 of 211 tests passing) |
| A Deploy run's summary knows exactly two lines — `LIVE <url> <sha>` and `FAILED <job>` — and a run that deployed nothing prints neither, nor anything else, and the `pipeline-failure` notify job stays next to it | `scripts/ship/deploy-summary.sh` and deploy.yml's `summary` job (`if: always()`); `test-ship.sh` cases `deploy_summary_*` (incl. `deploy_summary_no_deploy_is_silent`) and `ci_deploy_summary_and_notify`; `tests/workflows.test.ts` | - |
| Production is the merge pipeline, the normal dispatch of main HEAD or the confirmed dispatch, nothing else: no `--prod` outside the `production` job, which needs `check` + `smoke` and either the staging smoke green on a push or on that normal dispatch (`mode == 'reconcile'`, gated exactly as the push it stands in for) or `confirm == 'deploy-production'`; a production run is never cancelled; `VERCEL_TOKEN` only from the repo secret via env, never `--token`; Vercel CLI pinned exactly | `test-ship.sh` cases `ci_production_needs_staging_smoke`, `ci_dispatch_path_runs_the_push_pipeline`, `deploy_gate_normal_dispatch_deploys_like_a_push`, `ci_vercel_token_from_secret_env_only`, `ci_staging_after_ci_on_push` and `actionlint` | - |
| Phone tap targets are at least 44×44 CSS px, overlapping hit areas play the nearest marker, and the viewport allows pinch-zoom | `e2e/taptargets.spec.ts` (390x844 and 844x390, 1 and 4 players, isMobile, hasTouch) in `npm run smoke`; `tests/hit.test.ts` in `npm test` | 8de8d4a (17-26 px markers, `user-scalable=no`) |
| The builder's tray never squeezes the board it paints: on a phone a board square stays at least 18 CSS px, the whole tool panel is on the screen without scrolling, and every tray button is at least 44×44. Build a hole is on the title screen and its Back goes back there | `e2e/builder.spec.ts` ("builder board on a phone" at 390x844, and the title-screen/Back case) plus `e2e/fit.spec.ts`'s builder cases, in `npm run smoke` | - (main before this fix: a 387px tray left a 173×267 board — a 13.3px square — at 390x844 while the play board was 334×514, and at 844x390 Undo, Clear, Share and Back were scrolled out of sight) |
| The builder judges a hole by the shots the rules offer, never by a path of ground: a river, a gorge or a row of trees right across the page plays when some legal shot carries it (`finishableCells`, which is exactly where `diceExpectation` is finite), and a forced carry has to hold in every wind and rain the round can deal, since a built hole takes the weather it is dealt. Only a gap no shot can cross, a pin nothing can reach, and a carry that needs fair weather are refused, each with its own reason | `finishableCells` in `src/engine/solver.ts` and `whyUnplayable` in `src/engine/builder.ts`; `tests/carry.test.ts` (a river across the page, a row of trees, a gorge wider than the longest hit, a walled-in pin, the water rule on a carry, the typical player holing out, and `finishableCells` held to `diceExpectation` cell for cell in four weathers), `tests/builder.test.ts`, `e2e/builder.spec.ts` ("builds a river right across the page and plays the carry") | 9bc0fa5, a8d07f2 (`whyUnplayable` asked `puttComponent` for a path of 1-dot putts, so every river across the map was "unreachable" — Derek, 24 Oct 2026) |
| The builder says what the hole still needs and why a tool refused, from pure functions with no solver in them (`builderStep`, `toolRefusal`); undo steps back over the par too; Share needs a hole that can be played and its link leaves the address bar on the next change | `builderStep`/`toolRefusal` in `src/engine/builder.ts` with `tests/builder.test.ts`; `e2e/builder.spec.ts` (the step line, the slope note, the par undo, the stale link, the Back warning) in `npm run smoke` | - (main before this fix: undo silently put back the par chosen after the last stroke, a slope on water painted nothing and said nothing, Share made a link for an unfinishable hole, and a reload after a share threw away every edit since) |
| The start screen fits its card on short landscape phones: title, pill and buttons inside the green card, the footer over no button, no console errors | `e2e/landscapestart.spec.ts` (card, footer, 44 px, console) plus `e2e/fit.spec.ts` (overflow), in `npm run smoke` | 70a5443 (GOLF ran off the card, footer over "How to play" at 844x390) |
| The phone play screen fits Safari's visible viewport: the Roll button and tray fully inside `innerHeight` and `visualViewport.height` with no scrolling, the strip under the board spaced (`Hole 1 · Par 4 · Strokes 0/4 · Total 0`) and never clipped | `e2e/iphone.spec.ts` (`@webkit`, WebKit iPhone 14 at 390x664, 390x844 and 375x548) in `npm run smoke`; `e2e/fourplayer.spec.ts` | 93f049e (fixed 118px tray overflowed: Roll 9.8px under Safari's toolbar at 390x664; strip read "Par 4Strokes: /4Total:") |
| Multiplayer turns follow golf etiquette: honour on the tee (setup order on hole 1, then lowest previous score, ties by previous tee), then the ball furthest away in dots; re-rolls and mulligans never pass the turn; round-robin saves continue with whoever is away | `tests/turns.test.ts` in `npm test`; `e2e/turnorder.spec.ts` (Chrome, and WebKit iPhone 14 via `@webkit`, 3 players over two holes) in `npm run smoke` | - |
| The rain falls in rain blue, not pencil grey: the colour is `rainLook.color` (the streaks' canvas only reads it), light enough that the course reads underneath | `tests/rainlook.test.ts` ("falls in a soft rain blue") in `npm test`; `e2e/rain.spec.ts` (the pixels on the rain canvas are on the blue side of neutral) in `npm run smoke` | - |
| The notebook look renders: every spiral loop resolves the `#coil` SVG symbol, evenly spaced, rising above the page edge; the desk is `src/assets/wood.webp` (served as WebP, under 150 KB, decoding), with no console errors | `e2e/look.spec.ts` (Chrome, and WebKit iPhone 14 via `@webkit`, 390x844 and 1440x900, cover and play screen) in `npm run smoke` | - |
| The wind pushes a hit its full vector and only the dot it ends on counts: never clamped at the edge or stopped early by water or trees; ending off the page, in water or in trees means the shot is not offered. A hit from the fairway is in the air over its aim, so a wind carries it on over trees there; water on the aim, trees on it from off the fairway, and every aim in a calm are unchanged (open questions, not decided) | `tests/windrule.test.ts` (the rule stated once, checked against `resolveShot` on ~250,000 seeded hits over all 90 holes; fails on 581f606, b2c6d1a, 1592349 and de40ff9), `tests/wind.test.ts` (applyWind), `tests/windbugs.test.ts` bugs 2, 3 and 4 plus "judged only by the dot it ends on" and "the wind carries a hit from the fairway on over trees at its aim" in `npm test`; `e2e/wind.spec.ts` `fix-*` cases in `npm run smoke` | de40ff9 (push stopped before trees: Lakeside hole 1, W 1, the N hit offered); fdb6b12 (main before this fix: trees on the aim stopped a fairway hit the wind carried off them — issue 1, Thunder Peaks hole 11, NE 1, the NE hit not offered) |
| Sand is a bunker wherever it lies, the green's ring included: the green is grass within 2 dots of the cup (`isGrass`/`onGreen`), so a ball resting in greenside sand reads the sand lie (`In the sand: −1`), earns no 2- or 3-dot putt and plays out with a hit of the roll less one; a dot next to the cup still taps in (the 1-dot putt holes from any lie). The solver, the saved round and the board's green all read the same predicate | `tests/sand.test.ts` (the lie, the −1, the moves per roll, the sand/green border, sand next to the cup, the restored save, the solver, and one `it.each` case per hole over all 90), `tests/green.test.ts` ("a bunker in the ring is not green at all") in `npm test`; `e2e/sand.spec.ts` (hit into a greenside bunker: the corner hint, the markers, the sand shot) in `npm run smoke` | main before this fix (7cd9dc3: `onGreen` counted every dot within 2 of the cup whatever the terrain, so 282 sand dots over the 90 holes said "On the green" and putted with no penalty) |
| A rainy hole plays wet and heavy: no slope rolls the ball (it stops where it comes to rest, after any wind push), every hit carries one space less, never below 1, and sand, water and the green's putts are untouched. Every hole stays finishable in the rain with its par unmoved, and a round saved before rain plays dry throughout | `tests/rain.test.ts` (the seeded roll, both effects, the game and the pre-rain save), `tests/rainsolver.test.ts` (one case per hole: the cup still reachable by putting, finite optimal play, inside its rainy window and at most 1.5 strokes dearer than dry), `tests/rainlook.test.ts` and `tests/saveguards.test.ts` in `npm test`; `e2e/rain.spec.ts` in `npm run smoke` | - |
| The layout's ResizeObserver (on the notebook; the board itself is sized by CSS) never re-fits inside its own callback: it goes through `deferredObserver` in `src/ui/layout.ts` (skips unchanged sizes, re-fits on the next frame), so WebKit never raises "ResizeObserver loop completed with undelivered notifications" | `e2e/iphone.spec.ts` "no ResizeObserver loop" (WebKit iPhone 14 at 390x664 and 390x844, new round and `?play=3&players=1&hole=1`, full motion, late web fonts, zero page/console errors) in `npm run smoke` | eee1735 (tray and HUD observers called `layout()` synchronously: page error on every load at 390x664) |
| e2e tests tap board markers only through `tapMarker()` (`e2e/tap.ts`: waits for the marker, taps its hit circle's centre), never `click({ force: true })` or a `click()` on a `circle.hit`/`g.target` locator, because overlapping hit circles make `click()` hang on some die rolls | `no-restricted-syntax` block for `e2e/**/*.ts` in `eslint.config.js`, run by `npm run lint` in `npm run check`, lint-staged and CI | 40cd666 (`click({ force: true })`); 9a2f7ff (merge dropped `e2e/tap.ts` from 6d21d8f) |
| The iPhone WebKit project runs exactly the tests tagged `@webkit` (`{ tag: '@webkit' }` on the `test` or `test.describe`); `playwright.config.ts` lists no spec names for it | `iphone-webkit` project `grep: /@webkit/` in `playwright.config.ts`; `npx playwright test --list --project=iphone-webkit` | - (hand-synced `testMatch` list, audit item 4) |
| Every screen fits every phone and desktop size: every control and must-see box (HUD, chips, board, strip, die, hole card) inside `innerHeight`, `visualViewport` and the width, not cut off by the page or a sheet (scrolling a scrollable box is fine), no page overflow, no console or page errors; no known overflows remain, and a new one fails (no `fixme` entries) | `e2e/fitcases.ts`, run by `e2e/fit.spec.ts` (the upright phone sizes) and `e2e/fitwide.spec.ts` (a phone on its side and a desktop): cover, setup, builder, play before/after a roll, How to play, hole card, My holes, the course editor, Practice and the scorecard × 390x844, 390x664, 375x548, 844x390, 740x360, 1440x900 × 1 and 4 players × Chrome and WebKit iPhone 14 via `@webkit`, in `npm run smoke` | 04c7d2d (main on 17 Oct: 4-player chips wholly off the page at 390x664; hole-card buttons cut off by the page edge on narrow pages) |
| A HUD player chip reads on one line ("● Player 1 0"): its name and strokes never wrap onto a second line or run out of the chip | `e2e/fitcases.ts` (every chip on every play and hole card case, Chrome and WebKit iPhone 14 via `@webkit`) in `npm run smoke` | e3d3a49 (main on 19 Oct: "Player 1" on two lines in WebKit at 390x664) |
| Every saved field has a guard, and every array and object in a save is checked per element: `loadState`/`isValidState` are built from `STATE_GUARDS` (`satisfies GuardTable<GameState>`); objects and arrays need a `Checked` guard that only `shape`/`arrayOf` (and `optional`/`nullable`/`orElse` around them) make, never a bare `Array.isArray` | Types: `GuardTable`/`FieldGuard` in `src/game/game.ts`, run by `npm run typecheck` (a `GameState` field without a guard, or `Array.isArray` for an array, fails); `tests/saveguards.test.ts` (one malformed case per guard, a coverage test over every `STATE_GUARDS` key, legacy and pre-wind saves, `expectTypeOf` checks) in `npm test` | 583a387 (balls checked as an array, not per element); `current`, `dice`, `holeDone`, `finished` never checked |
| A saved hole or course is read back field by field, and one entry that does not read is dropped on its own rather than costing the player the rest: `parseLibrary` filters with `shape`/`arrayOf` guards (a hole also has to be a page the builder could have drawn, `holeToDraft`), and junk, a missing version or a version this release does not know reads as an empty library | `parseLibrary` and the guards in `src/game/library.ts` (built from `src/game/guards.ts`); `tests/library.test.ts` (one case per malformed field, courses included, plus the round trip) in `npm test` | - |
| A built-in hole has a stable id (`b:<course>:<number>`, carried by every generated hole), so a saved course keeps pointing at the same hole; the library's shape is stated once in `src/engine/holeid.ts` and held to the generator's | `tests/library.test.ts` ("is the shape of the built-in library", `BUILTIN_COURSES`/`BUILTIN_HOLES_PER_COURSE` against `COURSES.length`/`PROPER_HOLES`, and the id on a generated hole) in `npm test` | - |
| A round on a custom course carries that course's 18 hole ids in its own save, never the course: renaming or deleting the course leaves the round alone, and a saved hole that has gone stops the round loading rather than playing some other hole in its place. The three `custom*` fields are all there or none | `STATE_GUARDS` + the coherence check in `isValidState` and the `HoleSource` check in `loadState` (`src/game/game.ts`); `tests/customcourse.test.ts` and `tests/saveguards.test.ts` in `npm test`; `e2e/mycourses.spec.ts` in `npm run smoke` | - |
| A round of one hole — a hole just drawn, or one played as practice — is never saved and never a best, so it leaves the round in progress and the bests exactly as they were | `newBuiltRound`/`newPracticeRound` (not `PersistedGame`) and `recordsCourseBest` in `src/game/game.ts`; `tests/customcourse.test.ts`; `e2e/mycourses.spec.ts` "leaves the round in progress and the bests alone" and `e2e/builder.spec.ts` in `npm run smoke` | - |
| Only a real round is saved: `saveGame` takes a `PersistedGame`, which only `newGame` and `loadState` return; a `?play=` round comes from `newLinkGame` (a plain `GameState`) and can never be saved or clear the save | Types (`saveGame(g: PersistedGame)` in `src/main.ts`), `tests/saveguards.test.ts` "only a saved round can be saved", `e2e/playlink.spec.ts` and `e2e/smoke.spec.ts` in `npm run smoke` | 223b814 (a `?play=` round overwrote the real save) |
| The verify doctor accepts Chrome on macOS and Linux: `CHROME_PATH` if set, then the macOS app, `/usr/bin/google-chrome`, then `google-chrome-stable` and `chromium` on `PATH`. WebKit may live in the macOS Library cache or `~/.cache/ms-playwright` | `scripts/verify.sh`; `test-ship.sh` case `verify_chrome_doctor` | - |
| The pull-request review calls the Anthropic Messages API. It does not use claude-code-action. The script and the rules are the copies on the base commit, and an API error is quoted on the sticky comment | `scripts/claude-review.mjs`; `test-ship.sh` cases `ci_claude_review_on_every_pr` and `review_status_api_error`; `tests/claude-review.test.ts` | 9f5ae88 (claude-code-action; every run failed, e.g. 39590742159, credit balance) |
| The Claude review judges the diff against the spec: a finding outside the stated scope and a description that is out of date are NITs, a finding already raised and addressed is not re-raised, and only a bug, a security issue, failing behaviour or a broken repo rule is BLOCKING | `REVIEW.md`; `scripts/claude-review.mjs` (`settleFindings`, the prompt's severity procedure); `tests/claude-review.test.ts`; `test-ship.sh` case `ci_claude_review_on_every_pr` | [PR 28](https://github.com/derek-hobden/paper-golf/pull/28) comments [4350577654](https://github.com/derek-hobden/paper-golf/pull/28#discussion_r4350577654), [4350754811](https://github.com/derek-hobden/paper-golf/pull/28#discussion_r4350754811), [4350833026](https://github.com/derek-hobden/paper-golf/pull/28#discussion_r4350833026); [PR 30](https://github.com/derek-hobden/paper-golf/pull/30) [4351821025](https://github.com/derek-hobden/paper-golf/pull/30#discussion_r4351821025) re-posted as [4351860648](https://github.com/derek-hobden/paper-golf/pull/30#discussion_r4351860648) |
| The sticky review-status comment is listed and created under the pull request (`issues/<pr>/comments`) but edited on its own path (`issues/comments/<id>`): the nested edit path is not a route. Every claude-review run refreshes that one comment, the blocking verdict included, and a run that cannot write it says so in plain English instead of leaking gh's `Not Found (HTTP 404)` | `scripts/ship/review-status.sh`; `test-ship.sh` cases `review_status_comment_endpoint`, `review_status_comment_created`, `review_status_comment_gone`, `review_status_comment_no_permission` and `review_status_blocked` | a9e82eb (`issues/${pr}/comments/${id}`: 404 on every run after the first, e.g. PR 10 run 39603791868; PR 15 kept the previous run's words, run 39603839014) |
| qs stays on a patched release: `typed-rest-client` (under `@stryker-mutator/core`) pins `qs` exactly, so only the `overrides` entry in package.json holds it there, and a lockfile regenerated without that entry brings the vulnerable version back | `overrides` in `package.json`; `tests/deps.test.ts` (the override is declared, and every `qs` the lockfile resolves is at least the patched release) in `npm test` | - (Dependabot alert 1: qs 6.15.1, `qs.stringify` DoS GHSA-q8mj-m7cp-5q26) |
