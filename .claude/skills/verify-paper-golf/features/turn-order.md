# Turn order

In a 2-4 player pass-and-play round, turns follow golf etiquette: setup order on the first tee, then the ball
furthest from the cup plays (the same player can go twice), and the lowest score on a hole has the honour on the
next tee.

## Sub-features

- `turns-away` the ball furthest away (in dots) plays next, again if still furthest.
- `turns-tapin` tap-ins play themselves in distance order.
- `turns-honour` the hole winner tees off first on the next hole; the hole card lists the next tee order.
- `turns-labels` the tray and banner read `Player 2 · away` / `· honour` / `· on the tee`; balls carry initials.

## How to get to it (user POV)

- Cover: New round → + (More players) → Tee off →.
- A link `?play=<course>&players=<2-4>&hole=<h>`.

## Driving it with Playwright

Preconditions:

- A calm 3-player round written to `localStorage` (Player 2 four dots out on a straight line to the cup, Players 1
  and 3 next to it), then Continue; dice rigged with `e2e/rig.ts`.

- **Away.** `#tray .status` contains `Player 2 · away`; three `.ball-mark`s read 1, 2, 3.
- **Twice running.** Roll a 1 and putt towards the cup; the banner and status still read `Player 2 · away`.
- **Hole card.** After Player 2 holes, the tap-ins play; `.hole-card .tee-order` reads
  `Next tee: Player 3 · Player 1 · Player 2`; saved scores are `[3, 4, 2]`.
- **Honour.** Next hole: `#banner` and the status read `Player 3 · honour`; after Player 3's shot,
  `Player 1 · on the tee`.
- **Run it.** `SMOKE_PORT=4318 npx playwright test e2e/turnorder.spec.ts` (both browsers).

## Gotchas

- Re-rolls and mulligans never pass the turn.
- The setup depends on Meadow Links hole 1's layout (`lineToCup`); a generator change that breaks it throws
  `no straight line into the cup`, which is a setup failure, not a turn-order bug.
