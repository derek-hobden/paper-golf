# Paper Golf verification map

The maintained source for verifying what a Paper Golf player sees and does. Read this index before driving the app,
then use the matching feature file as the recipe. `scripts/verify.sh` runs every feature here.

## Baseline preconditions

- A production build in `dist/` (`npm run check` or `npm run build`), served by `vite preview` on a free port
  (Playwright's `webServer`, port from `SMOKE_PORT`). Never a dev server.
- Each test gets a fresh browser context: empty `localStorage`, so no saved round and no Continue button.
- Desktop Chrome (`chrome` project) and WebKit as an iPhone 14 (`iphone-webkit`), with `reducedMotion: 'reduce'`
  unless a spec opts into full motion.

## Driving conventions

- Stable handles: `data-act` buttons (`#cover [data-act=new]`, `#page [data-act=go]`, `#tray [data-act=roll]`,
  `[data-act=mull]`, `.hole-card [data-act=card]`, `[data-act=next]`), shot markers `g.target` with `aria-label`
  `Hit 4 north-east` / `Putt 1 west` (`— holes out` when they hole), the HUD `#hud`, the tray `#tray .status`,
  the turn banner `#banner`.
- Tap a marker on its `circle.hit` with `force: true`: hit circles overlap by design and a tap plays the nearest.
- Wait on what the UI shows next (the Roll button, the status, the hole card), never a fixed sleep; shots lock input
  until they finish.
- Known positions come from a saved round written to `localStorage` then Continue, or a deep link
  `?play=<course 0-4>&players=<1-4>&hole=<1-18>` (default wind seed, never saved); known dice from `e2e/rig.ts`.

## Proof and skip reporting

- Every spec fails on a console error or page error.
- Check the saved state behind the screen where there is one (`localStorage` `paper-golf:game:v1`).
- Screenshots go to `VERIFY_SHOTS` when set; a failing test keeps its Playwright trace.
- Report a flow that could not run with its log, never as passed through a different flow.

## Feature entry contract

Each feature file has an H1 title and one paragraph, then four H2 sections in this order: `Sub-features`,
`How to get to it (user POV)`, `Driving it with Playwright`, `Gotchas`.

## Features

- [Solo round](./solo-round.md): tee off, roll, the legal dots, take shots, finish the hole.
- [Scorecard](./scorecard.md): the hole card and the scorecard show the hole's score.
- [Turn order](./turn-order.md): multiplayer turns by golf etiquette.
- [Wind](./wind.md): the wind HUD, swirls and swaying trees on a windy hole, nothing on a calm one.
- [Rain](./rain.md): the Rain label, pencil streaks and a rainy hole played wet and heavy.
