# Link the Vercel project to GitHub (Homelab Hal)

Derek approved option 1 (14 Oct 2026, 12:42 GST): paper-golf lives in the private GitHub repo
`derek-hobden/paper-golf`, linked to Vercel project `prj_2wXuwwaoThxXs8GAfBfcreeFeWO0`
(team `team_NOIeemLqazmSprS9Y1tgjYx1`), production branch `main`.

Linking must not start a production build. Production deploys stay off until Derek's prod yes
(for 7007c68 that comes separately through Golf Gary). Nothing here costs money: the Vercel GitHub
app and Git integration are part of the existing plan; if any screen asks for an upgrade or
payment, stop and ask Derek.

## Order

1. **Mirror first** (`scripts/ship/mirror-to-github.sh`, dry run, then `--yes` through the release
   gate after Derek's approval: `release-job.sh <job> --step main --run scripts/ship/mirror-to-github.sh
   --report <job>/evidence/gitleaks.json --yes`). The push to `main` happens before the link, so
   Vercel never sees that push event.
2. **Turn off production builds** (before linking), in the dashboard:
   Project → Settings → Git → **Ignored Build Step** → Behavior **Custom**, command:

   ```sh
   if [ "$VERCEL_ENV" = "production" ]; then echo "prod deploys off until Derek's yes"; exit 0; else exit 1; fi
   ```

   (exit 0 = skip the build, exit 1 = build). Save. Do not commit a `vercel.json` for this.
3. **Connect the repo**: Project → Settings → Git → Connect Git Repository → GitHub →
   `derek-hobden/paper-golf`. If asked to install the Vercel GitHub app on `derek-hobden`, choose
   **Only select repositories** → `paper-golf`.
4. **Production branch**: Project → Settings → Environments → Production → Branch Tracking → `main`
   (older UI: Settings → Git → Production Branch → `main`). Save.
5. Do **not** press Redeploy/Deploy, and do not run `vercel deploy` or `vercel --prod`.

## Verify (read-only)

```sh
gh repo view derek-hobden/paper-golf --json visibility                 # {"visibility":"PRIVATE"}
git -C /Users/anton/bots-work/repos/paper-golf ls-remote origin main    # = git -C ... rev-parse main
bash scripts/ship/wait-for-next-stage.sh --link                         # vercel link: derek-hobden/paper-golf production-branch=main
npm run test:ship                                                       # all cases ok
```

`--link` and the stage watch read `VERCEL_TOKEN` from the environment (never printed; without it they
report "unknown" and exit 0). The dashboard's Deployments list must show no new production deployment
after linking. A later push to `main` shows as `production-skipped` in
`wait-for-next-stage.sh <sha>` (Vercel records the ignored build as CANCELED).

## Turning production deploys on (only after Derek's prod yes)

Set Ignored Build Step back to **Automatic** (or remove the custom command). This is a production change:
record the prod approval first (`lib/record-approval.sh <job> prod ...`) and do the first production
deploy only through `release-job.sh`. Then watch it with
`bash scripts/ship/wait-for-next-stage.sh <sha> --from production-building` until `production-ready`.
