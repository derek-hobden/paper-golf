# Solo round

One player opens the notebook, starts a new round, rolls the die, picks one of the marked dots and plays shots until
the ball is in the cup (or picked up at 10 strokes).

## Sub-features

- `solo-start` starts a 1-player round from the cover.
- `solo-roll` rolls the die; the tray says `rolled N`.
- `solo-dots` marks exactly the legal shots for the lie, roll and wind: one marker per end dot.
- `solo-shot` a tap on a marker plays the shot and adds a stroke.
- `solo-auto` a tap-in or a roll that can reach the cup plays itself, no tap.
- `solo-finish` the hole ends with the hole card.

## How to get to it (user POV)

- Cover: New round → (1 player, the default) → Tee off →.
- Cover: Continue · Hole N for a saved round.
- A link `?play=<course>&players=1&hole=<h>`.

## Driving it with Playwright

Preconditions:

- Production build served by `vite preview`; empty `localStorage`.

- **Start.** Click `#cover [data-act=new]`, then `#page [data-act=go]`. `#hud` contains `Hole 1`, the stroke chip
  `#hud .chip .hand` reads `0`.
- **Roll.** Click `#tray [data-act=roll]`. `#tray .status` contains `rolled`.
- **Dots.** Read the saved round, `loadState(JSON.parse(localStorage['paper-golf:game:v1']))`, and
  `availableMoves(g)`; hits before putts, one per end dot. The set of `g.target` `aria-label`s equals it.
- **Shot.** Click `g.target[aria-label="<label>"] circle.hit` with `force`. The stroke chip goes up by one, or the
  hole card shows.
- **Finish.** Repeat from Roll (when no Roll button shows, a tap-in is playing) until `.hole-card` shows
  `Hole 1 done`.
- **Run it.** `SMOKE_PORT=4318 npx playwright test e2e/journey.spec.ts` (both browsers).

## Gotchas

- Real dice and a random wind: every run plays a different hole 1. The assertion message prints the roll and ball
  position; the trace replays the run.
- After a roll that can reach the cup there are no dots: the status reads `It can drop` and the shot plays ~0.5 s
  later. The saved die may already be cleared when read.
- A boxed-in ball can have no dots: take a mulligan (`#tray [data-act=mull]`).
- The board dedupes markers by end dot, so compare labels, not `availableMoves(g).length`.
- A deep-link round is never saved: there is no `localStorage` state to check against.
