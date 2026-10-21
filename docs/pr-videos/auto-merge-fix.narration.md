# Auto-merge fix — explainer narration

Voice: OpenRouter `google/gemini-3.8-flash-lite-tts`, voice **Kore** (pcm → wav → mp4).
Rendered by `bash docs/pr-videos/make-auto-merge-video.sh`; this file is its `--script` output.

## 1. Paper Golf · auto-merge

- A green risk:low pull request sat waiting
- Nobody had to merge it by hand
- This is why, and what changed

> Paper Golf merges its own low risk pull requests. Dependabot opens one every week, the review passes, every check goes green, and then nothing happens. Here is why, and what this change does about it.

## 2. The old failure

- claude-review ran: gh pr merge --auto --squash
- GraphQL: Resource not accessible by integration
- (enablePullRequestAutoMerge)
- PR 13, run 39659612854

> The review job itself tried to turn auto-merge on. On a pull request opened by Dependabot, that run gets a read-only token, so GitHub refused the mutation: resource not accessible by integration. You can see it on pull request thirteen.

## 3. The misleading warning

- "auto-merge is off for this repo
- (Settings → General → Allow auto-merge)"
- Auto-merge was never off. The token could not merge.

> Worse, the step swallowed that refusal into a warning blaming the repository's auto-merge setting. That setting was never off. The token simply could not merge, so the log sent you looking in the wrong place.

## 4. The fix

- claude-review labels risk:low or risk:high, and stops there
- A new Auto-merge workflow runs on workflow_run
- contents: write + pull-requests: write
- It reads the pull request through gh api only

> The label still comes from the review job, where the token can write it. The mutation moves into a new workflow that runs after the review, on workflow_run, so it gets the repository's own token with contents write and pull requests write. It never checks out or runs the pull request's head: it reads the pull request through the GitHub API and decides.

## 5. The decision

- scripts/ship/auto-merge.sh
- risk:low and the review green → auto-merge on
- risk:high or unlabelled → off, as before
- closed or merged → no write at all
- a refusal is quoted with what it means

> The decision is a small script, scripts slash ship slash auto dash merge. Risk low with a green review turns auto-merge on. Risk high, an unlabelled pull request, or a review that did not pass leaves it off, exactly as before. A closed or already merged pull request is a no-op: nothing is written at all. And when GitHub does refuse, the script quotes the refusal and says which one it was, the token or the repository setting.

## 6. The proof

- Tests written first: 12 cases in test-ship.sh
- npm run check green · 503 tests
- Gate evidence in the pull request body
- GitHub still waits for every required check

> The tests came first: twelve cases covering every branch of that decision, run by npm test with the rest of the suite. The check command is green. And nothing here merges anything by itself. GitHub still waits for check, smoke, signoff and the review before it squashes.

