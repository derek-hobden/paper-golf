# Rain

About one hole in five is rainy, rolled beside the wind and the same for every player: the HUD reads `Rain` in front
of the wind reading. Light white pencil streaks fall over the board, the ground is wet (no slope rolls the ball) and
the air is heavy (every hit carries one space less than normal).

## Sub-features

- `rain-hud` the HUD shows `Rain · Wind E 2` on a rainy windy hole, `Rain · Calm` on a rainy calm one, and nothing
  at all on a dry one.
- `rain-streaks` streaks ink the `canvas.board-rain` layer while it rains, keep falling, and never take a tap.
- `rain-dry` a dry hole leaves that canvas blank.
- `rain-reduced` reduced motion: the shower is drawn once and stands still.
- `rain-heavy-air` the markers on a rainy hole are the hits of one space less than the dry hole's (the tray reads
  `Hit 4` where the dry roll would hit 5).
- `rain-wet-ground` a hit that comes to rest on a slope stays on that dot, with no dashed roll line behind it.

## How to get to it (user POV)

- Any hole of a round; a new round rolls its rain at random, hole by hole.
- Deep links play fixed weather seeds: `?play=2&players=1&hole=6` is rainy and calm, `?play=4&players=1&hole=14`
  rainy with `Wind E 2`, and `?play=0&players=1&hole=7` dry and calm.

## Driving it with Playwright

Preconditions:

- Production build; full motion (`test.use({ reducedMotion: 'no-preference' })`) for falling streaks.

- **HUD.** Go to `/?play=4&players=1&hole=14`. `#hud .rain` reads `Rain`, `#hud .wind` reads `Wind E 2`, and the
  rain box sits left of the wind box. On `/?play=0&players=1&hole=7`, `#hud .rain` has count 0.
- **Streaks.** Count non-transparent pixels of `canvas.board-rain` (`getImageData`): over 200, and their positions
  differ between two reads 300ms apart. `canvas.board-rain` is the last child of `#board-wrap` with
  `pointer-events: none`.
- **Dry.** Go to `/?play=0&players=1&hole=7`: pixel count 0.
- **Reduced motion.** Default config. Wait until the canvas has stopped resizing (late web fonts re-fit the board,
  which redraws a still shower), then two reads 500ms apart are identical.
- **Playing it.** Rig the die (`e2e/rig.ts`) to 4 on `/?play=2&players=1&hole=6`, Roll: the markers are
  `movesForRoll(hole, tee, 4, CALM, true)`'s ends, not the dry ones, and tapping the hit that rests on a slope
  leaves the ball on that dot (`.balls g.ball circle` at `end + 0.5`) with no `.shots path[stroke-dasharray]`.
- **Run it.** `SMOKE_PORT=4318 npx playwright test e2e/rain.spec.ts` (both browsers).

## Gotchas

- There is no rain URL parameter: the deep link's fixed seeds are the only way to pick a hole's weather without a
  saved round. If the seeds or the generator change, holes 6, 14 and 7 may stop being rainy-calm, rainy-windy and
  dry; the HUD assertions fail first.
- A saved round written straight to `localStorage` can set `rain` itself (as `e2e/fit.spec.ts` does for the widest
  HUD), but `loadState` drops a malformed one and plays the hole dry.
- Rain never touches the green's 2- and 3-dot putts, sand or water; only hits are shortened.
- The streaks run only while the tab is visible and the board is on the page, and never animate under reduced
  motion.
