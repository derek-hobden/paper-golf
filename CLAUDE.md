# Paper Golf — notes for agents

Vite + TypeScript static site (no framework, no WebGL). Read README.md for the game rules, layout and the
performance rules; they are binding.

## Verify (always, before saying "done")

```sh
npm install
npm run check    # typecheck (TS 7) → lint (ESLint, zero warnings) → vitest → production build
npm run smoke    # Playwright smoke test against `vite preview` (system Chrome); not part of check
```

- Quote the `npm run check` output as evidence. CI (`.github/workflows/ci.yml`) runs the same on push to main.
- Node 22 (`.nvmrc`, `engines`). Pre-commit: husky (set up by `npm install` via `prepare`) runs `.husky/pre-commit`
  → lint-staged (`eslint --fix` on staged files). Don't bypass it with `--no-verify`.
- Type-check with `npm run typecheck`, not `npx tsc`: the root `typescript` package is 6.0 only because
  typescript-eslint needs its JS API; the app compiler is TS 7 (`node_modules/typescript7`).

## Architecture

- `src/engine/` — pure, deterministic rules: `rules.ts` (moves, terrain), `generator.ts` (60 seeded holes,
  validated solvable), `solver.ts` (expected Dice Golf strokes), `rng.ts`, `types.ts`. No DOM here.
- `src/game/game.ts` — pass-and-play state machine: turns, dice, mulligans, scoring. No DOM here.
- `src/ui/` — SVG board, 2D effects (die, ball, pencil), shot flight timing. `src/main.ts` wires UI to the game.
- `tests/` — vitest unit tests for engine, game flow and flight; `e2e/` — Playwright smoke test.
- Logic belongs in `engine`/`game` with a unit test; keep `ui`/`main.ts` thin.

## Rules

- TypeScript is strict with `noUncheckedIndexedAccess`; ESLint is typescript-eslint `strictTypeChecked`.
  Fix the code. Never add `eslint-disable`, `@ts-ignore`, `!` non-null assertions or silencing casts, and never
  loosen `tsconfig.json`, `eslint.config.js` or a test to get green.
- Reuse the checked-access primitives instead of inventing new ones: `itemAt`/`must` (`src/engine/assert.ts`),
  `gridAt` (`src/engine/grid.ts`), `byId`/`query` (`src/ui/dom.ts`), and `at`/`defined` (`tests/helpers.ts`).
- **The repo is memory:** a mistake or bad pattern that happens twice becomes a check that fails — prefer
  structure/types, then a lint rule in `eslint.config.js`, then a test — committed with the fix, plus one row in
  the "Guard rules" table below (Rule | How enforced | Past bad commit).

## Video types (Derek, 13 Oct 2026)

Agree the video type with Derek before any video work starts, and state it in the job brief. If the ask clearly names a type, confirm it in one line; otherwise ask one short question offering the likely types. Full spec: the shared `video-types` skill.

1. **Quick build explainer** (default for "show me what was built"): Playwright screen recording of the real app plus TTS narration. No Remotion, no motion graphics, minimal editing, hardware encoder; as cheap and fast as possible.
2. **Promo or marketing video**: agree a script and shot list first, then Playwright recordings, then Remotion post-editing (key elements rebuilt as React components, motion graphics, transitions), then narration (and music if wanted). Several review rounds; plan time and machine load.
3. **Staff tutorial**: step-by-step script following the real task flow, a Playwright recording of each step, clear narration, light highlights or captions (zooms, callouts), optional chapters. Accuracy beats flash.
4. **Social clip**: 15 to 60 s, vertical 9:16 unless told otherwise, captions burned in, hook in the first 2 s; usually cut from existing footage or a promo.
5. **Release notes / changelog video**: one short segment per change (recording plus caption or narration) from a fixed template; light branding, no heavy motion graphics.
6. **Sales or investor demo**: scripted around one audience's problem, real product recordings, narration, light polish. Agree the audience and key messages first.
7. **Bug report recording**: raw recording of the reproduction steps, no narration or editing; steps, URL, account and time noted in text. Never show secrets or private data.
8. **Customer onboarding / help video**: the staff-tutorial process plus brand styling, a clean demo account (no real customer data) and captions.

Always: 720p (1280x720 or 720x1280) unless Derek names a higher resolution, including promo drafts; narration only with the approved voice model `google/gemini-3.8-flash-lite-tts` (via `~/bots-work/lib/narrate.sh`); renders and recordings under `~/bots-work/lib/slot.sh run heavy` (or `browser`); H.264 yuv420p, AAC, +faststart. A request that fits none of these: agree a custom process with Derek first.

## Guard rules

| Rule | How enforced | Past bad commit |
| --- | --- | --- |
| Strict types and lint are fixed in code: no `eslint-disable`, `@ts-ignore`, `!` assertions, silencing casts, or loosened config/tests | `tsconfig.json` strict + `noUncheckedIndexedAccess`, typescript-eslint `strictTypeChecked` with `--max-warnings 0`, run by `npm run check`, the lint-staged pre-commit hook and CI | - |
| typescript-eslint does not support TS 7's API yet: keep `typescript` at 6.0 for lint, `typescript7` for builds | `package.json` pins (`typescript` ~6.0, `typescript7` alias) | - |
