---
name: verify-paper-golf
description: Verify Paper Golf (the Vite + TypeScript notebook golf web app) end to end in one run - npm run check, then the production build in desktop Chrome and iPhone WebKit via Playwright (solo hole to scorecard, multiplayer turn order, wind HUD and swirls, rain HUD and streaks, no console errors), then cleanup and a PASS/FAIL summary. Use in every Paper Golf job's done-when, before saying "done" or shipping, and whenever a change to the game, UI or build needs proving in a real browser.
---

# Verify Paper Golf

Paper Golf is a static web app: the surface is the browser (phone first, desktop too). One command proves it:

```sh
npm run verify -- --shots <dir for screenshots and logs>     # = bash scripts/verify.sh
```

It must end with the line `PASS`. Quote its summary block as evidence. A `FAIL` line names the step and its log;
fix the cause (CLAUDE.md "Rules": never loosen a spec, config or check to get green) and run it again.

## Launch

`scripts/verify.sh` does all of it; never start a dev server (`npm run dev`) for verification.

1. Doctor (below), then picks a free port: 4318, or the next free one up to 4338 (`--port N` or `VERIFY_PORT`).
2. Deletes `dist/` and runs `npm run check` (typecheck TS 7, ESLint zero warnings, vitest at 4 workers, production
   build into `dist/`), so the browser steps only ever see this build.
3. Runs each flow as `SMOKE_PORT=<port> npx playwright test <spec>`: `playwright.config.ts` starts
   `npx vite preview --port <port> --strictPort` on `dist/`, waits until the page answers, and stops it after the
   spec. Each flow gets its own server and browsers (Playwright `workers: 1`).

Ready means the page renders the cover: every flow's first assertion is `#cover h1` = `GOLF` or `#hud` contains
`Hole N`.

## Doctor

Built into the script; it exits with a `✗` line before touching anything if Node is not 22 (`.nvmrc`), no Chrome
is found, or Playwright WebKit is not installed (`npx playwright install webkit`). Chrome is `CHROME_PATH` when
that is set, then `/Applications/Google Chrome.app`, `/usr/bin/google-chrome`, and `google-chrome-stable` or
`chromium` on `PATH`. WebKit is the macOS Library cache or `~/.cache/ms-playwright`. It runs `npm install` when
`node_modules/` is missing. If anything else looks off, check that nothing of yours still listens:
`lsof -nP -iTCP:4318 -sTCP:LISTEN`.

## Drive

Playwright specs in `e2e/`, against the production build, desktop Chrome (`chrome` project) and WebKit as an iPhone 14
(`iphone-webkit` project, 390x664 visible viewport). The feature map, `features/README.md`, has the recipe, stable
handles and gotchas for each flow:

| Step | Spec | Browsers | Proves |
| --- | --- | --- | --- |
| solo round | `e2e/journey.spec.ts` | Chrome + iPhone WebKit | cover → New round → Tee off; Roll; the dots equal the engine's legal moves; shots until the hole card; the scorecard shows the score; on to hole 2 |
| boot | `e2e/smoke.spec.ts` | Chrome | the start page loads and a deep-link turn records a stroke, and the deep-link round is never saved |
| turn order | `e2e/turnorder.spec.ts` | Chrome + iPhone WebKit | 3 players: the ball away plays (twice running), tap-ins by distance, the hole winner has the honour on hole 2 |
| wind | `e2e/windfx.spec.ts` | Chrome + iPhone WebKit | `Wind W 2` HUD, swirls inked on the canvas and trees swaying on a windy hole; `Calm`, a blank canvas and still trees on a calm one; nothing moves under reduced motion |
| rain | `e2e/rain.spec.ts` | Chrome + iPhone WebKit | `Rain` beside the wind reading on a rainy hole and nothing on a dry one, streaks falling on the rain canvas (one still shower under reduced motion), and a rainy hole played wet and heavy: shorter hits, the ball left where it lands |

Every one of these specs collects `console` errors and `pageerror`s and fails unless the list is empty.

To drive one flow by hand (after `npm run build`): `SMOKE_PORT=4318 npx playwright test e2e/journey.spec.ts
--project iphone-webkit`. Add a new flow as a spec in `e2e/` that follows `e2e/journey.spec.ts`, list it in
`features/`, and add a `flow` line to `scripts/verify.sh`.

## Evidence

- The summary block the script prints: one `PASS`/`FAIL`/`SKIP` line per step, then `PASS` or `FAIL`.
- `<shots>/chrome-targets.png`, `-hole-card.png`, `-scorecard.png` and the same for `iphone-webkit-`: the roll with
  its dots, the hole card, the scorecard (from `VERIFY_SHOTS`).
- `<shots>/logs/<step>.log`: the full output of each step; `<shots>/test-results/<step>/`: Playwright traces of a
  failed test (`npx playwright show-trace <zip>`).

The default `<shots>` is `verify-results/` (gitignored); pass `--shots` to keep the evidence in a job folder. The
solo round plays with real dice and a fresh round's random wind, so each run covers a different hole 1; a failure
message prints the roll and the ball's position, and the trace replays it.

Proof standards: the solo round goes through the real user path (buttons and taps, no deep link) and checks the saved
state behind what is on screen (`localStorage` `paper-golf:game:v1`: the dots against `availableMoves`, the card
against `players[0].scores[0]`). Deep links (`?play=<course>&players=<n>&hole=<h>`) and the die rig
(`e2e/rig.ts`) are only used where a flow needs a known position or wind.

## Cleanup

Playwright stops the `vite preview` server and the browsers of each flow. The script then checks the port is free and
that no browser process that appeared during the run was left orphaned; it stops only those (never by name) and marks
the step `FAIL`. Evidence in `<shots>` is never deleted. `dist/` stays (it is the build that was verified).

## Helpers

- `scripts/verify.sh [--port N] [--shots DIR] [--no-check]` (`npm run verify -- ...`): the whole run above.
  `--no-check` skips `npm run check` and reuses `dist/`; only for re-running browser flows while iterating, never as
  the done-when run. `--help` prints its usage.
- `e2e/rig.ts`: `rigDice(page)` + `queueDice(page, ...)` decide the die in a spec.
