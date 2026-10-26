import { describe, expect, it } from 'vitest';
import {
  howToSeeIt,
  parseStep,
  planFor,
  samePath,
  sectionSteps,
  touchesTheApp,
} from '../e2e/walkthroughs/plan';
import { at } from './helpers';

// The explainer video is driven by the `## How to see it` section whoever opened the
// pull request wrote — in their own words, with no syntax to learn. The parser is
// forgiving on purpose: a line it does not recognise is a beat, never an error, so a
// section nobody proof-read still makes a video (AGENTS.md "PR explainer videos").

const BODY = `https://github.com/derek-hobden/paper-golf/releases/download/pr-videos/pr-52-aaa1111.mp4

---

## Spec

Something.

## How to see it

1. Open /?play=0&players=1&hole=1
2. Click "Roll"
3. Take a shot
4. You should see the stroke count go to 1

## Checklist

- [x] done
`;

describe('the How to see it section', () => {
  it('takes only that section, whatever its heading level', () => {
    expect(howToSeeIt(BODY)).toContain('Click "Roll"');
    expect(howToSeeIt(BODY)).not.toContain('Something.');
    expect(howToSeeIt(BODY)).not.toContain('done');
    expect(howToSeeIt('### how to see IT\n\n- Open /\n')).toBe('- Open /');
  });

  it('is empty when the pull request did not write one', () => {
    expect(howToSeeIt('## Spec\n\nJust a spec.\n')).toBe('');
    expect(howToSeeIt('')).toBe('');
  });

  it('reads a numbered list, a bulleted list, or bare lines', () => {
    expect(sectionSteps('1. one\n2) two')).toEqual(['one', 'two']);
    expect(sectionSteps('- one\n* two\n+ three')).toEqual(['one', 'two', 'three']);
    expect(sectionSteps('one\n\ntwo')).toEqual(['one', 'two']);
    expect(sectionSteps('<!-- a note -->\none')).toEqual(['one']);
  });
});

describe('one written step', () => {
  it('opens a path', () => {
    expect(parseStep('Open /?play=0')).toEqual({ kind: 'open', path: '/?play=0', raw: 'Open /?play=0' });
    expect(parseStep('go to /')).toMatchObject({ kind: 'open', path: '/' });
    // What a person copies out of their own browser is just a path.
    expect(parseStep('Visit http://localhost:4319/?play=1')).toMatchObject({ kind: 'open', path: '/?play=1' });
  });

  // A walkthrough that can be pointed at another site is a walkthrough that can
  // record someone else's page. Off-origin is a beat, not a navigation.
  it('never navigates off this origin', () => {
    expect(samePath('https://example.test/evil')).toBeUndefined();
    expect(parseStep('Open https://example.test/evil')).toEqual({
      kind: 'beat',
      raw: 'Open https://example.test/evil',
    });
    expect(samePath('http://localhost:4319')).toBe('/');
  });

  it('clicks by the words on the control, however they are quoted', () => {
    for (const line of ['Click "Roll"', 'tap `Roll`', 'Press **Roll**', 'choose Roll.', 'click on Roll']) {
      expect(parseStep(line), line).toMatchObject({ kind: 'click', text: 'Roll' });
    }
  });

  it('types, waits, expects and plays a shot', () => {
    expect(parseStep('Type "Amna" into the name box')).toMatchObject({
      kind: 'type',
      text: 'Amna',
      into: 'the name box',
    });
    expect(parseStep('wait')).toMatchObject({ kind: 'wait', seconds: 2 });
    expect(parseStep('Wait for 5 seconds')).toMatchObject({ kind: 'wait', seconds: 5 });
    // A long wait is still a pause in a video, not a stall.
    expect(parseStep('wait 600s')).toMatchObject({ kind: 'wait', seconds: 10 });
    expect(parseStep('You should see the scorecard')).toMatchObject({
      kind: 'expect',
      text: 'the scorecard',
    });
    expect(parseStep('Take a shot')).toMatchObject({ kind: 'shot' });
  });

  it('keeps a line it cannot read as a beat, never an error', () => {
    const step = parseStep('Admire the pencil texture for a moment');
    expect(step.kind).toBe('beat');
    expect(step.raw).toBe('Admire the pencil texture for a moment');
  });
});

describe('the plan for a pull request', () => {
  it('follows the written steps when there are any', () => {
    const plan = planFor(BODY, ['src/ui/board.ts']);
    expect(plan.kind).toBe('walkthrough');
    expect(plan.steps.map((s) => s.kind)).toEqual(['open', 'click', 'shot', 'expect']);
  });

  it('tours the app when the section is missing and the diff touches it', () => {
    const plan = planFor('## Spec\n\nA fix.', ['src/engine/rules.ts']);
    expect(plan.kind).toBe('tour');
    expect(at(plan.steps, 0)).toMatchObject({ kind: 'open', path: '/' });
    expect(plan.steps.some((s) => s.kind === 'shot')).toBe(true);
  });

  it('falls back to a title card when there is no screen to show', () => {
    const plan = planFor('## Spec\n\nCI only.', ['.github/workflows/ci.yml', 'scripts/ship/lib.sh']);
    expect(plan.kind).toBe('card');
    expect(plan.steps).toEqual([]);
    expect(plan.files).toEqual(['.github/workflows/ci.yml', 'scripts/ship/lib.sh']);
  });

  // A section of prose with no action in it is worth less than the tour.
  it('tours rather than film a section of nothing but beats', () => {
    const body = '## How to see it\n\n- It looks nicer now\n- Honestly it does\n';
    expect(planFor(body, ['src/style.css']).kind).toBe('tour');
    expect(planFor(body, ['README.md']).kind).toBe('card');
  });

  it('knows which files the browser can show', () => {
    expect(touchesTheApp(['src/engine/rules.ts'])).toBe(true);
    expect(touchesTheApp(['index.html'])).toBe(true);
    expect(touchesTheApp(['README.md', 'scripts/ship/lib.sh'])).toBe(false);
  });
});
