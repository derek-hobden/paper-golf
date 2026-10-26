/** Static page content: legend icons and the rules sheet. */

import { rainLabel } from '../engine/rain';
import type { Wind } from '../engine/types';
import { windLabel, windReading } from '../engine/wind';
import { ballBody, ballDefs, ballLight } from './golfball';

const ICONS: Record<string, string> = {
  // The golf ball as on the board: still a white circle with a dark pencil outline, now dimpled and shaded.
  ball: `<defs>${ballDefs('lg-ball')}</defs><g transform="translate(13 13) scale(0.16)" color="#2a2a2d">${ballBody()}${ballLight('lg-ball', 10)}</g>`,
  hole: '<circle cx="13" cy="13" r="7" fill="#3a3a3a"/>',
  flag: '<line x1="10" y1="4" x2="10" y2="22" stroke-width="1.5" style="stroke:var(--legend-pole)"/><path d="M10 4 L19 7 L10 10 Z" style="fill:var(--legend-flag)"/>',
  rough: '<rect x="2" y="2" width="22" height="22" rx="4" style="fill:var(--t-rough)"/><circle cx="13" cy="13" r="1.6" style="fill:var(--t-dot-rough)"/>',
  fairway: '<rect x="2" y="2" width="22" height="22" rx="6" style="fill:var(--t-fairway);stroke:var(--t-rough)"/><circle cx="13" cy="13" r="1.6" style="fill:var(--t-dot-fairway)"/>',
  slope: '<rect x="2" y="2" width="22" height="22" rx="6" style="fill:var(--t-rough)"/><path d="M9 8 L18 13 L9 18 Z" style="fill:var(--t-slope)"/>',
  sand:
    '<defs><pattern id="lg-h" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)"><rect width="4" height="4" style="fill:var(--t-sand)"/><line x1="0" y1="0" x2="0" y2="4" stroke-width="1.2" style="stroke:var(--t-sand-line)"/></pattern></defs><rect x="2" y="2" width="22" height="22" rx="6" fill="url(#lg-h)"/>',
  water: '<rect x="2" y="2" width="22" height="22" rx="6" style="fill:var(--t-water)"/><circle cx="13" cy="13" r="1.6" style="fill:var(--t-dot-water)"/>',
  trees:
    '<g style="fill:var(--t-tree)"><path d="M13 1 L18 8 L16 8 L20 14 L6 14 L10 8 L8 8 Z"/><rect x="12" y="13" width="2" height="3"/><ellipse cx="13" cy="20" rx="5" ry="3.6"/><rect x="12" y="22" width="2" height="4"/></g>',
  line: '<line x1="13" y1="2" x2="13" y2="18" stroke="#2a2a2d" stroke-width="1.6" stroke-linecap="round"/><circle cx="13" cy="21" r="3.4" fill="none" stroke="#2a2a2d" stroke-width="1.6"/>',
  dice: '<rect x="3" y="3" width="20" height="20" rx="4" fill="#2a2a2d"/><g fill="#fff"><circle cx="8.5" cy="8.5" r="2"/><circle cx="17.5" cy="8.5" r="2"/><circle cx="13" cy="13" r="2"/><circle cx="8.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/></g>',};

export const icon = (k: string, size = 26) =>
  `<svg viewBox="0 0 26 26" width="${String(size)}" height="${String(size)}" aria-hidden="true">${ICONS[k] ?? ''}</svg>`;

/** The HUD's wind readout, pencilled in the hand font: "Wind NE 2", or "Calm". The board shows it as curved shot lines. */
export function windHtml(w: Wind): string {
  const label = windLabel(w);
  if (w.strength === 0) return `<span class="wind calm" title="${label}"><span class="hand">Calm</span></span>`;
  return `<span class="wind" title="${label}"><span class="wind-word">Wind </span><span class="hand">${windReading(w)}</span></span>`;
}

/** The HUD's rain readout, pencilled in the hand font before the wind: "Rain · Wind NE 2". Nothing on a dry hole. */
export function rainHtml(rain: boolean): string {
  const label = rainLabel(rain);
  return label === '' ? '' : `<span class="rain" title="${label}"><span class="hand">${label}</span></span>`;
}

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
      ${row('slope', 'Arrows indicate a slope. Whenever your ball stops on one (after a hit, a putt, the wind or another slope), it rolls 1 space that way, and on down any chain of slopes.')}
      ${row('sand', 'This is a sand trap. It lessens the power of your hits, and a bunker beside the green is still sand: never green, so it earns no long putt.')}
      ${row('water', 'This is water. The ball may go over water, but not land in it.')}
      ${row('trees', 'These are trees. The ball may go over trees only when hitting from the fairway.')}
      ${row('line', 'Each move is a straight line N, E, S, W or diagonally. Tap a marked spot to hit there.')}
    </ul>
    <h3>${icon('dice', 20)} Proper golf, with a die</h3>
    <ul>
      <li>A round is 18 holes, par 72: four par 3s, ten par 4s and four par 5s. Each hole's par is on the page and the card.</li>
      <li>Roll a d6 to determine hit distance.</li>
      <li><b>+1</b> if hitting from the fairway, <b>−1</b> from a sand trap.</li>
      <li>When teeing off you may re-roll once, but you must use the second roll.</li>
      <li>You have 6 “Mulligans” per round that can be used to re-roll any time.</li>
      <li>You may <i>always</i> choose to putt (move 1 space) on your turn.</li>
      <li>The <b>green</b> (the palest patch) is every grassy dot within 2 of the cup, diagonals too; a bunker in there is sand, not green. On the green you only putt: roll a <b>2</b> to putt 2 dots, a <b>3</b> to putt 3, anything else putts 1. Putts roll on the ground, never through water or trees. From greenside sand you play a sand shot instead (the roll <b>−1</b>), or putt 1.</li>
      <li><b>Tap-in:</b> a ball resting right next to the cup is putted in for you on your next turn: one stroke, no roll.</li>
      <li><b>Wind:</b> each hole has a wind (at the top, e.g. “Wind NE 2”, or Calm). It pushes where every hit comes down 1 or 2 dots downwind (all the way: a diagonal wind moves it 1 each way per dot) before any slope rolls it. Only where it ends counts: a hit the wind would leave in water, in trees or off the page can't be played, and one aimed just off the page can be blown back on. The shot lines curve with it onto the spot the ball really stops; putts are never blown.</li>
      <li><b>Elevation:</b> ground drawn as a sheet of paper glued on the page sits a level up, ground pressed into it a level down. A hit carries one space less for every level it goes up, one more for every level it goes down (never less than 1), judged from the spot it would have come down on; putts never change. A marker the ground moved shows a dashed ring where a level hit would have landed.</li>
      <li><b>Rain:</b> some holes are rainy (“Rain” at the top, beside the wind). The ground is wet, so the ball stops where it lands and no slope rolls it on, and the air is heavy, so every hit carries one space less than usual. Sand, water and putting are unchanged.</li>
      <li><b>Straight in:</b> when your roll can reach the cup, the ball goes in by itself: no need to tap the hole.</li>
    </ul>
    <h3>Pass &amp; play</h3>
    <ul>
      <li>Up to 4 players take turns on the same page, each with their own pencil colour.</li>
      <li><b>Who plays:</b> golf etiquette. On hole 1 players tee off in the order they were set up; after that, the best score on the last hole has the <b>honour</b> and tees off first. Once everyone is off the tee, whoever is <b>away</b> (furthest from the cup, counted in dots) plays next, even twice in a row.</li>
      <li>Pick up after 10 strokes. Lowest total after 18 holes wins.</li>
    </ul>`;
}
