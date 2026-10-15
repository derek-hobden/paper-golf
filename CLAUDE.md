# Paper Golf — notes for agents

Vite + TypeScript static site (no framework, no WebGL). Read README.md for the game rules, layout and the
performance rules; they are binding.

## Verify (always, before saying "done")

```sh
npm install
npm run check    # typecheck (TS 7) → lint (ESLint, zero warnings) → vitest → production build
npm run smoke    # Playwright smoke test against `vite preview` (system Chrome); not part of check
```

- Quote the `npm run check` output as evidence. CI (`.github/workflows/ci.yml`) runs the same on push to main.
- Node 22 (`.nvmrc`, `engines`). Pre-commit: husky (set up by `npm install` via `prepare`) runs `.husky/pre-commit`
  → lint-staged (`eslint --fix` on staged files). Don't bypass it with `--no-verify`.
- Type-check with `npm run typecheck`, not `npx tsc`: the root `typescript` package is 6.0 only because
  typescript-eslint needs its JS API; the app compiler is TS 7 (`node_modules/typescript7`).

## Architecture

- `src/engine/` — pure, deterministic rules: `rules.ts` (moves, terrain), `generator.ts` (60 seeded holes,
  validated solvable), `solver.ts` (expected Dice Golf strokes), `rng.ts`, `types.ts`. No DOM here.
- `src/game/game.ts` — pass-and-play state machine: turns, dice, mulligans, scoring. No DOM here.
- `src/ui/` — SVG board, 2D effects (die, ball, pencil), shot flight timing. `src/main.ts` wires UI to the game.
- `tests/` — vitest unit tests for engine, game flow and flight; `e2e/` — Playwright smoke test.
- `scripts/ship/` — bash ship tooling (`check.sh`, `push-to-main.sh`, deploy-watch `wait-for-next-stage.sh`, shared
  `lib.sh`), tested by `scripts/ship/test-ship.sh` (fakes in `scripts/ship/test-fakes/`, temp local bare-repo
  origins), run from vitest by `tests/ship.test.ts`.
- Logic belongs in `engine`/`game` with a unit test; keep `ui`/`main.ts` thin.

## Ship process (Derek, 14-15 Oct 2026)

Origin is whatever the checkout's `origin` is (today the local bare repo `/Users/anton/bots-work/repos/.paper-golf.git`;
GitHub `derek-hobden/paper-golf` works the same). There are no PRs and **no tags at all**.

1. **Build and check** on the job branch: `npm run check` and `npm run smoke`, committed.
2. **Push your own work to main**: `bash scripts/ship/push-to-main.sh --dry-run`, then without `--dry-run`, from any
   checkout of the repo. It stops on uncommitted tracked changes, runs `npm run check` (stops when red), fetches
   origin, merges origin/main into the branch when main moved (a merge commit, no rebase; `npm run check` again; a
   conflict stops it), then fast-forward pushes only `HEAD:refs/heads/main` (no force, no tags), retrying up to 3
   times when main moves under it.
3. **Previews**: jobs may deploy Vercel previews themselves: `vercel --yes --scope derek-hobden`. On a GitHub origin,
   `.github/workflows/ci.yml` also runs `check` + `smoke` and a preview deploy on every push to `main`
   (`bash scripts/ship/wait-for-next-stage.sh <sha> --from pushed` watches it).
4. **Production** (`vercel --prod`, or the `ci.yml` dispatch on `main` with `sha=<full sha>` and
   `confirm=deploy-production`) only when the job's brief states Derek's explicit production yes for that exact change.
5. **Never spend money** (purchases, plan upgrades, new paid services) without Derek's yes.

## Rules

- TypeScript is strict with `noUncheckedIndexedAccess`; ESLint is typescript-eslint `strictTypeChecked`.
  Fix the code. Never add `eslint-disable`, `@ts-ignore`, `!` non-null assertions or silencing casts, and never
  loosen `tsconfig.json`, `eslint.config.js` or a test to get green.
- Reuse the checked-access primitives instead of inventing new ones: `itemAt`/`must` (`src/engine/assert.ts`),
  `gridAt` (`src/engine/grid.ts`), `byId`/`query` (`src/ui/dom.ts`), and `at`/`defined` (`tests/helpers.ts`).
- **The repo is memory:** a mistake or bad pattern that happens twice becomes a check that fails — prefer
  structure/types, then a lint rule in `eslint.config.js`, then a test — committed with the fix, plus one row in
  the "Guard rules" table below (Rule | How enforced | Past bad commit).

## Guard rules

| Rule | How enforced | Past bad commit |
| --- | --- | --- |
| Strict types and lint are fixed in code: no `eslint-disable`, `@ts-ignore`, `!` assertions, silencing casts, or loosened config/tests | `tsconfig.json` strict + `noUncheckedIndexedAccess`, typescript-eslint `strictTypeChecked` with `--max-warnings 0`, run by `npm run check`, the lint-staged pre-commit hook and CI | - |
| typescript-eslint does not support TS 7's API yet: keep `typescript` at 6.0 for lint, `typescript7` for builds | `package.json` pins (`typescript` ~6.0, `typescript7` alias) | - |
| Ship scripts are safe by default: the deploy-watch only reads (GETs, token never in argv/output); `push-to-main.sh` works with any origin, runs `npm run check` before pushing (and after merging origin/main), merges instead of rebasing, stops on a conflict, and never uses `--force`/`--mirror`/deletes or pushes anything but `HEAD:refs/heads/main` | `scripts/ship/test-ship.sh` cases `wait_*`, `push_*`, `check_*` (incl. shellcheck), run by `tests/ship.test.ts` in `npm test` | - |
| Paper Golf uses no tags: no ship script or workflow pushes, creates or triggers on a tag (a `refs/tags/*` refspec read as a production tag push by the gate) | `test-ship.sh` case `no_tags_in_ship_scripts_or_workflows` (greps `scripts/ship/*.sh` and `.github/workflows/*.yml`, fails while `mirror-to-github.sh` exists) and `ci_triggers_main_and_dispatch_only` | bfbfb25 (`mirror-to-github.sh:118`, never on GitHub) |
| Production deploys only by a confirmed dispatch after CI: no `--prod` outside `deploy-production`, which needs `check` + `smoke` and `confirm == 'deploy-production'`; `VERCEL_TOKEN` only from the repo secret via env, never `--token`; Vercel CLI pinned exactly | `test-ship.sh` cases `ci_*` and `actionlint` | - |
| Phone tap targets are at least 44×44 CSS px, overlapping hit areas play the nearest marker, and the viewport allows pinch-zoom | `e2e/taptargets.spec.ts` (390x844 and 844x390, 1 and 4 players, isMobile, hasTouch) in `npm run smoke`; `tests/hit.test.ts` in `npm test` | 8de8d4a (17-26 px markers, `user-scalable=no`) |
| The start screen fits its card on short landscape phones: title, pill and buttons inside the green card, the footer over no button, no horizontal overflow, no console errors | `e2e/landscapestart.spec.ts` (844x390, 740x360, 390x844; with and without Continue) in `npm run smoke` | 70a5443 (GOLF ran off the card, footer over "How to play" at 844x390) |
| The phone play screen fits Safari's visible viewport: the Roll button and tray fully inside `innerHeight` and `visualViewport.height` with no scrolling, the strip under the board spaced (`Hole 1 · Par 4 · Strokes 0/4 · Total 0`) and never clipped | `e2e/iphone.spec.ts` (WebKit iPhone 14 project at 390x664, 390x844 and 375x548) in `npm run smoke`; `e2e/fourplayer.spec.ts` | 93f049e (fixed 118px tray overflowed: Roll 9.8px under Safari's toolbar at 390x664; strip read "Par 4Strokes: /4Total:") |
| Layout ResizeObservers never re-fit inside their own callback: they go through `deferredObserver` in `src/main.ts` (skips unchanged sizes, re-fits on the next frame), so WebKit never raises "ResizeObserver loop completed with undelivered notifications" | `e2e/iphone.spec.ts` "no ResizeObserver loop" (WebKit iPhone 14 at 390x664 and 390x844, new round and `?play=3&players=1&hole=1`, full motion, late web fonts, zero page/console errors) in `npm run smoke` | eee1735 (tray and HUD observers called `layout()` synchronously: page error on every load at 390x664) |
