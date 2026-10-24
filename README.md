# Paper Golf

Digital version of gladden Paper Apps GOLF (notepad golf). Vite + TypeScript static site; all animation is plain 2D (CSS transforms, SVG), no WebGL.

- **Proper golf, played with a die**: every round is 18 holes, par 72 (there is no mode choice; the old 12-hole par-6 round is gone). Roll a d6 for distance (+1 from the fairway, −1 from sand), one free tee re-roll, 6 mulligans per round, putt 1 any time.
- Green: every **grassy** cell (fairway or rough) within 2 dots of the cup (Chebyshev distance, diagonals count like every move), drawn palest green; the fairway is light green. On the green you may only putt: a roll of exactly 2 allows a 2-dot putt, exactly 3 a 3-dot putt, any other roll only the 1-dot putt; no lie modifiers; putts stay on the ground, so they can't roll through water or trees (`onGreen`, `greenPuttLength`, `puttMoves`, `movesForRoll` in `rules.ts`, shared by the game and the solver).
- **Sand is a bunker wherever it lies, the green's ring included** (`isGrass`/`onGreen` in `rules.ts`): a ball resting in sand two dots from the cup keeps the sand lie — the tray reads `In the sand: −1`, the roll earns no 2- or 3-dot putt, and the shot out is a hit of the roll less one (plus the 1-dot putt, allowed from any lie). Until 24 Oct 2026 the green was every dot within 2 of the cup whatever the terrain, and the generator puts its first trap round the green, so 282 sand dots over the 90 holes read "On the green" and putted with no penalty (Derek: "I dont think landing in sand has any effect?"). A ball one dot from the cup still taps in from sand: the 1-dot putt is allowed from every lie and always holes from there (`isTapIn`, `autoPuttMove`). Water and trees in the ring are not green either, which only the board's drawing can tell — no ball rests there. `tests/sand.test.ts` and `e2e/sand.spec.ts`.
- Tap-in: a ball resting on any of the 8 cells around the cup is putted in automatically ~0.5 s into its next turn (one stroke, no roll, no aim; `autoPuttMove`/`autoPutt` in `game.ts`). A turn whose die was already rolled (older saves) plays by hand.
- Auto-hole: after a roll (or re-roll, or mulligan), when any legal target for it is the cup, that shot plays itself ~0.5 s later with the normal animation and scoring (one stroke, no tap; `autoHoleMove`/`autoHole` in `game.ts`, tested in `tests/game.test.ts` and `e2e/autohole.spec.ts`). Otherwise the player taps a target as usual.
- **Wind**: rolled once per hole at its start, the same for every player (`windForHole` in `src/engine/wind.ts`, from the round's `windSeed`, so saves, `?play=` links and tests replay it): calm ~15%, strength 1 ~70%, strength 2 ~15%, any of the 8 directions. One resolver (`resolveShot` in `rules.ts`) feeds the targets, previews, curved lines, auto shot, solver and sims, in this order: the hit touches down on its un-winded aim; the wind pushes it its full vector, that many dots downwind (a diagonal dot moves 1 on each axis), with no clamping at the edge; the ball is in the air while the wind carries it, so only the dot it ends on counts: it must be one the ball can rest on (on the page, not water or trees) or the shot isn't offered (so a touchdown on the edge can be blown off, one by the trees can be blown into them, and one off the page counts only if the wind brings it back on to such a dot). A hit from the fairway is in the air over its aim too, so a wind carries it on over trees there, like any other dot it flies over (issue 1); every other aim is unchanged, and two of those are today's behaviour awaiting Derek's decision rather than settled rules: water on the aim ends the shot, and so do trees on it when the hit did not come from the fairway (in a calm the ball really does come down on the aim and stay, so that one is the rule). Only then do slopes roll it on from where it rests, so a slope at the touchdown matters only if the wind leaves the ball there; a ball holes only if it ends on the cup, and one that dropped on the fly stays in. Putts (green putts, the 1-dot putt from anywhere, tap-ins) are never blown (`applyWind`, `movesForRoll` in `rules.ts`). Markers sit on the wind-adjusted square and each blown shot's line curves from the ball, leaving towards its aim and bending onto that square (`windCurve`, `windControl`); the ball flies the same curve. The HUD reads `Wind NE 2` or `Calm`; rounds saved before wind play calm. `tests/proper.sim.test.ts` reports the averages with wind and calm.
- **Rain**: rolled once per hole beside the wind, from the round's own `rainSeed` (`rainForHole` in `src/engine/rain.ts`, so saves, `?play=` links and tests replay it): about one hole in five is rainy, on its own roll, so a rainy hole is as likely to be calm as windy. A rainy hole plays wet and heavy. Wet ground: no slope rolls the ball at all, it stops on the dot it comes to rest on (after any wind push), so a slope can neither carry it on nor drop it in the cup. Heavy air: every hit carries one space less than normal, never below 1 (`rainDistance`, `diceDistance` in `rules.ts`), so a lie that offers no hit in the dry still offers none; the green's 2- and 3-dot putts, the 1-dot putt, sand and water are exactly as they are in the dry. The HUD reads `Rain · Wind NE 2` (or `Rain · Calm`) and light rain-blue pencil streaks fall over the board, leaning downwind (`src/ui/rain.ts`, the numbers in `src/ui/rainlook.ts`; one still shower under reduced motion). The solver values a hole as it plays in the rain (`diceExpectation(hole, true)`, `validateHole(hole, window, true)`), and `tests/rainsolver.test.ts` holds every one of the 90 holes finishable in the rain and inside its rainy window, at most 1.5 strokes dearer than dry (about a third of a stroke on a par 3, half on a par 4, three quarters on a par 5). Par itself never moves — the same card wet or dry, so course bests stay comparable — and a round saved before rain plays dry throughout. There is no rain toggle.
- Overshoot the hole by 1 and it still drops. Water can be flown over, trees only from the fairway, slope arrows roll the ball one space whenever it comes to rest on one (after a hit, a putt, the wind or another slope), so slopes chain; a chain that would revisit a dot stops where the loop is found (`rollSlopes` in `rules.ts`, tested in `tests/slopes.test.ts`).
- Phones: every tap target is at least 44×44 CSS px. Shot markers keep their small drawn dot but get an invisible hit circle of at least 44 px (`hitRadius` in `src/ui/hit.ts`); where neighbouring circles overlap, a tap plays the marker nearest the finger (`nearestWithin`). Pinch-zoom is allowed (no `user-scalable=no`).
- The fairway is light green, the rough darker and stippled; sand is hatched, water blue.
- Always in full colour (green fairway/rough/green, sand, blue water, flagged white-rimmed cup, violet/red/orange player inks) via the custom properties in `style.css`; there is no greyscale mode or colour toggle. The old toggle's stored choice (`paper-golf:palette:v1`) is ignored and removed on load (`forgetLegacyPalette` in `src/game/ink.ts`).
- 90 procedurally generated holes (5 courses × 18), deterministic seeds; every hole is validated solvable, with expected dice strokes inside its par's window.
- **The round**: 18 holes, par 72 — 4 par 3s, 10 par 4s, 4 par 5s, front 4-4-3-5-4-4-3-4-5 (36), back 4-3-4-5-4-4-3-5-4 (36) (`PROPER_PARS` in `generator.ts`). Layouts scale per par (`PAR_SHAPES`: tee-to-cup length, doglegs, fairway landing areas, hazard counts), and each hole's optimal-play expectation must fall in its par's window (`PAR_WINDOWS`), so a typical player averages about par: `tests/proper.sim.test.ts` plays ≥ 2000 seeded holes per par type through the real game rules and asserts each average is within ±0.75 of par. The card shows each hole's par plus Out/In/Total par and scores. 
- **Turn order is golf etiquette** (multiplayer; `teeOrder`, `nextToPlay`, `turnReason` in `game.ts`, tested in `tests/turns.test.ts` and `e2e/turnorder.spec.ts`): hole 1 tees off in setup order; on later holes the lowest score on the previous hole has the honour, then the next lowest, ties keeping their order from the previous tee (derived from the card, so saves and `?play=` links agree). Once everyone is off the tee, the ball furthest from the cup in dots (`dotsApart`) plays next, ties by this hole's tee order, holed and picked-up balls skipped, re-decided after every shot (the same player can go twice). Re-rolls and mulligans never pass the turn. A save from the old round-robin turns continues with whoever is away. The tray and turn banner read `Player 2 · away` / `· honour` / `· on the tee`; each ball carries its player's initial (or number, when initials clash) in their ink, and the hole card lists the next tee order.
- **Build a hole**: the title screen's Build a hole (between New round and How to play) paints one 13×20 hole (rough, fairway, sand, water, trees, slopes, one tee, one pin, par 3–5) and plays it with the usual wind and rules. It is one hole, not saved, and not a course best; Back returns to the title screen. The tray's hand-written line is the step the hole still needs — `Place a tee and a pin`, `Move the pin onto grass or sand`, `Ready — tap Play this hole` (`builderStep`, no solver, so it never says a hole is unreachable; Play and Share do) — over what the pencil is set to; the par reads in the HUD at every size. Each of the nine tools carries its colour or a little drawing, and a slope on water or trees says so rather than painting nothing. Undo steps back over the par as well as the painting. Share needs a hole that can be played, puts it in `#h=` (base64url), and the link leaves the address bar on the next change, so a reload can't bring back the hole as it was shared; a broken link says "That hole link is broken" and opens an empty builder.
- Pass-and-play for 1–4 players, scorecard, progress saved in `localStorage`. A round saved by the old 12-hole par-6 game can't be continued: it is discarded on load and the next round starts fresh at 18 holes (`loadState` in `game.ts`). Course bests are the `proper:<course>` entries (`src/game/bests.ts`); old 12-hole `dice:` bests stay in storage but are never shown or compared against par 72.
- On a phone the tray (status, die, Roll) grows with its text and the board shrinks to fit, so the Roll button stays above Safari's bottom toolbar (`#desk` is `100dvh`, with a `100vh` fallback, and pads the safe-area insets); `e2e/iphone.spec.ts` checks it in WebKit as an iPhone 14 at 390x664, 390x844 and 375x548. The strip under the board reads `Hole 1 · Par 4 · Strokes 0/4 · Total 0` (Total: the round's strokes so far, this hole included, then the score to par over finished holes); on a narrow board it splits into two rows (`fitLine` in `src/ui/layout.ts`), and on a portrait screen under 600px tall (`compact`, like a phone on its side) it is hidden and the par moves into the HUD.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # vitest: rules engine, generator (all 90 holes), game flow, Proper golf simulation
npm run build    # type-check + production build into dist/
npm run check    # typecheck + lint + test + build (what CI runs)
npm run smoke    # Playwright smoke test (system Chrome + WebKit iPhone 14; `npx playwright install webkit` once), incl. the phone-size tap-in/green and tap-target tests
npm run smoke:quick  # only the @quick Chrome tests (start page + solo round); production's post-deploy check
npm run verify   # check, then the production build in Chrome + iPhone WebKit (solo hole, turn order, wind, rain), PASS/FAIL summary
npm run shots    # refresh the phone screenshots in docs/autoputt-shots/ (after `npm run build`)
npm run test:ship  # only the scripts/ship tests (also part of `npm test`)
```

Agent/contributor rules are in `CLAUDE.md`.

## Ship scripts

Every change is a pull request to `origin` (GitHub `derek-hobden/paper-golf`); nothing pushes to `main`.
`.github/workflows/ci.yml` runs `check` and `smoke` on every PR, `.github/workflows/pr-video.yml` runs
`pr-video`, `.github/workflows/claude-review.yml` runs `claude-review` from the copy on main (it still
labels the PR `risk:low` or `risk:high`; the label does not gate the merge). `.github/workflows/auto-merge.yml`
turns squash auto-merge on for every open pull request when it opens.
GitHub requires derek-hobden's Approve review (main's branch protection asks for one approving review),
then auto-merge merges the pull request once the required checks are green and deletes the branch. He does
not click Merge. GitHub starts no push workflow for a merge it made with its
own token, so `.github/workflows/reconcile-ci.yml` dispatches `ci.yml` on main when main HEAD has no CI run;
that dispatch runs the same pipeline as a push. A CI run started with `GITHUB_TOKEN` does not trigger
Deploy's `workflow_run`, so that run dispatches Deploy itself (`scripts/ship/start-deploy.sh`). After a main
commit's CI run passes, `.github/workflows/deploy.yml` deploys the sha of that green CI run — and only while it is still main's tip (`scripts/ship/deploy-gate.sh`) — to staging, smokes it there with the full suite, promotes it to production and
runs the fast `@quick` smoke (a red production smoke rolls Vercel back; that re-check is the full suite). There are no preview deploys. `CLAUDE.md`
"Ship process" has the whole flow. Open a pull request with `scripts/gh-as-gus.sh` (Golf Gus Bot); the explainer video is handed over on the throwaway `qa-video/<branch>` branch and Gus attaches it to the top of the pull request himself (CLAUDE.md "PR explainer videos"). `scripts/ship/` (bash, tested by `tests/ship.test.ts` →
`scripts/ship/test-ship.sh` with fake gh/curl/npm/actionlint and temp local fixture repos):

- `check.sh` — every check CI runs (`npm run check`, `npm run smoke`, actionlint), on this machine.
- `pr-risk.sh <base> <head>` — labels a diff `risk=low` or `risk=high` (one reason per rule it breaks). Read-only; the `claude-review` job labels the PR from it. The label does not gate the merge.
- `auto-merge.sh` — turns squash auto-merge on for every open pull request when it opens (`PR` or `HEAD_SHA`): `automerge=on`, or `skip` for a closed, merged, draft or fork pull request. Run by `.github/workflows/auto-merge.yml` as the Golf Gus Bot app (`GOLF_GUS_APP_ID`, `GOLF_GUS_APP_KEY`, in the Actions and Dependabot secret stores): GitHub refuses the mutation to a workflow's own `GITHUB_TOKEN`, and a Dependabot pull request only ever has a read-only one.
- `update-pr-branches.sh` — on a push to main, updates every open auto-merge pull request that is behind
  main and dispatches `ci.yml` on the pull request branch and `claude-review.yml` on main with `refresh_pr` so the checks re-run
  (a `GITHUB_TOKEN` push starts no `pull_request` workflows). Never pushes to main. A merge conflict is skipped.
- `pr-refresh-fields.sh` — writes one pull request's base, head, number, author, title and body to
  `$GITHUB_OUTPUT` for that refresh. Title and body are multiline values and are never evaluated.
- `deploy-gate.sh` — whether a Deploy run may deploy and which commit (the triggering CI run's fields in the
  environment): `deploy=true` with the `sha` and `mode` only for a completed, green CI run on main whose
  `deploy-request.json` names a full sha and the same event. `mode=push` and `mode=reconcile` (the normal
  dispatch of main HEAD, gated exactly as the push run it stands in for) deploy that run's own `head_sha`, and
  only while it is still main's tip; `mode=dispatch`, the confirmed emergency dispatch, deploys its request's
  sha, which may sit behind main. `deploy=false` with the reason otherwise, a commit main has moved past
  included. Read-only.
- `start-deploy.sh` — dispatches `deploy.yml` for this CI run when the actor is `github-actions[bot]`.
  A run started with `GITHUB_TOKEN` does not trigger Deploy's `workflow_run`; `workflow_dispatch` does
  still start a run. A person's push or dispatch is refused here, because that path already starts Deploy.
  The only POST is `deploy.yml`, and Deploy does not start CI.
- `read-ci-run.sh` — reads the CI run a Deploy dispatch names (status, conclusion, event, branch, sha,
  repository) for `deploy-gate.sh`. Waits until the run is completed, because the dispatch happens from
  inside that run.
- `reconcile-ci.sh [--dry-run]` — dispatches `ci.yml` on main when main HEAD has no `ci.yml` run of its own,
  because GitHub starts no push workflow for a merge it made with its own token. Only a push-event run on main
  counts as that run (`push_runs`): a pull request's run tested a branch, and the emergency dispatch's run
  carries the tip's sha but tested the older one Derek confirmed. Its own dispatches (`dispatched`, recognised
  by the run name `ci.yml` gives them) are counted separately, which is what keeps it to one dispatch per sha.
  A tip younger than `RECONCILE_MIN_AGE_S` (2 minutes) waits a tick, because its own push run may simply not
  be listed yet, and a dispatch waits (up to `RECONCILE_CONFIRM_S`, 30s) for GitHub to list the run it started. Nothing is dispatched on any doubt; `--dry-run` decides and prints without dispatching.
- `retry.sh --timeout <duration> [--attempts 2] -- <command>` — one more attempt, each under a hard timeout,
  for a deploy step that can hang. Everything it says goes to stderr, so a step can still read the command's
  stdout (the deploy URL). Every `vercel pull`, `build`, `deploy` and `alias` call in `deploy.yml` runs through it, with a window that fits the step's own limit.
- `container-chrome.sh` — prints `CHROME_PATH=<the image's Chromium>` for `$GITHUB_ENV`. The CI `smoke-shard`
  job, the staging smoke shards and the production job run in `mcr.microsoft.com/playwright:v<the @playwright/test
  version in package-lock.json>-noble`, which carries every browser, so no workflow installs one; the image has no
  branded Chrome, so the `chrome` project takes its Chromium (with `CHROME_NO_SANDBOX=1`, which the container
  needs as root). The image carries neither `gh` nor `jq`, so ci.yml's `flaky` job files the `flaky test:`
  issue on the runner from each shard's retry record, and every container job sets `shell: bash`. The required
  check stays the job named `smoke`.
- `pr-video-narrate.sh <text-file> <out.wav>` — the narration for a PR explainer video:
  `https://openrouter.ai/api/v1/audio/speech`, model `google/gemini-3.8-flash-lite-tts`, voice `Kore`, none of
  the three overridable. Needs `$OPENROUTER_API_KEY` (a missing key fails rather than falling back to another
  voice) and ffmpeg to wrap the PCM it answers with.
- `pr-video-mux.sh` — copies a clip that already has audio, or pads a silent one (last frame held) and encodes
  H.264 + AAC under 100 MB. A higher `VIDEO_MAX_BYTES` is refused. The speech key and the GitHub
  tokens are unset before ffprobe and ffmpeg, including the probe of the clip. The result is never committed to
  the pull request: it goes as one orphan commit holding only `video.mp4` to the throwaway `qa-video/<branch>`
  branch (a cloud session cannot upload a binary — Anthropic's GitHub proxy answers 415), and Gus attaches it to
  the top of the pull request from his browser and deletes the branch.
- `deploy-summary.sh` — the one line a Deploy run ends with in its job summary: `LIVE <url> <sha>` or
  `FAILED <job>`, from the jobs' results in the environment. A run that deployed nothing prints nothing.
  Never fails a run.
- `wait-for-next-stage.sh <sha> [--from <stage>]` — read-only deploy-watch: GitHub CI, then the Vercel
  deployments of that sha (the staging deploy reads as the "preview" stage; `VERCEL_TOKEN` from env).
- `push-to-main.sh` — retired: it refuses and points at the pull request flow.

`?play=<course 0-4>&players=<1-4>&hole=<1-18>` jumps straight into a round (handy for screenshots); the hole clamps to 1-18. That round is never saved, so it never overwrites the round in progress. Old `golf=` and `mode=` parameters are ignored.

## Layout

- `src/engine/` — pure rules (`rules.ts`), weather rolls (`wind.ts`, `rain.ts`), solver (`solver.ts`: expected dice strokes by value iteration), generator (`generator.ts`), seeded RNG.
- `src/game/game.ts` — pass-and-play state machine (turns, dice, mulligans, scoring).
- `src/ui/` — SVG notebook page (`board.ts`), 2D overlay for the die, golf ball and pencil (`fx.ts`), the shared vector golf ball and its pencil shadow (`golfball.ts`), hand-drawn path helpers.

## Performance rules

The game must stay at 60fps on mid-range phones:

- Animate only `transform` and `opacity`, on elements with their own layer (`will-change`). The die, ball, pencil and their shadows are small pre-drawn sprites in `#fx`.
- Never read layout inside an animation frame. Geometry such as `getScreenCTM` or `getPointAtLength` is read once, when a stroke starts (`Board.liveStroke`).
- Keep things that change every turn off the expensive layers:
  - the patterned terrain is its own static SVG layer;
  - live pencil lines draw on `.board-ink`;
  - looping rings are HTML in `.board-rings`;
  - wind swirls (smooth white pencil streaks blowing downwind on windy holes, now and then with one loop) are one `.board-wind` canvas between the terrain and the play layer, the only thing redrawn each frame; it runs only while the board is on the page, the tab is visible and the wind blows, and never under reduced motion (`src/ui/swirls.ts`; counts, speeds and sizes per strength in `windLook`, `src/ui/windlook.ts`, tested in `tests/windlook.test.ts`);
  - rain streaks (light rain-blue pencil lines falling down the board, leaning downwind on a windy hole) are one `.board-rain` canvas over everything, redrawn each frame on the same terms as the swirls — only while the board is on the page, the tab is visible and it rains — and drawn once, static, under reduced motion (`src/ui/rain.ts`; counts, speeds, sizes and lean in `rainLook`, `src/ui/rainlook.ts`, tested in `tests/rainlook.test.ts`); both canvases draw with the speckled pencil tile in `src/ui/pencil.ts`, the swirls in white and the rain in its own blue (`rainLook.color`);
  - trees and the flag's cloth are HTML boxes in `.board-sway` over the terrain, so in a wind they lean, sway and flutter (CSS transform animations, the cloth flying downwind) without repainting the terrain; calm and reduced motion keep them still (`e2e/windfx.spec.ts`);
  - the page and the tray are separate layers over the wood desk (one static 22 KB WebP tile, `scripts/wood-texture.js`, under a gradient vignette); the spiral is one inline SVG `<symbol>` (`#coil`) reused per loop.
- No animated filters, blurs or big shadows. The pencil grain is a cached stroke pattern, not an SVG filter.
- `prefers-reduced-motion`: the die fades in, a shot jumps straight to its end state (ball on its spot, lines drawn), and the page turn becomes a crossfade.

## Shot animation

A shot plays in order (`src/ui/flight.ts`, tested in `tests/flight.test.ts`): the golf ball carries ~83% of the way in a top-down arc (bigger at the apex, shadow on the ground line; the sprite is drawn at apex size and scaled down, so it stays crisp), lands, makes two small decaying bounces and rolls out onto the tapped spot; only then does the pencil draw the shot line and ring the spot. Putts and slope rolls stay on the ground. Input (targets, roll, mulligan, tray tools, keyboard) is locked by an `InputLock` until the shot is done.
- `tests/` — vitest suites.
