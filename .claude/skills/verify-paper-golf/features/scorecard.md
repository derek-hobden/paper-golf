# Scorecard

When a hole is done the hole card shows each player's strokes and score name; the scorecard lists every hole's
score, Out, In and Total against par 72.

## Sub-features

- `card-hole` the hole card shows `Hole N done` and each player's strokes.
- `card-table` the scorecard row `Hole N` has the score; the Total row adds it up.
- `card-next` Next hole → turns the page to hole N+1.

## How to get to it (user POV)

- The hole card's Card button after a hole.
- The tray's scorecard icon (`#tray [data-act=card]`, label `Scorecard`) at any time in a round.
- On a wide screen, the mini card under the tray.

## Driving it with Playwright

Preconditions:

- A solo round played to the hole card (see [Solo round](./solo-round.md)).

- **Hole card.** `.hole-card h2` reads `Hole 1 done`; `.hole-card .rows .hand` equals the saved
  `players[0].scores[0]`.
- **Scorecard.** Click `.hole-card [data-act=card]`. `#page h2` reads `Scorecard`; the first
  `.card-table tbody tr` reads `Hole 1` and its second cell is the score; `tfoot tr[data-total="Total"]` contains it.
- **Next hole.** Click `#page [data-act=back]`, then `.hole-card [data-act=next]`. `#hud` contains `Hole 2`.
- **Run it.** Part of `e2e/journey.spec.ts`.

## Gotchas

- Back to the hole re-shows the hole card (the hole is still done); Next hole is on that card.
- A score under par is drawn circled with no player ink; compare text, not colour.
