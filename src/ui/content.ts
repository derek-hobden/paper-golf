/** Static page content: legend icons and the rules sheet. */

import { ballBody, ballDefs, ballLight } from './golfball';

const ICONS: Record<string, string> = {
  // The golf ball as on the board: still a white circle with a dark pencil outline, now dimpled and shaded.
  ball: `<defs>${ballDefs('lg-ball')}</defs><g transform="translate(13 13) scale(0.16)" color="#2a2a2d">${ballBody()}${ballLight('lg-ball', 10)}</g>`,
  hole: '<circle cx="13" cy="13" r="7" fill="#3a3a3a"/>',
  flag: '<line x1="10" y1="4" x2="10" y2="22" stroke="#bbb" stroke-width="1.5"/><path d="M10 4 L19 7 L10 10 Z" fill="#ddd"/>',
  rough: '<rect x="2" y="2" width="22" height="22" rx="4" fill="#e2e2df"/><circle cx="13" cy="13" r="1.6" fill="#888"/>',
  fairway: '<rect x="2" y="2" width="22" height="22" rx="6" fill="#fff" stroke="#e2e2df"/><circle cx="13" cy="13" r="1.6" fill="#999"/>',
  slope: '<rect x="2" y="2" width="22" height="22" rx="6" fill="#e2e2df"/><path d="M9 8 L18 13 L9 18 Z" fill="#666"/>',
  sand:
    '<defs><pattern id="lg-h" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)"><rect width="4" height="4" fill="#f4f3ef"/><line x1="0" y1="0" x2="0" y2="4" stroke="#bdbdb9" stroke-width="1.2"/></pattern></defs><rect x="2" y="2" width="22" height="22" rx="6" fill="url(#lg-h)"/>',
  water: '<rect x="2" y="2" width="22" height="22" rx="6" fill="#7d8084"/><circle cx="13" cy="13" r="1.6" fill="#b5b7ba"/>',
  trees:
    '<g fill="#47474a"><path d="M13 1 L18 8 L16 8 L20 14 L6 14 L10 8 L8 8 Z"/><rect x="12" y="13" width="2" height="3"/><ellipse cx="13" cy="20" rx="5" ry="3.6"/><rect x="12" y="22" width="2" height="4"/></g>',
  line: '<line x1="13" y1="2" x2="13" y2="18" stroke="#2a2a2d" stroke-width="1.6" stroke-linecap="round"/><circle cx="13" cy="21" r="3.4" fill="none" stroke="#2a2a2d" stroke-width="1.6"/>',
  dice: '<rect x="3" y="3" width="20" height="20" rx="4" fill="#2a2a2d"/><g fill="#fff"><circle cx="8.5" cy="8.5" r="2"/><circle cx="17.5" cy="8.5" r="2"/><circle cx="13" cy="13" r="2"/><circle cx="8.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/></g>',};

export const icon = (k: string, size = 26) =>
  `<svg viewBox="0 0 26 26" width="${String(size)}" height="${String(size)}" aria-hidden="true">${ICONS[k] ?? ''}</svg>`;

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
      ${row('line', 'Each move is a straight line N, E, S, W or diagonally. Tap a marked spot to hit there. Par is 6; in Proper golf each hole has its own par (3, 4 or 5), shown on the page and the card.')}
    </ul>
    <h3>${icon('dice', 20)} Dice Golf</h3>
    <ul>
      <li>Roll a d6 to determine hit distance.</li>
      <li><b>+1</b> if hitting from the fairway, <b>−1</b> from a sand trap.</li>
      <li>When teeing off you may re-roll once, but you must use the second roll.</li>
      <li>You have 6 “Mulligans” per course that can be used to re-roll any time.</li>
      <li>You may <i>always</i> choose to putt (move 1 space) on your turn.</li>
      <li>The <b>green</b> (white) is every dot within 2 of the cup, diagonals too. On it you only putt: roll a <b>2</b> to putt 2 dots, a <b>3</b> to putt 3, anything else putts 1. Putts roll on the ground, never through water or trees.</li>
      <li><b>Tap-in:</b> a ball resting right next to the cup is putted in for you on your next turn: one stroke, no roll.</li>
    </ul>
    <h3>Pass &amp; play</h3>
    <ul>
      <li>Up to 4 players take turns on the same page, each with their own pencil colour.</li>
      <li>Pick up after 10 strokes. Lowest total after 12 holes wins.</li>
    </ul>`;
}
