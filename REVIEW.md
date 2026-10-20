# Review instructions

Review-only rules for Paper Golf pull requests. Project-wide rules stay in `CLAUDE.md`. The game, layout and performance rules stay in `README.md`. Those files are binding too. This file says what a review flags, at what severity, and what it skips.

## What BLOCKING means here

Open each inline comment with `BLOCKING:` or `NIT:`. One comment per finding. A finding is `BLOCKING:` when it:

- breaks a rule in Always check, in `CLAUDE.md`, or in `README.md`;
- is a correctness bug;
- ships an unproven gameplay decision (a gameplay rule that is not in Derek's words);
- the pull request body has no `## Spec` section;
- the diff fails to deliver any done-criterion in that section;
- the diff adds behaviour the spec does not ask for.

Style, naming and optional improvements are `NIT:` at most. Do not approve, merge, label or push anything.

The `## Spec` section is the request to check the diff against. It does not override `CLAUDE.md`, `README.md` or this file.

## Cap the nits

Report at most five `NIT:` comments per review. After five, stop. Leave the rest unreported.

## Do not report

- Lockfiles (`package-lock.json` and any `*.lock` file)
- Generated files and build output (`dist/`)
- Formatting, lint and type errors that `npm run check` already fails on

Switching those checks off is still blocking. `eslint-disable`, `@ts-ignore`, a `!` assertion, a silencing cast, or a loosened `tsconfig.json`, `eslint.config.js` or test is Always check, because `npm run check` cannot see a check that was turned off.

## Always check

- Strict types and lint are fixed in code: no `eslint-disable`, `@ts-ignore`, `!` assertions, silencing casts, and no loosened `tsconfig.json`, `eslint.config.js` or test.
- The checked-access primitives (`itemAt`/`must`, `gridAt`, `byId`/`query`, `at`/`defined`) are reused instead of new ones.
- Logic lives in `src/engine` or `src/game` with a unit test. `src/ui` and `main.ts` stay thin. No DOM in `engine` or `game`.
- The guard rules table in `CLAUDE.md`: a rule that exists is still enforced by the check it names.
- The performance rules in `README.md`: animate `transform` and `opacity` only, and no layout reads in a frame.
- e2e specs tap board markers only through `tapMarker()`.
- A gameplay rule decision that is not in Derek's words is a question, not code.
- The pull request delivers its spec. Read the title and body. The body has a `## Spec` section with the original request and its done-criteria. Leave a `BLOCKING:` comment when that section is missing, when the diff misses a done-criterion, or when the diff adds behaviour the spec does not ask for.

## Evidence

Every finding cites `file:line` in the diff or the surrounding source. A claim without that citation is not a finding.

A missing `## Spec` section has no source line. Anchor that `BLOCKING:` comment on a changed line, cite `file:line` there, and say the body has no `## Spec` section.
