// One scene on screen at a time, cut, never faded. A walkthrough whose scenes faded in over
// each other left every old scene's text half drawn under the new one at each change, and
// four layers stacked by the decision card (pr-73-a9ecb5b.mp4, Gus, 28 Oct 2026). Every
// scene not current is `display: none`, so nothing of it is drawn at all.

/**
 * The CSS for scenes with ids `s0`..`s<count-1>` and class `scene`: shown only while
 * `body[data-scene]` names them, with no transition of any kind.
 */
export const sceneCutCss = (count: number): string =>
  `.scene{display:none;transition:none}\n` +
  Array.from({ length: count }, (_, i) => `body[data-scene="${String(i)}"] #s${String(i)}{display:block}`).join('\n');
