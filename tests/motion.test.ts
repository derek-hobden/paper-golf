import { describe, expect, it } from 'vitest';
import { at } from './helpers';
import {
  illustrationProblems, type MotionScene, motionPage, resolveScenes, scenesFromSteps, scriptOf, stepLines, unsaidLabels,
} from '../e2e/walkthroughs/motion';
import { planFor } from '../e2e/walkthroughs/plan';
import type { Clip } from '../e2e/walkthroughs/review-first-2-scenes';
import { reviewWords } from '../e2e/walkthroughs/review-first-scenes';

// The motion kit (Flo on pr-99-58eefae.mp4): every scene an animated diagram, never text slides
// read aloud, and the narration the very lines the screen shows, from one source.

/** PR 99's own steps, as its body has them. */
const STEPS = [
  '- what this is: "The video recorder refuses evidence that cannot be true", "A pull request\'s own page is filmed before its video exists", "You decide: approve this change, or ask for changes"',
  '- before: "Before, the video for pull request 77 showed its own page", "The voice said the page opens with its video link", "The page on screen had no link yet"',
  '- what changes: "The recorder checks the evidence first", "A video plan that films its own page is refused"',
  '- after: "Another pull request\'s page is still filmed"',
  '- risk: "Only the video recorder and its written rules change", "Nothing in the game\'s code changes"',
  '- decision: "Yours to approve", "Approve: add the approved label", "Or ask for changes", stamped with the commit',
  '- review result: the fixed review result, shown as it is said',
];

const review: Clip = {
  caption: 'Review', command: 'PR=99 bash scripts/ship/review-findings.sh review', captured_at: '2026-10-31T17:00:00Z',
  ok: true, cols: 100, rows: 24, recorder: 'https://github.com/o/r/actions/runs/9', headline: '',
  stream: btoa('$ x\r\n'), timing: [[0.01, 5]], lines: ['round=1', 'found=', 'notes=2'],
};

const decode = (s: string): string =>
  s.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim().toLowerCase();

/** What each scene puts on screen as words: its diagram's labels and its lines. */
const screenWords = (html: string): string[] =>
  (html.match(/<section id="s\d+" class="scene [a-z]+">[\s\S]*?<\/section>/g) ?? []).map((sec) =>
    decode([...sec.matchAll(/<(?:text|p class=said)[^>]*>([^<]*)</g)].map((m) => m[1] ?? '').join(' ')));

describe('the motion kit', () => {
  const scenes = resolveScenes(scenesFromSteps(STEPS), [review], '58eefae');
  const html = motionPage(scenes, [review]);
  const script = scriptOf(scenes);

  it('draws a pull request\'s steps as diagrams, in the plain-story order, the review result last', () => {
    expect(scenes.map((s) => s.picture.kind)).toEqual(['flow', 'flow', 'flow', 'flow', 'flow', 'fork', 'review']);
    const before = at(scenes, 1).picture;
    expect(before.kind === 'flow' && before.stop).toBe(true);
    const change = at(scenes, 2).picture;
    expect(change.kind === 'flow' && change.tone).toBe('new');
    for (const s of scenes) expect(s.seconds).toBeGreaterThanOrEqual(5);
  });

  it('ends on the review result even when no step names it (PR 105 review note 4434013463)', () => {
    const without = scenesFromSteps(STEPS.filter((s) => !s.includes('review result')));
    expect(without.map((s) => s.picture.kind).at(-1)).toBe('review');
    expect(without.filter((s) => s.picture.kind === 'review')).toHaveLength(1);
    expect(scenesFromSteps(STEPS).filter((s) => s.picture.kind === 'review')).toHaveLength(1);
  });

  it('refuses a text-only scene, and every scene it draws moves', () => {
    expect(illustrationProblems(html)).toEqual([]);
    expect(illustrationProblems('<section id="s0" class="scene flow"><h1>Before</h1><p>The page had no link</p></section>'))
      .toEqual(['scene 1 is text only: it needs an animated diagram (an SVG with shapes that move), not words alone']);
    // A drawing that never moves is a slide too.
    expect(illustrationProblems('<section id="s0" class="scene flow"><svg><rect/><rect/><rect/></svg></section>')).toHaveLength(1);
    // A terminal clip is evidence, not a slide.
    expect(illustrationProblems('<section id="s0" class="scene clip"><p>terminal</p></section>')).toEqual([]);
  });

  it('says every word it shows, and shows every line it says (pr-99-58eefae.mp4 at 0:04 and 1:10)', () => {
    const shown = screenWords(html);
    expect(shown).toHaveLength(script.length);
    script.forEach((paragraph, i) => {
      const said = decode(paragraph);
      const onScreen = at(shown, i);
      // Every word on screen is in this scene's paragraph...
      for (const word of onScreen.split(' ')) expect(said).toContain(word);
      // ...and every line of the paragraph is on screen, word for word.
      for (const line of at(scenes, i).say) {
        for (const word of decode(line).split(' ')) expect(onScreen).toContain(word);
      }
    });
    // The stamp is shown and said as one line, never a bare "commit 58eefae" the voice glosses.
    expect(at(script, 5)).toBe('Yours to approve. Approve: add the approved label. Or ask for changes. Filmed at commit 58eefae.');
    // The review result scene shows the review's own words, the fixed paragraph the narration says.
    expect(at(script, 6)).toBe(reviewWords([review]));
    expect(at(script, 6)).toBe('The automatic code review read the whole change and found no problems that block merging. It left 2 small suggestions, which do not block anything. So this is safe to merge once a person approves it.');
  });

  it('refuses a picture word the scene never says', () => {
    const scene: MotionScene = { tag: 'before', say: ['The page had no link yet'], picture: { kind: 'flow', nodes: ['A link', 'Pull requests are proposed changes'] }, seconds: 5 };
    expect(unsaidLabels(scene, [])).toEqual(['A link', 'Pull requests are proposed changes']);
    expect(() => motionPage([scene], [])).toThrow('scene 1 shows "A link" and never says it');
  });

  it('writes the steps back out, quoting every line', () => {
    const steps = stepLines(scenesFromSteps(STEPS));
    expect(at(steps, 1)).toBe('- before: "Before, the video for pull request 77 showed its own page", "The voice said the page opens with its video link", "The page on screen had no link yet"');
    expect(at(steps, 5)).toContain(', stamped with the commit it was filmed at');
    expect(at(steps, 6)).toBe('- review result: the fixed review result, shown as it is said');
  });
});

describe('the plan for a change with no screen to show', () => {
  const body = `## How to see it\n\n${STEPS.join('\n')}\n\n## Spec\n`;

  it('is a motion explainer, not a title card read aloud', () => {
    expect(planFor(body, ['scripts/ship/pr-video-record.sh', 'AGENTS.md']).kind).toBe('motion');
  });

  it('is still a walkthrough of the app when the change touches it', () => {
    expect(planFor(body, ['src/main.ts']).kind).not.toBe('motion');
    expect(planFor('## How to see it\n\n- open /\n- click Roll\n', ['scripts/x.sh']).kind).toBe('walkthrough');
  });
});
