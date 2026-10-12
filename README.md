# Paper Golf

Digital version of gladden Paper Apps GOLF (notepad golf). Vite + TypeScript static site with three.js touches.

- **Dice Golf**: roll a d6 for distance (+1 from the fairway, −1 from sand), one free tee re-roll, 6 mulligans per course, putt 1 any time.
- **Speed Golf**: driver 6 (fairway only), iron 3 (2 from sand), putter 1.
- Overshoot the hole by 1 and it still drops. Water can be flown over, trees only from the fairway, slope arrows roll the ball one space.
- 60 procedurally generated holes (5 courses × 12), deterministic seeds; every hole is validated solvable in both modes.
- Pass-and-play for 1–4 players, scorecard, progress saved in `localStorage`.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # vitest: rules engine, generator (all 60 holes), game flow
npm run build    # type-check + production build into dist/
```

`?play=<course 0-4>&mode=dice|speed&players=<1-4>&hole=<1-12>` jumps straight into a round (handy for screenshots).

## Layout

- `src/engine/` — pure rules (`rules.ts`), solver (`solver.ts`: Speed Golf BFS, Dice Golf expected strokes by value iteration), generator (`generator.ts`), seeded RNG.
- `src/game/game.ts` — pass-and-play state machine (turns, dice, mulligans, scoring).
- `src/ui/` — SVG notebook page (`board.ts`), three.js overlay for the die, paper ball and pencil (`fx.ts`), hand-drawn path helpers.
- `tests/` — vitest suites.
