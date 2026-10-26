# Rolling this pipeline out to another repository

What to copy, what to set, and in what order, to give another repository the pipeline Paper Golf runs: every
change a pull request, the free checks on every push, the paid jobs only on a ready mark, approval by label,
auto-merge, and a deploy off the merge.

Nothing here needs a particular coding tool, a bot or anyone's personal API key. A person hand-coding, Claude
Code, Codex, Cursor or anything else goes through the same pipeline. Shared credentials are repository secrets.

**No secret values belong in this file.** It names the secrets; the values live in GitHub's secret store and in
the Claude and Vercel consoles.

Work the sections in order: a secret missing at step 4 fails a job that step 3 turned on.

---

## 1. Copy the files

### Workflows — `.github/workflows/`

| File | What it does | Needed for |
| --- | --- | --- |
| `ci.yml` | `check` + `smoke` on every pull request and every push to main; the normal and the emergency dispatch; uploads the deploy request | always |
| `ready-gate.yml` | the free required check: has the review passed since the pull request was last marked ready | always |
| `claude-review.yml` | the Claude review, on a ready mark only (**paid**) | always |
| `pr-video.yml` | the check that the explainer video link is the first line of the body | always |
| `pr-video-record.yml` | films the `## How to see it` steps; runs the pull request's code and holds no secret | always |
| `pr-video-publish.yml` | narrates, uploads the mp4 to this month's video shelf (a `pr-videos-YYYY-MM` prerelease) and writes the link into the body; holds the secrets, never runs the head (**paid**) | always |
| `pr-video-tidy.yml` | when a pull request closes, deletes its superseded videos from the shelves and keeps the linked one; main's copy, never runs the head | always |
| `owner-approval.yml` | the `approved` label becomes the app's APPROVE review; a push drops it | always |
| `pr-signal.yml` | the one `<!-- pr-ready -->` and one `<!-- pr-blocked -->` comment a watcher reads | always |
| `auto-merge.yml` | turns GitHub's squash auto-merge on when a pull request opens | always |
| `update-branches.yml` | brings auto-merge pull requests up to date when main moves, one run at a time, oldest first | always |
| `reconcile-ci.yml` | gives a main commit with no CI run of its own one dispatch, so every merge deploys | only with a deploy |
| `deploy.yml` | staging, its smoke, production, its smoke and the rollback | only with a deploy |
| `metrics.yml` | the weekly pipeline numbers issue | optional |

### Ship scripts — `scripts/ship/`

Copy the whole directory. The workflows call these by path, and `test-ship.sh` is what proves they still behave.

| Group | Files |
| --- | --- |
| shared | `lib.sh` (**edit it**: see section 2), `retry.sh`, `container-chrome.sh` |
| the checks | `check.sh`, `test-touch.sh`, `diff-cover.sh`, `mutate.sh`, `report-flaky.sh` |
| the paid decision and the gate | `paid-trigger.sh`, `ready-gate.sh`, `review-status.sh` |
| approval and merge | `owner-approve.sh`, `auto-merge.sh`, `pr-risk.sh`, `update-pr-branches.sh`, `pr-refresh-fields.sh` |
| the signal | `pr-signal.sh` |
| the explainer video | `pr-video.sh`, `pr-video-record.sh`, `pr-video-script.sh`, `pr-video-narrate.sh`, `pr-video-join.sh`, `pr-video-mux.sh`, `install-ffmpeg.sh` (the pinned static ffmpeg both publish jobs use), `pr-video-audio-gate.sh` (with its helper `pr-video-audio-gate.py` and its hash-pinned `audio-gate-requirements.txt`), `pr-video-upload.sh`, `pr-video-body.sh`, `pr-video-publish.sh`, `pr-video-tidy.sh` |
| deploy | `deploy-gate.sh`, `deploy-summary.sh`, `deploy-batch.sh`, `start-deploy.sh`, `read-ci-run.sh`, `reconcile-ci.sh`, `same-tree.sh`, `pipeline-failure.sh`, `wait-for-next-stage.sh` |
| retired, kept to refuse | `push-to-main.sh` |
| numbers | `weekly-metrics.sh` |
| the tests for all of it | `test-ship.sh` and `test-fakes/` (`gh`, `curl`, `git`, `npm`, `actionlint`, and `gh-releases`, the releases API both fakes model) |

### The rest

| File | Why |
| --- | --- |
| `scripts/claude-review.mjs` + `scripts/claude-review.d.mts` | the reviewer itself: it calls the Anthropic Messages API and reads the rules from the base commit |
| `scripts/verify.sh` | the one command a job's done-when runs |
| `scripts/gh-as-gus.sh` | optional: opens a pull request as the app, where the credentials allow it |
| `.github/pull_request_template.md` | the `## Spec` and `## How to see it` sections the review and the video read |
| `.github/pr-approvers` | the approver allowlist, unless the repository sets the `APPROVERS` variable instead |
| `.github/dependabot.yml` | optional: one weekly pull request per ecosystem |
| `AGENTS.md`, `REVIEW.md` | **the rules the review enforces.** Rewrite them for that repository: the reviewer reads them, so they are the review |
| `tests/ship.test.ts`, `tests/workflows.test.ts` | run the bash cases and the workflow guards inside the repository's own test command |
| `.nvmrc`, `package.json` scripts | the workflows call `npm ci`, `npm run check`, `npm run smoke`, `npm run smoke:quick`, `npm run verify`. A repository that is not Node has to provide the same four names, or edit the workflows |

---

## 2. Edit what is Paper Golf's

These are the only values hard-coded to this repository. Change them before the first run.

| Where | Value | Change it to |
| --- | --- | --- |
| `scripts/ship/lib.sh` | `SHIP_REPO` default (`derek-hobden/paper-golf`) | the new `owner/repo`. Every workflow also passes `SHIP_REPO: ${{ github.repository }}`, so the default only matters when a person runs a script by hand |
| `scripts/ship/lib.sh` | `SHIP_VERCEL_PROJECT`, `SHIP_VERCEL_TEAM` | the new project's and team's ids (not secrets). Drop them with the deploy |
| `.github/workflows/deploy.yml` | `STAGING_URL` (`paper-golf-staging-derek-hobden.vercel.app`) | the new staging alias |
| `scripts/ship/pipeline-failure.sh` | the `@derek-hobden` mention on a pipeline-failure issue | whoever should be woken |
| `scripts/ship/auto-merge.sh`, `scripts/ship/review-status.sh`, `.github/workflows/auto-merge.yml` | `derek-hobden` in the plain-English messages | the new owner's login, or wording that names nobody |
| `.github/pr-approvers` | `derek-hobden` | the logins that may approve by label, one per line |
| `playwright.config.ts`, the `smoke-shard` and `staging-smoke` matrices | the projects and the shard split | the new suite's projects. `tests/workflows.test.ts` fails until both matrices list every project |

---

## 3. Repository settings

**Settings → General**

- **Allow squash merging** on; squash is what auto-merge uses.
- **Allow auto-merge** on. Without it, `auto-merge.yml` reports a refusal in plain English and nothing merges by
  itself.
- **Allow update branch** on, so `update-branches.yml` can use GitHub's own update instead of its merge fallback.
- **Automatically delete head branches** on.

**Settings → Branches → branch protection rule for `main`**

- **Require a pull request before merging**, with **1 approval**.
- **Dismiss stale pull request approvals when new commits are pushed** on. `owner-approval.yml` removes the
  `approved` label on a push and dismisses the app's own review as well, so the label and the approval always
  agree — but this setting is what makes it true for a human's Approve too.
- **Require status checks to pass before merging**, and require exactly these four:
  - `check`
  - `smoke`
  - `pr-video`
  - `ready-gate`
- **Do not require** `claude-review`: it does not run on every commit, and `ready-gate` carries its verdict.
  **Do not require** `mutation`: it is advisory.
- Leave **Require review from Code Owners** off unless `CODEOWNERS` names the app; an App is not a code owner,
  so turning it on withholds the merge no matter what the label does.
- Do not allow pushes to `main`. Every change is a pull request.

**Labels** (Issues → Labels; a person has to be able to add the first two by hand)

| Label | Who adds it | What it does |
| --- | --- | --- |
| `approved` | an approver | the app submits the APPROVE review for that head commit |
| `ready` | anyone | asks for another Claude review and another video (a fresh ready mark) |
| `risk:low`, `risk:high` | the review job | informational; does not gate the merge |
| `flaky` | CI | the `flaky test: <name>` issue |
| `pipeline-failure` | the deploy | the issue that wakes a person |
| `pipeline-metrics` | the weekly job | the numbers issue |

The review job creates `risk:*` itself with `--force`; create `approved` and `ready` before the first pull
request, since a label has to exist before anyone can add it.

---

## 4. Repository variables and secrets

**Settings → Secrets and variables → Actions → Variables**

| Variable | Value | Needed for |
| --- | --- | --- |
| `APPROVERS` | the logins that may approve by label, separated by commas, spaces or newlines | optional. Unset, the allowlist is `.github/pr-approvers` on the base branch. The variable wins when it is set |

**Settings → Secrets and variables → Actions → Secrets.** Shared keys, one set per repository — never anyone's
personal key.

| Secret | Used by | Without it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `claude-review.yml`, the video's narration script | the review job fails and says which secret is missing |
| `OPENROUTER_API_KEY` | the video's voice (`pr-video-narrate.sh`) | the publish workflow's `make` job fails before it spends anything |
| `GOLF_GUS_APP_ID` | auto-merge, owner approval, the signal, the video body edit | those jobs fail in plain English |
| `GOLF_GUS_APP_KEY` | the same (the app's PEM private key) | the same |
| `VERCEL_TOKEN` | `deploy.yml` only, through `env` and never `--token` | no deploy. Drop it with the deploy |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | the smoke against a protected deployment | the staging smoke cannot load the page |

**Settings → Secrets and variables → Dependabot → Secrets.** A Dependabot pull request cannot read the Actions
store, so these three have to exist in the **Dependabot secrets** as well, with the same values, or the review
job and the auto-merge job cannot run on those pull requests:

- `ANTHROPIC_API_KEY`
- `GOLF_GUS_APP_ID`
- `GOLF_GUS_APP_KEY`

---

## 5. The GitHub App

The app is how a workflow writes what `GITHUB_TOKEN` may not: GitHub refuses `enablePullRequestAutoMerge` to a
workflow's own token, a Dependabot run only ever gets a read-only one, and no token can approve a pull request
on behalf of its author.

Use the existing **Golf Gus Bot** app, or create one for that repository (the same secret names, so nothing
else changes):

1. Create the App (a personal or organisation Developer settings → GitHub Apps → New GitHub App). No webhook,
   no callback URL.
2. **Repository permissions**: Contents **read and write** (the explainer video is an asset on a release, and
   the upload needs it), Metadata read, Pull requests **read and write**, Issues **read and write**, Checks
   **read and write**, Actions **read and write**.
3. **Install it on the repository** (Install App → that repository only).
4. Generate a private key, and put the app id in `GOLF_GUS_APP_ID` and the whole PEM — `BEGIN`/`END` lines
   included — in `GOLF_GUS_APP_KEY`, in the Actions store and the Dependabot store.
5. The workflows pin `actions/create-github-app-token@v2`, which takes `app-id`. v3 deprecates it for
   `client-id`, so taking that bump means adding the app's client id as a secret first.

The app's APPROVE review is what satisfies "1 approval" for a pull request its author cannot approve. If an App
approval ever stops counting on a repository, the smallest alternative is a second human on `APPROVERS` — not a
change to branch protection, and not an admin override as the normal path.

---

## 6. The Claude Console

The review and the narration call the Anthropic Messages API with `ANTHROPIC_API_KEY`.

1. In the Claude Console, create a **workspace for the repository** and create the API key **inside that
   workspace**, so one repository's spend is visible and limitable on its own.
2. **Leave the workspace spend limit unset**, so only the organisation limit applies. A low workspace spend
   limit does not fail loudly: the API refuses the call and `claude-review` goes red with an API error on its
   sticky comment, which reads like a broken pipeline rather than a budget. Set the budget at the organisation
   level and watch it there.
3. Put that key in the repository's Actions secrets and Dependabot secrets as `ANTHROPIC_API_KEY`.

The narration model is pinned exactly in `pr-video-script.sh` (`claude-sonnet-5-5`, no thinking field, no fallback). The
voice is OpenRouter (`OPENROUTER_API_KEY`), whose model and voice are pinned in `pr-video-narrate.sh` and
are not overridable. The audio gate (`pr-video-audio-gate.sh`) needs no key and runs in a job with no secret:
it is ffmpeg and faster-whisper, installed from the hash-pinned `scripts/ship/audio-gate-requirements.txt`
(regenerate it with `pip-compile --generate-hashes --allow-unsafe --strip-extras` under Python 3.12 from
`faster-whisper==<version>`), with the model pinned to a Hugging Face revision in that script and cached by
`actions/cache`.

**ffmpeg for the explainer.** Both publish jobs that need ffmpeg (`make` and `gate`) take it from
`scripts/ship/install-ffmpeg.sh`, never apt: `apt-get update && apt-get install ffmpeg` hung to the step limit
on `ubuntu-latest` (PR video publish run 40350234858, both attempts). The script downloads one static Linux
x86_64 build, `ffmpeg-linux-x64.gz` and `ffprobe-linux-x64.gz`, from the release named in `FFMPEG_RELEASE`
(a fixed tag of `eugeneware/ffmpeg-static`, never `latest`), checks each against `FFMPEG_SHA256` and
`FFPROBE_SHA256` before unpacking it, fails on a mismatch, and puts the binaries on `GITHUB_PATH`. The archives
are cached by a pinned `actions/cache` keyed on `install-ffmpeg.sh --key`, which is those two checksums. A runner
that already has both tools skips it. To bump the build: set `FFMPEG_RELEASE` to another fixed release tag,
download both assets, and write their `sha256sum` into `FFMPEG_SHA256` and `FFPROBE_SHA256`; the cache key
follows on its own. Nothing to configure, and no secret.

---

## 6a. The explainer video's shelves

The mp4 is an asset on a **PR video shelf**, one prerelease per UTC month, tagged `pr-videos-YYYY-MM`:
`https://github.com/<owner>/<repo>/releases/download/pr-videos-YYYY-MM/pr-<number>-<short sha>.mp4`.

- Nothing to set up: `scripts/ship/pr-video-upload.sh` looks the month's shelf up by tag and creates it on the
  month's first video — a prerelease, `make_latest=false`, so the releases page never shows a version of the
  product that does not exist. One asset per head commit; remaking a video for the same commit replaces its
  asset.
- GitHub caps a release at 1,000 assets, so a shelf holding 900 (`SHELF_ROLL_AT`) rolls early to
  `pr-videos-YYYY-MM-2`, then `-3`, up to `MAX_SHELVES_PER_MONTH`, which fails loud. A repository that already
  had the single `pr-videos` release keeps it as the legacy shelf: its links stay valid and it takes no new
  video.
- The prefix (`SHIP_VIDEO_SHELF_PREFIX`) and the shelf-name pattern are set in `lib.sh` only.
- `.github/workflows/pr-video-tidy.yml` runs `scripts/ship/pr-video-tidy.sh` when a pull request closes: it
  keeps the video the body links to and the final head's, deletes the pull request's other `pr-<number>-*`
  videos from every shelf, and in doubt deletes nothing. It needs no secret and no app token: the job's own
  `github.token` with `contents: write` only (deleting a release asset needs no more), and it runs main's copy
  with the default branch checked out, skipping a fork's close.
- It needs **Contents: read and write** on the App (section 5). The publish workflow's own `GITHUB_TOKEN` is
  deliberately left read-only in every job: it never calls the releases API, and it handles an artifact the pull
  request's own code produced. Only the `upload` job mints the app token, and only after the `gate` job (no
  secret, Contents read) has passed the video.
- The shelves are the only tags the pipeline creates, and no workflow triggers on a tag.
- Do **not** go back to `uploads.github.com/user-attachments/assets`. That URL plays inline in the browser,
  which a release asset does not, but it is GitHub's undocumented web-upload endpoint and it answers **404 to
  an App or Actions token** — there is no user to attach the asset to. It failed on every pull request that
  reached it, after the video had been recorded and narrated and the money spent.

## 7. Prove it, in this order

1. **Open a draft pull request.** `check`, `smoke`, `pr-video` and `ready-gate` run. `pr-video` passes (a draft
   has no video yet) and `ready-gate` is red on purpose. Nothing has cost anything.
2. **Mark it ready.** `claude-review` and the two video workflows run. The video is recorded, narrated and
   uploaded to the month's `pr-videos-YYYY-MM` shelf, its link lands as the first line of the body, `pr-video` goes green,
   and `ready-gate` goes green when the review passes. Note that `pr-video-publish.yml` is a `workflow_run`, so
   GitHub runs **main's** copy: on the pull request that first adds this pipeline, no video publishes until it
   merges, and `pr-video` has to be waived for that one.
3. **Watch for the signal.** One comment opening `<!-- pr-ready -->` appears once everything is green. Break
   something paid on purpose and one comment opening `<!-- pr-blocked -->` names it and links its run.
4. **Add the `approved` label** as someone on the allowlist: the app's APPROVE review appears, naming who
   approved and at which head commit, and GitHub's auto-merge merges the pull request. Add it as someone who is
   not on the allowlist and it comes off again with a comment.
5. **Push another commit after approving**: the approval and the label both go, and have to be asked for again.
6. **Merge two pull requests close together** and watch `update-branches.yml` queue rather than race: one run at
   a time, pull requests oldest first, and no review or video re-run.
7. **With a deploy:** the merge's CI run deploys to staging, smokes it, promotes production and smokes that. A
   staging, production or rollback failure opens a `pipeline-failure` issue.

## What is deliberately not here

- **No previews.** No branch or pull request deploys at all. To see a change running, run it locally.
- **No tags but the video shelves.** Nothing pushes or triggers on a tag; the only tags are the shelves the
  upload creates through the releases API.
- **Nothing pushes to main.** `push-to-main.sh` only refuses, and branch protection refuses too.
- **No personal keys, no required tool.** Everything shared is a repository secret, and every job runs on
  GitHub's runners.
