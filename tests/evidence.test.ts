import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BEATS, clipHtml, pageHtml, parseClips } from '../e2e/walkthroughs/review-first-2-scenes';

// PR 72's video: the explainer, then real terminal clips CI captured
// (scripts/ship/pr-video-evidence.sh), then the verdict.
describe('the evidence clips', () => {
  const good = { caption: 'The bug', command: 'gh run view 1 --log', captured_at: '2026-10-28T08:00:00Z', ok: true, lines: ['a', 'b'] };

  it('reads each clip field by field and drops the rest', () => {
    expect(parseClips([good, { ...good, ok: 'yes' }, null, 'x', { ...good, lines: ['c', 2] }])).toEqual([
      good,
      { ...good, lines: ['c'] },
    ]);
    expect(parseClips({ clips: [good] })).toEqual([]);
  });

  it('shows what gh printed as text, never as markup', () => {
    const html = clipHtml({ ...good, lines: ['<!-- pr-blocked -->', '<b>x</b>'] }, 3);
    expect(html).toContain('id="c-3"');
    expect(html).toContain('&#60;!-- pr-blocked --&#62;');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('$ gh run view 1 --log');
    expect(html).toContain('Captured live from GitHub by CI at 2026-10-28T08:00:00Z');
  });

  it('says so when a clip was not captured, and marks a failed command', () => {
    expect(clipHtml(undefined, 0)).toContain('No evidence was captured for this clip in this run.');
    expect(clipHtml({ ...good, ok: false }, 0)).toContain('the command failed: this is its error');
    // With no evidence at all every clip beat still has a section to show.
    const page = pageHtml([]);
    for (const beat of BEATS) if (beat.kind === 'clip') expect(page).toContain(`id="c-${String(beat.clip)}"`);
  });
});

describe('the beats of the video', () => {
  const spec = readFileSync('e2e/walkthroughs/review-first-2.spec.ts', 'utf8');
  const evidence = spec.split('\n').filter((l) => l.startsWith('// walkthrough-evidence: '));

  it('plays every evidence line the spec names, once and in order', () => {
    const clips = BEATS.flatMap((b) => (b.kind === 'clip' ? [b.clip] : []));
    expect(clips).toEqual(evidence.map((_, i) => i));
  });

  it('ends on the verdict card, held past the 2 s tail cut', () => {
    const last = BEATS[BEATS.length - 1];
    expect(last?.kind).toBe('verdict');
    expect(last?.seconds).toBeGreaterThanOrEqual(15);
    expect(BEATS.filter((b) => b.kind === 'verdict')).toHaveLength(1);
  });

  it('runs the explainer, then the evidence, then the verdict', () => {
    const firstClip = BEATS.findIndex((b) => b.kind === 'clip');
    const explainer = BEATS.slice(0, firstClip).reduce((s, b) => s + b.seconds, 0);
    expect(explainer).toBeGreaterThanOrEqual(45);
    expect(BEATS.slice(0, firstClip).every((b) => b.kind === 'scene')).toBe(true);
  });
});
