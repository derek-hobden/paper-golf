/**
 * What the explainer video shows, worked out from the pull request itself.
 *
 * Whoever opens the pull request writes a `## How to see it` section — a few
 * plain steps, in whatever words come naturally. This turns those steps into
 * something Playwright can drive. It is deliberately forgiving: a line it does
 * not recognise becomes a `beat`, a pause the narration can talk over, so a
 * section written by a person who has never read this file still produces a
 * video. Nothing here throws, and nothing here fails a pull request.
 *
 * With no `## How to see it` section, the plan falls back to a short tour of
 * the app when the diff touches it, and to a title card when it does not
 * (a workflow or a docs change has no screen to show).
 */

/** One thing the walkthrough does. `raw` is the line it came from, for the narration. */
export type Step =
  | { readonly kind: 'open'; readonly path: string; readonly raw: string }
  | { readonly kind: 'click'; readonly text: string; readonly raw: string }
  | { readonly kind: 'type'; readonly text: string; readonly into: string; readonly raw: string }
  | { readonly kind: 'expect'; readonly text: string; readonly raw: string }
  | { readonly kind: 'wait'; readonly seconds: number; readonly raw: string }
  | { readonly kind: 'shot'; readonly raw: string }
  | { readonly kind: 'beat'; readonly raw: string };

export type PlanKind = 'walkthrough' | 'tour' | 'card';

export interface Plan {
  /** walkthrough: the pull request's own steps. tour: the app. card: a title card. */
  readonly kind: PlanKind;
  readonly steps: readonly Step[];
  /** The files the diff touches, for a card and for the narration. */
  readonly files: readonly string[];
}

const HEADING = /^#{1,6}\s*(.+?)\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

/** Everything under the `## How to see it` heading, up to the next heading. */
export function howToSeeIt(body: string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading !== null) {
      const title = (heading[1] ?? '').toLowerCase().replace(/[^a-z ]/g, '').trim();
      if (inside) break;
      inside = title === 'how to see it';
      continue;
    }
    if (inside) out.push(line);
  }
  return out.join('\n').trim();
}

/** The list items of a section, or its non-empty lines when it has no list. */
export function sectionSteps(section: string): string[] {
  const lines = section.split('\n');
  const items = lines.flatMap((line) => {
    const m = LIST_ITEM.exec(line);
    const text = m?.[1]?.trim();
    return text === undefined || text === '' ? [] : [text];
  });
  if (items.length > 0) return items;
  return lines.map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('<!--'));
}

/** `"Roll"` and `` `Roll` `` and `**Roll**` all mean Roll. */
function unquote(text: string): string {
  let out = text.trim().replace(/[.;,]+$/, '').trim();
  for (;;) {
    const stripped = out
      .replace(/^\*\*(.*)\*\*$/s, '$1')
      .replace(/^[`'"“”‘’](.*)[`'"“”‘’]$/s, '$1')
      .trim();
    if (stripped === out) return out;
    out = stripped;
  }
}

/**
 * A path this walkthrough may navigate to: same-origin only, so a step can
 * never point the recording at someone else's site. A localhost origin (what a
 * person copies out of their own browser) is dropped down to its path.
 */
export function samePath(target: string): string | undefined {
  const text = unquote(target);
  const local = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(\/\S*)?$/i.exec(text);
  if (local !== null) return local[1] ?? '/';
  if (/^https?:\/\//i.test(text)) return undefined;
  if (text.startsWith('/') || text.startsWith('?')) return text;
  return undefined;
}

/** One written step, read as an action. Anything unrecognised is a beat. */
export function parseStep(line: string): Step {
  const raw = line.trim();
  const lower = raw.toLowerCase();

  const open = /^(?:open|go to|visit|load|navigate to)\s+(.+)$/i.exec(raw);
  if (open !== null) {
    const path = samePath(open[1] ?? '');
    if (path !== undefined) return { kind: 'open', path, raw };
    return { kind: 'beat', raw };
  }

  const typed = /^(?:type|enter|fill in)\s+(.+?)\s+(?:in|into)\s+(.+)$/i.exec(raw);
  if (typed !== null) {
    return { kind: 'type', text: unquote(typed[1] ?? ''), into: unquote(typed[2] ?? ''), raw };
  }

  if (/^(?:take|play|hit)\b.*\b(?:a shot|a turn|the shot)\b/i.test(raw)) return { kind: 'shot', raw };

  const clicked = /^(?:click|tap|press|choose|select|hit)\s+(?:on\s+)?(.+)$/i.exec(raw);
  if (clicked !== null) {
    const text = unquote(clicked[1] ?? '');
    if (text !== '') return { kind: 'click', text, raw };
  }

  const seen = /^(?:expect|see|check|confirm|you should see|note)\s+(?:that\s+)?(.+)$/i.exec(raw);
  if (seen !== null) {
    const text = unquote(seen[1] ?? '');
    if (text !== '') return { kind: 'expect', text, raw };
  }

  const waited = /^wait(?:\s+(?:for\s+)?(\d+)\s*s(?:econds?)?)?\b/i.exec(lower);
  if (waited !== null) {
    const seconds = Number(waited[1] ?? '2');
    return { kind: 'wait', seconds: Number.isFinite(seconds) ? Math.min(seconds, 10) : 2, raw };
  }

  return { kind: 'beat', raw };
}

/** Does the diff change anything the browser shows? */
export function touchesTheApp(files: readonly string[]): boolean {
  return files.some((f) => f === 'index.html' || f.startsWith('src/'));
}

/** The default tour: the cover, the rules sheet, and one shot of a real round. */
export function tourSteps(): readonly Step[] {
  return [
    { kind: 'open', path: '/', raw: 'Open the notebook cover' },
    { kind: 'expect', text: 'GOLF', raw: 'The cover reads GOLF' },
    { kind: 'click', text: 'How to play', raw: 'Open How to play' },
    { kind: 'wait', seconds: 2, raw: 'Read the rules' },
    { kind: 'open', path: '/?play=0&players=1&hole=1', raw: 'Start a solo round on hole 1' },
    { kind: 'click', text: 'Roll', raw: 'Roll the die' },
    { kind: 'shot', raw: 'Play the shot' },
    { kind: 'wait', seconds: 2, raw: 'The stroke is recorded' },
  ];
}

/** The plan for one pull request. */
export function planFor(body: string, files: readonly string[]): Plan {
  const written = sectionSteps(howToSeeIt(body)).map(parseStep);
  // A section of nothing but beats says nothing a tour would not say better.
  if (written.some((step) => step.kind !== 'beat')) {
    return { kind: 'walkthrough', steps: written, files };
  }
  if (touchesTheApp(files)) return { kind: 'tour', steps: tourSteps(), files };
  return { kind: 'card', steps: [], files };
}
