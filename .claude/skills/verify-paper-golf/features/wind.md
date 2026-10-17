# Wind

Each hole has a wind, the same for every player: the HUD reads `Wind W 2` or `Calm`. On a windy hole white pencil
swirls blow across the board, the trees sway and the flag flies downwind; on a calm hole, or under reduced motion,
nothing moves.

## Sub-features

- `wind-hud` the HUD shows the hole's wind, or `Calm`.
- `wind-swirls` swirls ink the `canvas.board-wind` layer on a windy hole and never take a tap.
- `wind-sway` trees lean downwind and sway; the flag flutters.
- `wind-calm` a calm hole has a blank canvas and still trees.
- `wind-reduced` reduced motion: no swirls, no sway, the flag still points downwind.

## How to get to it (user POV)

- Any hole of a round; a new round rolls its winds at random.
- Deep links play a fixed wind seed: `?play=0&players=1&hole=9` is `W 2`, `?play=0&players=1&hole=7` is calm.

## Driving it with Playwright

Preconditions:

- Production build; full motion (`test.use({ reducedMotion: 'no-preference' })`) for swirls and sway.

- **Windy HUD.** Go to `/?play=0&players=1&hole=9`. `#hud` contains `Wind W 2`.
- **Swirls.** Count non-transparent pixels of `canvas.board-wind` (`getImageData`): over 200.
- **Sway.** `.board-sway` has classes `windy` and `west`; `.sway-tree`'s computed transform changes and leans
  more than 5° anticlockwise.
- **Targets on top.** Roll, then `document.elementFromPoint` at a marker's centre is inside `.target`; tapping it adds
  a stroke.
- **Calm.** Go to `/?play=0&players=1&hole=7`. `#hud` contains `Calm`; canvas pixel count 0; `.sway-tree` transform
  `none`.
- **Run it.** `SMOKE_PORT=4318 npx playwright test e2e/windfx.spec.ts` (both browsers).

## Gotchas

- There is no wind URL parameter: the deep link's fixed seed is the only way to pick a hole's wind without a saved
  round. If the seed or generator changes, holes 9 and 7 may stop being W 2 and calm; the HUD assertion fails first.
- The default config sets `reducedMotion: 'reduce'`, which turns swirls and sway off on purpose.
- The swirls only run while the tab is visible and the board is on the page.
