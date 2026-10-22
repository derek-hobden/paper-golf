# Paper Golf

Digital version of gladden Paper Apps GOLF (notepad golf). Vite + TypeScript static site; all animation is plain 2D (CSS transforms, SVG), no WebGL.

- **Proper golf, played with a die**: every round is 18 holes, par 72 (there is no mode choice; the old 12-hole par-6 round is gone). Roll a d6 for distance (+1 from the fairway, −1 from sand), one free tee re-roll, 6 mulligans per round, putt 1 any time.
- Green: every cell within 2 dots of the cup (Chebyshev distance, diagonals count like every move), drawn palest green; the fairway is light green. On the green you may only putt: a roll of exactly 2 allows a 2-dot putt, exactly 3 a 3-dot putt, any other roll only the 1-dot putt; no lie modifiers; putts stay on the ground, so they can't roll through water or trees (`onGreen`, `greenPuttLength`, `puttMoves`, `movesForRoll` in `rules.ts`, shared by the game and the solver).
- Tap-in: a ball resting on any of the 8 cells around the cup is putted in automatically ~0.5 s into its next turn (one stroke, no roll, no aim; `autoPuttMove`/`autoPutt` in `game.ts`). A turn whose die was already rolled (older saves) plays by hand.
- Auto-hole: after a roll (or re-roll, or mulligan), when any legal target for it is the cup, that shot plays itself ~0.5 s later with the normal animation and scoring (one stroke, no tap; `autoHoleMove`/`autoHole` in `game.ts`, tested in `tests/game.test.ts` and `e2e/autohole.spec.ts`). Otherwise the player taps a target as usual.
- **Wind**: rolled once per hole at its start, the same for every player (`windForHole` in `src/engine/wind.ts`, from the round's `windSeed`, so saves, `?play=` links and tests replay it): calm ~15%, strength 1 ~70%, strength 2 ~15%, any of the 8 directions. One resolver (`resolveShot` in `rules.ts`) feeds the targets, previews, curved lines, auto shot, solver and sims, in this order: the hit touches down on its un-winded aim; the wind pushes it its full vector, that many dots downwind (a diagonal dot moves 1 on each axis), with no clamping at the edge; the ball is in the air while the wind carries it, so only the dot it ends on counts: it must be one the ball can rest on (on the page, not water or trees) or the shot isn't offered (so a touchdown on the edge can be blown off, one by the trees can be blown into them, and one off the page counts only if the wind brings it back on to such a dot). A hit from the fairway is in the air over its aim too, so a wind carries it on over trees there, like any other dot it flies over (issue 1); every other aim is unchanged — water on the aim always ends the shot, so do trees when the hit did not come from the fairway, and in a calm the ball comes down on the aim and stays. Only then do slopes roll it on from where it rests, so a slope at the touchdown matters only if the wind leaves the ball there; a ball holes only if it ends on the cup, and one that dropped on the fly stays in. Putts (green putts, the 1-dot putt from anywhere, tap-ins) are never blown (`applyWind`, `movesForRoll` in `rules.ts`). Markers sit on the wind-adjusted square and each blown shot's line curves from the ball, leaving towards its aim and bending onto that square (`windCurve`, `windControl`); the ball flies the same curve. The HUD reads `Wind NE 2` or `Calm`; rounds saved before wind play calm. `tests/proper.sim.test.ts` reports the averages with wind and calm.
- Overshoot the hole by 1 and it still drops. Water can be flown over, trees only from the fairway, slope arrows roll the ball one space whenever it comes to rest on one (after a hit, a putt, the wind or another slope), so slopes chain; a chain that would revisit a dot stops where the loop is found (`rollSlopes` in `rules.ts`, tested in `tests/slopes.test.ts`).
- Phones: every tap target is at least 44×44 CSS px. Shot markers keep their small drawn dot but get an invisible hit circle of at least 44 px (`hitRadius` in `src/ui/hit.ts`); where neighbouring circles overlap, a tap plays the marker nearest the finger (`nearestWithin`). Pinch-zoom is allowed (no `user-scalable=no`).
- The fairway is light green, the rough darker and stippled; sand is hatched, water blue.
- Always in full colour (green fairway/rough/green, sand, blue water, flagged white-rimmed cup, violet/red/orange player inks) via the custom properties in `style.css`; there is no greyscale mode or colour toggle. The old toggle's stored choice (`paper-golf:palette:v1`) is ignored and removed on load (`forgetLegacyPalette` in `src/game/ink.ts`).
- 90 procedurally generated holes (5 courses × 18), deterministic seeds; every hole is validated solvable, with expected dice strokes inside its par's window.
- **The round**: 18 holes, par 72 — 4 par 3s, 10 par 4s, 4 par 5s, front 4-4-3-5-4-4-3-4-5 (36), back 4-3-4-5-4-4-3-5-4 (36) (`PROPER_PARS` in `generator.ts`). Layouts scale per par (`PAR_SHAPES`: tee-to-cup length, doglegs, fairway landing areas, hazard counts), and each hole's optimal-play expectation must fall in its par's window (`PAR_WINDOWS`), so a typical player averages about par: `tests/proper.sim.test.ts` plays ≥ 2000 seeded holes per par type through the real game rules and asserts each average is within ±0.75 of par. The card shows each hole's par plus Out/In/Total par and scores. 
- **Turn order is golf etiquette** (multiplayer; `teeOrder`, `nextToPlay`, `turnReason` in `game.ts`, tested in `tests/turns.test.ts` and `e2e/turnorder.spec.ts`): hole 1 tees off in setup order; on later holes the lowest score on the previous hole has the honour, then the next lowest, ties keeping their order from the previous tee (derived from the card, so saves and `?play=` links agree). Once everyone is off the tee, the ball furthest from the cup in dots (`dotsApart`) plays next, ties by this hole's tee order, holed and picked-up balls skipped, re-decided after every shot (the same player can go twice). Re-rolls and mulligans never pass the turn. A save from the old round-robin turns continues with whoever is away. The tray and turn banner read `Player 2 · away` / `· honour` / `· on the tee`; each ball carries its player's initial (or number, when initials clash) in their ink, and the hole card lists the next tee order.
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
npm run verify   # check, then the production build in Chrome + iPhone WebKit (solo hole, turn order, wind), PASS/FAIL summary
npm run shots    # refresh the phone screenshots in docs/autoputt-shots/ (after `npm run build`)
npm run test:ship  # only the scripts/ship tests (also part of `npm test`)
```

Agent/contributor rules are in `CLAUDE.md`.

## Ship scripts

Every change is a pull request to `origin` (GitHub `derek-hobden/paper-golf`); nothing pushes to `main`.
`.github/workflows/ci.yml` runs `check` and `smoke` on every PR and `.github/workflows/claude-review.yml` runs
`claude-review`, which labels the PR `risk:low` or `risk:high`; `.github/workflows/auto-merge.yml` then turns
GitHub's auto-merge on for a green `risk:low` one. After a push to main, `.github/workflows/deploy.yml` deploys that sha to staging, smokes it there with the full suite, promotes it to production and
runs the fast `@quick` smoke (a red production smoke rolls Vercel back; that re-check is the full suite). There are no preview deploys. `CLAUDE.md`
"Ship process" has the whole flow. `scripts/ship/` (bash, tested by `tests/ship.test.ts` →
`scripts/ship/test-ship.sh` with fake gh/curl/npm/actionlint and temp local fixture repos):

- `check.sh` — every check CI runs (`npm run check`, `npm run smoke`, actionlint), on this machine.
- `pr-risk.sh <base> <head>` — the auto-merge rules on a diff: `risk=low` (auto-merge may take the PR) or
  `risk=high` with a reason per rule it breaks. Read-only; the `claude-review` job labels the PR from it.
- `auto-merge.sh` — the auto-merge decision from that label (`PR`/`HEAD_SHA` and `REVIEW_CONCLUSION` in the
  environment): `automerge=on` for a `risk:low` PR whose review passed, `off` for `risk:high` and unlabelled
  ones, `skip` for a closed or merged one. Run by `.github/workflows/auto-merge.yml` after the review, where
  the token may make the change.
- `wait-for-next-stage.sh <sha> [--from <stage>]` — read-only deploy-watch: GitHub CI, then the Vercel
  deployments of that sha (the staging deploy reads as the "preview" stage; `VERCEL_TOKEN` from env).
- `push-to-main.sh` — retired: it refuses and points at the pull request flow.

`?play=<course 0-4>&players=<1-4>&hole=<1-18>` jumps straight into a round (handy for screenshots); the hole clamps to 1-18. That round is never saved, so it never overwrites the round in progress. Old `golf=` and `mode=` parameters are ignored.

## Layout

- `src/engine/` — pure rules (`rules.ts`), solver (`solver.ts`: expected dice strokes by value iteration), generator (`generator.ts`), seeded RNG.
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
  - trees and the flag's cloth are HTML boxes in `.board-sway` over the terrain, so in a wind they lean, sway and flutter (CSS transform animations, the cloth flying downwind) without repainting the terrain; calm and reduced motion keep them still (`e2e/windfx.spec.ts`);
  - the page and the tray are separate layers over the wood desk (one static 22 KB WebP tile, `scripts/wood-texture.js`, under a gradient vignette); the spiral is one inline SVG `<symbol>` (`#coil`) reused per loop.
- No animated filters, blurs or big shadows. The pencil grain is a cached stroke pattern, not an SVG filter.
- `prefers-reduced-motion`: the die fades in, a shot jumps straight to its end state (ball on its spot, lines drawn), and the page turn becomes a crossfade.

## Shot animation

A shot plays in order (`src/ui/flight.ts`, tested in `tests/flight.test.ts`): the golf ball carries ~83% of the way in a top-down arc (bigger at the apex, shadow on the ground line; the sprite is drawn at apex size and scaled down, so it stays crisp), lands, makes two small decaying bounces and rolls out onto the tapped spot; only then does the pencil draw the shot line and ring the spot. Putts and slope rolls stay on the ground. Input (targets, roll, mulligan, tray tools, keyboard) is locked by an `InputLock` until the shot is done.
- `tests/` — vitest suites.
