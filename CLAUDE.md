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
- `scripts/ship/` — bash ship tooling (`check.sh`, PR risk `pr-risk.sh`, deploy-watch `wait-for-next-stage.sh`,
  shared `lib.sh`, and `push-to-main.sh`, which is retired and refuses), tested by `scripts/ship/test-ship.sh`
  (fakes in `scripts/ship/test-fakes/`, temp local fixture repos), run from vitest by `tests/ship.test.ts`.
- Logic belongs in `engine`/`game` with a unit test; keep `ui`/`main.ts` thin.

## Ship process

Origin is GitHub `derek-hobden/paper-golf` (private); the canonical checkout is `~/repos/paper-golf`. There are
**no tags at all**, and **every change is a pull request to main: nothing ever pushes to main**
(`scripts/ship/push-to-main.sh` is retired and only says so; branch protection refuses a direct push).

1. **Build and check** on your branch: `npm run check` and `npm run smoke`, committed.
2. **Open a pull request to main**: `git push -u origin HEAD`, then `gh pr create`. The body always
   includes a `## Spec` section with the original request and its done-criteria (start from
   `.github/pull_request_template.md`). On every PR `.github/workflows/ci.yml` runs `check` and `smoke`
   (the same jobs main runs) and `.github/workflows/claude-review.yml` runs `claude-review`: Claude reads
   this file, README.md and REVIEW.md as the rules, reads that Spec, comments `BLOCKING:` or `NIT:` per
   finding, and the job fails on a blocking comment. Those three are main's required checks.
3. **Auto-merge** is on for `risk:low` alone. The `claude-review` job labels `risk:low` or `risk:high` from
   `scripts/ship/pr-risk.sh`: low needs the review green with no blocking comment, every check green, and a diff
   that touches no CI or deploy config (`.github/`, `vercel.json`, `scripts/ship/`, `playwright.config.ts`), no
   secrets or env vars, no auth or payment code, no dependency major bump, and under about 400 changed lines
   outside tests and lockfiles. Everything else is `risk:high` and waits for Derek's approval and merge in GitHub.
4. **The merge ships it**: on the push to main, `check` + `smoke`, then `staging` — that sha deployed to Vercel's
   preview target and aliased to `paper-golf-staging-derek-hobden.vercel.app`, smoked there with the full suite
   (`SMOKE_BASE_URL`, `npm run smoke`) — then `production`: the same sha promoted (`vercel deploy --prebuilt --prod`)
   and checked with the fast `@quick` Chrome smoke (`npm run smoke:quick`) so a red deploy rolls back quickly.
   A red production smoke rolls Vercel back to the last good deployment, smokes that with the full suite, and fails
   the run with one line in the step summary (Gary pings Derek from it).
   `bash scripts/ship/wait-for-next-stage.sh <sha> --from pushed` watches a merged sha through CI and Vercel.
5. **No previews**: no branch or PR deploys at all, by hand or in CI. To see a change running, `npm run dev`,
   `npm run smoke` or `npm run verify` locally.
6. **Emergency production path**: the `ci.yml` dispatch on `main` with `sha=<full sha>` and
   `confirm=deploy-production` (it runs `check` + `smoke` on that sha and skips staging) — only after Derek's
   explicit production yes for that exact change.
7. **Never spend money** (purchases, plan upgrades, new paid services) without Derek's yes.

## Rules

- TypeScript is strict with `noUncheckedIndexedAccess`; ESLint is typescript-eslint `strictTypeChecked`.
  Fix the code. Never add `eslint-disable`, `@ts-ignore`, `!` non-null assertions or silencing casts, and never
  loosen `tsconfig.json`, `eslint.config.js` or a test to get green.
- Cap test parallelism: keep vitest at `--maxWorkers=4` (as in `npm test`) and never run a test runner with its default
  worker count; at most 8 parallel workers in total.
- Reuse the checked-access primitives instead of inventing new ones: `itemAt`/`must` (`src/engine/assert.ts`),
  `gridAt` (`src/engine/grid.ts`), `byId`/`query` (`src/ui/dom.ts`), and `at`/`defined` (`tests/helpers.ts`).
- A gameplay rule decision that is not in Derek's words goes in the result as a question, not into the code.
- **The repo is memory:** a mistake or bad pattern that happens twice becomes a check that fails — prefer
  structure/types, then a lint rule in `eslint.config.js`, then a test — committed with the fix, plus one row in
  the "Guard rules" table below (Rule | How enforced | Past bad commit).

## Guard rules

| Rule | How enforced | Past bad commit |
| --- | --- | --- |
| Strict types and lint are fixed in code: no `eslint-disable`, `@ts-ignore`, `!` assertions, silencing casts, or loosened config/tests | `tsconfig.json` strict + `noUncheckedIndexedAccess`, typescript-eslint `strictTypeChecked` with `--max-warnings 0`, run by `npm run check`, the lint-staged pre-commit hook and CI | - |
| typescript-eslint does not support TS 7's API yet: keep `typescript` at 6.0 for lint, `typescript7` for builds | `package.json` pins (`typescript` ~6.0, `typescript7` alias) | - |
| Nothing pushes to main: every change is a PR, `push-to-main.sh` only refuses (it holds no push, no refspec), and the deploy-watch reads only (GETs, token never in argv/output) | `scripts/ship/test-ship.sh` cases `push_to_main_retired`, `wait_*`, `check_*` (incl. shellcheck), run by `tests/ship.test.ts` in `npm test` | 9a22160, 6d21d8f (merges green on `npm run check` broke e2e; caught only by CI after main was pushed) |
| Every change is a pull request: `check`, `smoke` and `claude-review` run on every `pull_request` to main, under those names (the required checks), and no job is gated to an event | `test-ship.sh` cases `ci_triggers_pr_main_and_dispatch_only`, `ci_check_and_smoke_run_on_every_pr`, `ci_claude_review_on_every_pr` | - |
| Auto-merge takes `risk:low` only: the review green with no blocking comment, and a diff touching no CI/deploy config, secrets or env vars, auth or payment code, no dependency major bump, under ~400 changed lines outside tests and lockfiles | `scripts/ship/pr-risk.sh` with the `test-ship.sh` cases `risk_*` (one per rule, both verdicts); `ci_claude_review_on_every_pr` (the label and `gh pr merge --auto --squash` for low alone) | - |
| There are no preview deploys: the only deploys are the staging deploy of main and the production promote, both gated to a push to main or the dispatch, never a branch or a PR | `test-ship.sh` case `ci_no_branch_or_pr_preview_deploys` (every job that runs `vercel deploy`, in every workflow) | - |
| One smoke suite, local or deployed: `SMOKE_BASE_URL` points the same specs at a deployment (with the Vercel SSO bypass header from `VERCEL_AUTOMATION_BYPASS_SECRET`), and unset it is `vite preview` exactly as before | `playwright.config.ts` (one `baseURL`, `webServer` only when it is unset); `test-ship.sh` cases `ci_staging_after_ci_on_push` and `ci_production_needs_staging_smoke` (the deploys smoke through it) | - |
| Production's post-deploy smoke is the fast `@quick` Chrome check (`npm run smoke:quick`: the start-page turn and the solo round); the PR smoke job and the staging smoke stay the full `npm run smoke`, and the rollback re-smokes with the full suite | `package.json` `smoke:quick`; `test-ship.sh` cases `ci_check_and_smoke_run_on_every_pr`, `ci_staging_after_ci_on_push` and `ci_production_needs_staging_smoke`; `tests/ship.test.ts` | - |
| `npm run smoke` never tests a stale `dist/`: it builds first | `package.json` `presmoke` (`npm run build`) | - |
| Paper Golf uses no tags: no ship script or workflow pushes, creates or triggers on a tag (a `refs/tags/*` refspec read as a production tag push by the gate) | `test-ship.sh` case `no_tags_in_ship_scripts_or_workflows` (greps `scripts/ship/*.sh` and `.github/workflows/*.yml`, fails while `mirror-to-github.sh` exists) and `ci_triggers_pr_main_and_dispatch_only` | bfbfb25 (`mirror-to-github.sh:118`, never on GitHub) |
| Production is the merge pipeline or the confirmed dispatch, nothing else: no `--prod` outside the `production` job, which needs `check` + `smoke` and either the staging smoke green on a push or `confirm == 'deploy-production'`; a production run is never cancelled; `VERCEL_TOKEN` only from the repo secret via env, never `--token`; Vercel CLI pinned exactly | `test-ship.sh` cases `ci_production_needs_staging_smoke`, `ci_vercel_token_from_secret_env_only`, `ci_staging_after_ci_on_push` and `actionlint` | - |
| Phone tap targets are at least 44×44 CSS px, overlapping hit areas play the nearest marker, and the viewport allows pinch-zoom | `e2e/taptargets.spec.ts` (390x844 and 844x390, 1 and 4 players, isMobile, hasTouch) in `npm run smoke`; `tests/hit.test.ts` in `npm test` | 8de8d4a (17-26 px markers, `user-scalable=no`) |
| The start screen fits its card on short landscape phones: title, pill and buttons inside the green card, the footer over no button, no console errors | `e2e/landscapestart.spec.ts` (card, footer, 44 px, console) plus `e2e/fit.spec.ts` (overflow), in `npm run smoke` | 70a5443 (GOLF ran off the card, footer over "How to play" at 844x390) |
| The phone play screen fits Safari's visible viewport: the Roll button and tray fully inside `innerHeight` and `visualViewport.height` with no scrolling, the strip under the board spaced (`Hole 1 · Par 4 · Strokes 0/4 · Total 0`) and never clipped | `e2e/iphone.spec.ts` (`@webkit`, WebKit iPhone 14 at 390x664, 390x844 and 375x548) in `npm run smoke`; `e2e/fourplayer.spec.ts` | 93f049e (fixed 118px tray overflowed: Roll 9.8px under Safari's toolbar at 390x664; strip read "Par 4Strokes: /4Total:") |
| Multiplayer turns follow golf etiquette: honour on the tee (setup order on hole 1, then lowest previous score, ties by previous tee), then the ball furthest away in dots; re-rolls and mulligans never pass the turn; round-robin saves continue with whoever is away | `tests/turns.test.ts` in `npm test`; `e2e/turnorder.spec.ts` (Chrome, and WebKit iPhone 14 via `@webkit`, 3 players over two holes) in `npm run smoke` | - |
| The notebook look renders: every spiral loop resolves the `#coil` SVG symbol, evenly spaced, rising above the page edge; the desk is `src/assets/wood.webp` (served as WebP, under 150 KB, decoding), with no console errors | `e2e/look.spec.ts` (Chrome, and WebKit iPhone 14 via `@webkit`, 390x844 and 1440x900, cover and play screen) in `npm run smoke` | - |
| The wind pushes a hit its full vector and only the dot it ends on counts: never clamped at the edge or stopped early by water or trees; ending off the page, in water or in trees means the shot is not offered | `tests/windrule.test.ts` (the rule stated once, checked against `resolveShot` on ~250,000 seeded hits over all 90 holes; fails on 581f606, b2c6d1a, 1592349 and de40ff9), `tests/wind.test.ts` (applyWind), `tests/windbugs.test.ts` bugs 2 and 3 plus "judged only by the dot it ends on" in `npm test`; `e2e/wind.spec.ts` `fix-*` cases in `npm run smoke` | de40ff9 (push stopped before trees: Lakeside hole 1, W 1, the N hit offered) |
| The layout's ResizeObserver (on the notebook; the board itself is sized by CSS) never re-fits inside its own callback: it goes through `deferredObserver` in `src/ui/layout.ts` (skips unchanged sizes, re-fits on the next frame), so WebKit never raises "ResizeObserver loop completed with undelivered notifications" | `e2e/iphone.spec.ts` "no ResizeObserver loop" (WebKit iPhone 14 at 390x664 and 390x844, new round and `?play=3&players=1&hole=1`, full motion, late web fonts, zero page/console errors) in `npm run smoke` | eee1735 (tray and HUD observers called `layout()` synchronously: page error on every load at 390x664) |
| e2e tests tap board markers only through `tapMarker()` (`e2e/tap.ts`: waits for the marker, taps its hit circle's centre), never `click({ force: true })` or a `click()` on a `circle.hit`/`g.target` locator, because overlapping hit circles make `click()` hang on some die rolls | `no-restricted-syntax` block for `e2e/**/*.ts` in `eslint.config.js`, run by `npm run lint` in `npm run check`, lint-staged and CI | 40cd666 (`click({ force: true })`); 9a2f7ff (merge dropped `e2e/tap.ts` from 6d21d8f) |
| The iPhone WebKit project runs exactly the tests tagged `@webkit` (`{ tag: '@webkit' }` on the `test` or `test.describe`); `playwright.config.ts` lists no spec names for it | `iphone-webkit` project `grep: /@webkit/` in `playwright.config.ts`; `npx playwright test --list --project=iphone-webkit` | - (hand-synced `testMatch` list, audit item 4) |
| Every screen fits every phone and desktop size: every control and must-see box (HUD, chips, board, strip, die, hole card) inside `innerHeight`, `visualViewport` and the width, not cut off by the page or a sheet (scrolling a scrollable box is fine), no page overflow, no console or page errors; no known overflows remain, and a new one fails (no `fixme` entries) | `e2e/fit.spec.ts` (cover, setup, play before/after a roll, How to play, hole card, scorecard × 390x844, 390x664, 375x548, 844x390, 740x360, 1440x900 × 1 and 4 players × Chrome and WebKit iPhone 14 via `@webkit`) in `npm run smoke` | 04c7d2d (main on 17 Oct: 4-player chips wholly off the page at 390x664; hole-card buttons cut off by the page edge on narrow pages) |
| A HUD player chip reads on one line ("● Player 1 0"): its name and strokes never wrap onto a second line or run out of the chip | `e2e/fit.spec.ts` (every chip on every play and hole card case, Chrome and WebKit iPhone 14 via `@webkit`) in `npm run smoke` | e3d3a49 (main on 19 Oct: "Player 1" on two lines in WebKit at 390x664) |
| Every saved field has a guard, and every array and object in a save is checked per element: `loadState`/`isValidState` are built from `STATE_GUARDS` (`satisfies GuardTable<GameState>`); objects and arrays need a `Checked` guard that only `shape`/`arrayOf` (and `optional`/`nullable`/`orElse` around them) make, never a bare `Array.isArray` | Types: `GuardTable`/`FieldGuard` in `src/game/game.ts`, run by `npm run typecheck` (a `GameState` field without a guard, or `Array.isArray` for an array, fails); `tests/saveguards.test.ts` (one malformed case per guard, a coverage test over every `STATE_GUARDS` key, legacy and pre-wind saves, `expectTypeOf` checks) in `npm test` | 583a387 (balls checked as an array, not per element); `current`, `dice`, `holeDone`, `finished` never checked |
| Only a real round is saved: `saveGame` takes a `PersistedGame`, which only `newGame` and `loadState` return; a `?play=` round comes from `newLinkGame` (a plain `GameState`) and can never be saved or clear the save | Types (`saveGame(g: PersistedGame)` in `src/main.ts`), `tests/saveguards.test.ts` "only a saved round can be saved", `e2e/playlink.spec.ts` and `e2e/smoke.spec.ts` in `npm run smoke` | 223b814 (a `?play=` round overwrote the real save) |
