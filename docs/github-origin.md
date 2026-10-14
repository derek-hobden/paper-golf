# Paper Golf: moving origin to GitHub (Derek-yes steps)

Plan job 6 (Homelab Hal, 14 Oct 2026; Derek's decisions 13:46, 13:47, 13:51). The job that wrote this prepared the
repo only: `ci.yml` (CI on push to `main`, then a Vercel preview deploy; production only by a confirmed dispatch),
`scripts/ship/check.sh` and `push-to-main.sh`, and the "Ship process" in `CLAUDE.md`. **It ran none of the steps
below.** Each one changes something outside the repo and needs Derek's yes for that step, recorded first, and runs
through the bots-work gate. Do them in order; stop at the first check that fails.

Names used below:

```sh
JOB=/Users/anton/bots-work/jobs/20261014-143640-pg-github-origin   # the job whose commit becomes main
CLONE=/Users/anton/bots-work/repos/paper-golf                     # shared clone; every paper-golf job worktree uses its .git
BARE=/Users/anton/bots-work/repos/.paper-golf.git                 # the old local origin (retired by step 5)
GH=https://github.com/derek-hobden/paper-golf.git
SHA=<the full sha Derek approved: jq -r .commit $JOB/approvals/main.json>
```

Why the first push is special: local `main` (and the bare repo's `main`) is **bfbfb25**, the Hal-infra commit with
`mirror-to-github.sh`, whose `refs/tags/*` refspec the gate read as a production tag push. It must never reach
GitHub. GitHub `main` starts from this job's branch, which is built on **7007c68**. Paper Golf uses **no tags**.

## 0. Preconditions (read-only; Hal or Derek)

```sh
gh repo view derek-hobden/paper-golf --json visibility,isEmpty      # {"isEmpty":true,"visibility":"PRIVATE"}
gh secret list -R derek-hobden/paper-golf                          # names only: VERCEL_TOKEN (Derek adds it, D4)
grep -n 'VERCEL_TOKEN' $JOB/worktree/.github/workflows/*.yml        # only ci.yml deploy-preview / deploy-production read it
git -C $JOB/worktree merge-base --is-ancestor 7007c68 $SHA && echo "on 7007c68: ok"
git -C $JOB/worktree merge-base --is-ancestor bfbfb25 $SHA && echo "STOP: contains bfbfb25" || echo "no bfbfb25: ok"
git -C $JOB/worktree ls-remote $GH                                 # empty: nothing on GitHub yet, no tags
bash $JOB/worktree/scripts/ship/wait-for-next-stage.sh --link      # with VERCEL_TOKEN already in the env: "vercel link: none"
```

`VERCEL_TOKEN` must be set before step 1, or the first `deploy-preview` job fails red (`repo secret VERCEL_TOKEN is not
set`). The Vercel project must have **no** Git integration (`--link` prints `none`): no Vercel GitHub app, no Ignored
Build Step (D4). No rulesets or branch protection (D3).

## 1. First push of `main` to GitHub — needs Derek's main yes for $SHA

Record the yes and the local checks for the exact commit, then push that commit as `main`, by sha, with no tags:

```sh
~/bots-work/lib/record-approval.sh 20261014-143640-pg-github-origin main --by Derek --as "Homelab Hal" --quote "<his yes>"
~/bots-work/lib/record-checks.sh 20261014-143640-pg-github-origin        # runs scripts/ship/check.sh on HEAD = $SHA
# through the gate (job 1 path: a Claude Code follow-up in $JOB/worktree with approval_for_sha passing for $SHA):
git -C $JOB/worktree -c push.followTags=false push $GH $SHA:refs/heads/main
```

`push-to-main.sh` is not used for this one push: it needs `origin` = GitHub and an existing `origin/main`, which only
exist after steps 1-2. Verify:

```sh
git -C $JOB/worktree ls-remote $GH                                 # exactly one ref: $SHA refs/heads/main (no tags)
gh run list -R derek-hobden/paper-golf --workflow ci.yml --limit 1 # the push run: resolve, check, smoke, deploy-preview
bash $JOB/worktree/scripts/ship/wait-for-next-stage.sh $SHA --from pushed   # until preview-ready; never production-*
```

## 2. Switch the local origin to GitHub — needs Derek's yes

`$CLONE/.git` is shared by every paper-golf job worktree, so first make sure no paper-golf job is live (e.g. the
`pg-onboarding` branch's job): each must be finished and shipped, torn down or acknowledged.

```sh
~/bots-work/bin/jobs-status --active --as "Homelab Hal"            # no running paper-golf job
git -C $CLONE worktree list                                        # only $CLONE plus finished jobs' worktrees
git -C $CLONE status --porcelain                                   # empty
git -C $CLONE remote rename origin local-bare                      # keeps the bare repo reachable until step 5
git -C $CLONE remote add origin $GH
git -C $CLONE fetch origin
git -C $CLONE ls-remote origin                                     # refs/heads/main = $SHA, no tags
```

After this, new job worktrees (`run-job.sh`: `git pull --ff-only` on `$CLONE` main, then `worktree add`) come from
GitHub once step 3 has moved local `main`.

## 3. Move local `main` off bfbfb25 — needs Derek's yes

Local `main` is bfbfb25 and diverges from GitHub `main` ($SHA), so `git pull --ff-only` would fail. Keep bfbfb25 on a
local backup branch (a branch, not a tag; never pushed), then move `main`:

```sh
git -C $CLONE status --porcelain                                   # must be empty
git -C $CLONE branch backup/bfbfb25-hal-infra bfbfb25
git -C $CLONE reset --keep origin/main                             # main checked out in $CLONE; --keep refuses to drop local changes
git -C $CLONE branch --set-upstream-to=origin/main main
git -C $CLONE rev-parse main origin/main                           # both $SHA
git -C $CLONE merge-base --is-ancestor bfbfb25 main && echo "STOP" || echo "bfbfb25 not on main: ok"
```

## 4. First production deploy — needs Derek's separate prod yes for $SHA (recorded by Golf Gary)

Only after staging (the preview deploy of $SHA) is green and Derek said yes again for production:

```sh
~/bots-work/lib/record-approval.sh <job> prod --by Derek --as "Golf Gary" --quote "<his prod yes>"
# through the bots-work release gate for the prod step (today release-job.sh <job> --step prod --run ...;
# never gh workflow run directly — bin/gate refuses it):
gh workflow run ci.yml -R derek-hobden/paper-golf --ref main -f sha=$SHA -f confirm=deploy-production
```

The dispatch run checks that `$SHA` is a full sha on `main`, re-runs `check` + `smoke` on it, then
`deploy-production` (`vercel deploy --prebuilt --prod`). Verify:

```sh
gh run list -R derek-hobden/paper-golf --workflow ci.yml --event workflow_dispatch --limit 1
bash $JOB/worktree/scripts/ship/wait-for-next-stage.sh $SHA --from preview-ready    # until production-ready
```

## 5. Last step: archive and delete the bare repo — needs Derek's yes, only after 1-4 are verified

Only when GitHub `main` = `$CLONE` `main`, CI on GitHub is green, the clone's origin is GitHub and no job worktree
or remote still points at the bare repo (decision 5).

```sh
git -C $CLONE ls-remote origin refs/heads/main                     # = git -C $CLONE rev-parse main
git -C $CLONE remote -v                                            # origin = $GH; local-bare = $BARE (removed below)
test ! -s $CLONE/.git/objects/info/alternates && echo "no alternates: ok"   # the clone doesn't borrow objects from $BARE
git -C $BARE fsck --full
mkdir -p /Users/anton/bots-work/archive
git -C $BARE for-each-ref --format='%(objectname) %(refname)' > /Users/anton/bots-work/archive/paper-golf-bare-20261014.refs.txt
tar -czf /Users/anton/bots-work/archive/paper-golf-bare-20261014.tar.gz -C /Users/anton/bots-work/repos .paper-golf.git
shasum -a 256 /Users/anton/bots-work/archive/paper-golf-bare-20261014.tar.gz > /Users/anton/bots-work/archive/paper-golf-bare-20261014.tar.gz.sha256
```

Verify the archive by restoring it somewhere else and comparing:

```sh
shasum -a 256 -c /Users/anton/bots-work/archive/paper-golf-bare-20261014.tar.gz.sha256
mkdir /Users/anton/bots-work/archive/verify-paper-golf-bare
tar -xzf /Users/anton/bots-work/archive/paper-golf-bare-20261014.tar.gz -C /Users/anton/bots-work/archive/verify-paper-golf-bare
git -C /Users/anton/bots-work/archive/verify-paper-golf-bare/.paper-golf.git fsck --full
git -C /Users/anton/bots-work/archive/verify-paper-golf-bare/.paper-golf.git for-each-ref --format='%(objectname) %(refname)' \
  | diff - /Users/anton/bots-work/archive/paper-golf-bare-20261014.refs.txt && echo "refs match: ok"
git -C /Users/anton/bots-work/archive/verify-paper-golf-bare/.paper-golf.git cat-file -e bfbfb25^{commit} && echo "bfbfb25 kept: ok"
```

Then delete the bare repo and the scratch restore, and drop the old remote:

```sh
rm -rf /Users/anton/bots-work/archive/verify-paper-golf-bare
rm -rf /Users/anton/bots-work/repos/.paper-golf.git
git -C $CLONE remote remove local-bare
git -C $CLONE fetch origin && git -C $CLONE status -sb             # "## main...origin/main", nothing else changed
```

Keep `paper-golf-bare-20261014.tar.gz`, its `.sha256` and `.refs.txt` in `~/bots-work/archive/`.

## What only a real GitHub run proves

- `deploy-preview` and `deploy-production` with the real `VERCEL_TOKEN`, team `derek-hobden` and the project ids
  (`vercel pull/build/deploy --prebuilt`); the tests here only check the workflow text and actionlint.
- That a push to `main` makes no production deployment, and that the preview URL serves the game.
- `wait-for-next-stage.sh` matching CLI deployments by `meta.githubCommitSha` (the CLI sets it from the checkout).
- `push-to-main.sh` against the real `origin` and the live bots-work `approval-lib.sh` (tests use a copy).
