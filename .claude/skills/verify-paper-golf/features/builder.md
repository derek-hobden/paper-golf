# Course builder

Draw one hole on the same 13×20 grid as a generated hole, then play it. Nothing is stored on a server, the hole is not a course best, and the generated courses are unchanged.

## Sub-features

- From New round, Build a hole. Paint rough, fairway, sand, water and trees, cycle a slope through the eight arrows and off, place one tee and one pin, erase back to rough, undo and clear. Par is 3, 4 or 5.
- Play it checks the hole. An unreachable pin (or a tee or pin that is not on grass or sand) stays on the builder with one sentence saying why.
- Play it starts one round on that hole, with the usual wind and rules. The round is not saved and is not a course best.
- Share writes `#h=` (base64url). Opening it loads the hole into the builder. A bad link says "That hole link is broken" and opens an empty builder.

## How to get to it (user POV)

- Cover: New round → Build a hole → paint → Tee → Pin → Play it.
- Or open a link whose hash is `#h=` plus the shared token.

## Driving it with Playwright

- `[data-act=build]` on the New round sheet, then `[data-tool=fairway|sand|water|tree|rough|slope|tee|pin|erase]`, `[data-par]`, `[data-act=undo|clear|share|play|back]`.
- Paint by pressing on `svg.board-play` at a cell centre `(x + 0.5) / 13` across and `(y + 0.5) / 20` down. The pin is `.cup-rim`. The reason, or the share line, is `#builder-note`.
- A shared hole is `location.hash`. A built round does not write `paper-golf:game:v1` or `paper-golf:best:v1`.

## Gotchas

- The tools sit in a scroller on a short phone so Play it stays on screen. Tap targets are at least 44px; the grid cells are smaller, and a drag paints every cell the pointer enters.
- Slope, tee and pin apply once per gesture. Terrain and erase follow the drag.
- `#h=` wins over `?play=` when both are present. Leaving the builder clears the hash.
