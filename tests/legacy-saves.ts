/**
 * Real saves written by older versions of the game (`paper-golf:game:v1`), for the unit tests and e2e.
 *
 * `OLD_12_HOLE_SAVE` was written by 93f049e (the last version with the Dice Golf / Proper golf choice): a 12-hole
 * par-6 round, two players, on hole 3 mid-turn. `newGame(1, ['Ann', 'Bob'])`, holes 1-2 putted out, then a roll of 4
 * and a putt. Rounds saved before Proper golf existed are the same without `golf`.
 */
export const OLD_12_HOLE_SAVE = {
  "version": 1,
  "golf": "default",
  "course": 1,
  "holeIndex": 2,
  "players": [
    {
      "name": "Ann",
      "color": "#2b2b2e",
      "scores": [
        1,
        1,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ],
      "mulligans": 6
    },
    {
      "name": "Bob",
      "color": "#2856a8",
      "scores": [
        1,
        1,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ],
      "mulligans": 6
    }
  ],
  "balls": [
    {
      "pos": {
        "x": 8,
        "y": 17
      },
      "strokes": 1,
      "holed": false,
      "pickedUp": false,
      "shots": [
        {
          "from": {
            "x": 8,
            "y": 18
          },
          "dir": 0,
          "dist": 1,
          "landing": {
            "x": 8,
            "y": 17
          },
          "end": {
            "x": 8,
            "y": 17
          },
          "rolled": false,
          "holed": false,
          "kind": "putt"
        }
      ]
    },
    {
      "pos": {
        "x": 8,
        "y": 18
      },
      "strokes": 0,
      "holed": false,
      "pickedUp": false,
      "shots": []
    }
  ],
  "current": 1,
  "dice": null,
  "holeDone": false,
  "finished": false
} as const;

/** The same round as saved before Proper golf existed (38cfcb2): no `golf` field. */
export const OLD_PRE_PROPER_SAVE: Record<string, unknown> = Object.fromEntries(
  Object.entries(OLD_12_HOLE_SAVE).filter(([k]) => k !== 'golf'),
);
