/** Static page content: legend icons and the rules sheet. */

const ICONS: Record<string, string> = {
  ball: '<circle cx="13" cy="13" r="6" fill="#fff" stroke="#2a2a2d" stroke-width="2.4"/>',
  hole: '<circle cx="13" cy="13" r="7" fill="#3a3a3a"/>',
  flag: '<line x1="10" y1="4" x2="10" y2="22" stroke="#bbb" stroke-width="1.5"/><path d="M10 4 L19 7 L10 10 Z" fill="#ddd"/>',
  rough: '<rect x="2" y="2" width="22" height="22" rx="4" fill="#fff" stroke="#e2e2df"/><circle cx="13" cy="13" r="1.6" fill="#999"/>',
  fairway: '<rect x="2" y="2" width="22" height="22" rx="6" fill="#e2e2df"/><circle cx="13" cy="13" r="1.6" fill="#888"/>',
  slope: '<rect x="2" y="2" width="22" height="22" rx="6" fill="#e2e2df"/><path d="M9 8 L18 13 L9 18 Z" fill="#666"/>',
  sand:
    '<defs><pattern id="lg-h" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)"><rect width="4" height="4" fill="#f4f3ef"/><line x1="0" y1="0" x2="0" y2="4" stroke="#bdbdb9" stroke-width="1.2"/></pattern></defs><rect x="2" y="2" width="22" height="22" rx="6" fill="url(#lg-h)"/>',
  water: '<rect x="2" y="2" width="22" height="22" rx="6" fill="#7d8084"/><circle cx="13" cy="13" r="1.6" fill="#b5b7ba"/>',
  trees:
    '<g fill="#47474a"><path d="M13 1 L18 8 L16 8 L20 14 L6 14 L10 8 L8 8 Z"/><rect x="12" y="13" width="2" height="3"/><ellipse cx="13" cy="20" rx="5" ry="3.6"/><rect x="12" y="22" width="2" height="4"/></g>',
  line: '<line x1="13" y1="2" x2="13" y2="18" stroke="#2a2a2d" stroke-width="1.6" stroke-linecap="round"/><circle cx="13" cy="21" r="3.4" fill="none" stroke="#2a2a2d" stroke-width="1.6"/>',
  dice: '<rect x="3" y="3" width="20" height="20" rx="4" fill="#2a2a2d"/><g fill="#fff"><circle cx="8.5" cy="8.5" r="2"/><circle cx="17.5" cy="8.5" r="2"/><circle cx="13" cy="13" r="2"/><circle cx="8.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/></g>',
  speed: '<g stroke="#2a2a2d" stroke-width="3" stroke-linecap="round"><line x1="9" y1="7" x2="23" y2="7"/><line x1="5" y1="13" x2="23" y2="13"/><line x1="9" y1="19" x2="23" y2="19"/></g>',
};

export const icon = (k: keyof typeof ICONS | string, size = 26) =>
  `<svg viewBox="0 0 26 26" width="${size}" height="${size}" aria-hidden="true">${ICONS[k] ?? ''}</svg>`;

export function rulesHtml(): string {
  const row = (k: string, text: string) => `<li>${icon(k)}<span>${text}</span></li>`;
  return `
    <h2>Legend</h2>
    <ul class="legend">
      ${row('ball', 'This is the ball.')}
      ${row('hole', 'This is the hole.')}
      ${row('flag', 'Get the ball to the hole in as few strokes as possible. You may overshoot the hole by 1 space.')}
      ${row('rough', 'This is the rough.')}
      ${row('fairway', 'This is the fairway. It increases the power of your hits.')}
      ${row('slope', 'Arrows indicate a slope. If you land directly on one, your ball rolls 1 space in that direction.')}
      ${row('sand', 'This is a sand trap. It lessens the power of your hits.')}
      ${row('water', 'This is water. The ball may go over water, but not land in it.')}
      ${row('trees', 'These are trees. The ball may go over trees only when hitting from the fairway.')}
      ${row('line', 'Each move is a straight line N, E, S, W or diagonally. Tap a marked spot to hit there. Par is 6.')}
    </ul>
    <h3>${icon('dice', 20)} Dice Golf</h3>
    <ul>
      <li>Roll a d6 to determine hit distance.</li>
      <li><b>+1</b> if hitting from the fairway, <b>−1</b> from a sand trap.</li>
      <li>When teeing off you may re-roll once, but you must use the second roll.</li>
      <li>You have 6 “Mulligans” per course that can be used to re-roll any time.</li>
      <li>You may <i>always</i> choose to putt (move 1 space) on your turn.</li>
    </ul>
    <h3>${icon('speed', 20)} Speed Golf</h3>
    <ul>
      <li>Choose to move 6, 3 or 1 spaces with each hit.</li>
      <li><b>Driver</b> (6): only from the fairway.</li>
      <li><b>Iron</b> (3): any time. Only 2 from sand.</li>
      <li><b>Putter</b> (1): you may <i>always</i> putt.</li>
    </ul>
    <h3>Pass &amp; play</h3>
    <ul>
      <li>Up to 4 players take turns on the same page, each with their own pencil colour.</li>
      <li>Pick up after 10 strokes. Lowest total after 12 holes wins.</li>
    </ul>`;
}
