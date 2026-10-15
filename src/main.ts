import '@fontsource/caveat/latin-700.css';
import '@fontsource/space-mono/latin-400.css';
import '@fontsource/space-mono/latin-700.css';
import '@fontsource/space-mono/latin-700-italic.css';
import './style.css';

import { COURSES } from './engine/generator';
import { itemAt } from './engine/assert';
import { cellAt, diceDistance, greenPuttLength, onGreen } from './engine/rules';
import {
  PLAYER_COLORS,
  autoPutt,
  autoPuttMove,
  availableMoves,
  cardTotals,
  canMulligan,
  canTeeReroll,
  currentBall,
  currentHole,
  currentPlayer,
  deepLinkGolf,
  formatToPar,
  holePar,
  holesInRound,
  loadState,
  mulligan,
  newGame,
  nextHole,
  parseDeepLink,
  roll,
  roundPars,
  scoreName,
  shoot,
  skipToHole,
  teeReroll,
  toPar,
  totalStrokes,
  type GameState,
  type GolfMode,
  type MoveOption,
  type ShotRecord,
} from './game/game';
import { PaletteSetting, playerInk, type Palette } from './game/palette';
import { Board } from './ui/board';
import { icon, rulesHtml } from './ui/content';
import { byId, query } from './ui/dom';
import { InputLock, flightLegs, shotSteps, type ShotStep } from './ui/flight';
import { Fx } from './ui/fx';
import { sketchCircle, wobblyLine } from './ui/sketch';

// ------------------------------------------------------------------ storage

const KEY_GAME = 'paper-golf:game:v1';
const KEY_PREFS = 'paper-golf:prefs:v1';
const KEY_BEST = 'paper-golf:best:v1';

interface Prefs {
  golf: GolfMode;
  course: number;
  names: string[];
  count: number;
}

function readJson(key: string): unknown {
  try {
    const s = localStorage.getItem(key);
    if (!s) return null;
    const v: unknown = JSON.parse(s);
    return v;
  } catch {
    return null;
  }
}

function writeJson(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable: play on without persistence */
  }
}

/** Saved prefs, keeping only well-typed fields (older prefs also stored the game mode; it is dropped). */
function parsePrefs(v: unknown): Partial<Prefs> {
  const out: Partial<Prefs> = {};
  if (typeof v !== 'object' || v === null) return out;
  if ('golf' in v && (v.golf === 'default' || v.golf === 'proper')) out.golf = v.golf;
  if ('course' in v && typeof v.course === 'number') out.course = v.course;
  if ('count' in v && typeof v.count === 'number') out.count = v.count;
  if ('names' in v && Array.isArray(v.names) && v.names.every((n: unknown): n is string => typeof n === 'string')) {
    out.names = v.names;
  }
  return out;
}

/** Saved course bests: every numeric entry. */
function parseBest(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof v !== 'object' || v === null) return out;
  for (const k of Object.keys(v)) {
    const n: unknown = Reflect.get(v, k);
    if (typeof n === 'number') out[k] = n;
  }
  return out;
}

const prefs: Prefs = {
  golf: 'default',
  course: 0,
  names: ['Player 1', 'Player 2', 'Player 3', 'Player 4'],
  count: 1,
  ...parsePrefs(readJson(KEY_PREFS)),
};

// Greyscale or colour. A ?play= deep-link round may switch the look but never saves it (like its round, below).
const linkParams = new URLSearchParams(location.search);
const palette = new PaletteSetting(storage(), !linkParams.has('play'));

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Show the palette on the root (style.css swaps its custom properties) and on the palette toggle. */
function showPalette(p: Palette) {
  document.documentElement.dataset.palette = p;
  for (const b of document.querySelectorAll('[data-act=palette]')) {
    b.setAttribute('aria-pressed', String(p === 'colour'));
    const state = b.querySelector('.palette-state');
    if (state) state.textContent = p === 'colour' ? 'on' : 'off';
  }
}

/** The toggle, on the setup and How to play sheets (the tray has no room left beside the status on a phone). */
const paletteToggle = () =>
  `<button class="btn small palette-btn" data-act="palette" aria-pressed="false"><svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path fill="none" d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 1.6-2.1-.5-1.3.3-2.4 1.7-2.4H18a3 3 0 0 0 3-3c0-5-4-8.5-9-8.5z"/><g stroke="none"><circle class="pal-1" cx="7.5" cy="11" r="1.6"/><circle class="pal-2" cx="10" cy="7" r="1.6"/><circle class="pal-3" cx="15" cy="7.5" r="1.6"/></g></svg>Colour: <span class="palette-state">off</span></button>`;

function togglePalette() {
  showPalette(palette.toggle());
}

/** Wire the palette toggle inside `root` (the sheets re-render it). */
function bindPalette(root: ParentNode) {
  for (const b of root.querySelectorAll('[data-act=palette]')) b.addEventListener('click', togglePalette);
  showPalette(palette.value);
}

// Course bests, keyed `dice:<course>` (the prefix predates dice-only play; old `speed:` entries are ignored), and
// `proper:<course>` for Proper golf rounds.
const best = parseBest(readJson(KEY_BEST));
const bestKey = (golf: GolfMode, course: number) => `${golf === 'proper' ? 'proper' : 'dice'}:${String(course)}`;
const parTotal = (golf: GolfMode) => roundPars(golf).reduce((a, b) => a + b, 0);
const curPar = (g: GameState) => holePar(g.golf, g.holeIndex);
const courseOf = (g: GameState) => itemAt(COURSES, g.course, 'course');

// ------------------------------------------------------------------ elements

const desk = byId('desk');
const notebook = byId('notebook');
const page = byId('page');
const cover = byId('cover');
const tray = byId('tray');
const spiral = byId('spiral');
const banner = byId('banner');
const fx = new Fx(byId('fx'));

let game: GameState | null = null;
{
  const saved = loadState(readJson(KEY_GAME));
  if (saved && !saved.finished) game = saved;
}

type Screen = 'cover' | 'setup' | 'play' | 'rules' | 'card';
let screen: Screen = 'cover';
const input = new InputLock();
let board: Board | null = null;
let shownHole = -1;

// A ?play= deep-link round is never persisted, so it can't overwrite (or clear) the player's real saved round.
let linkRound: GameState | null = null;

const saveGame = () => {
  if (game && game === linkRound) return;
  writeJson(KEY_GAME, game && !game.finished ? game : null);
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);

function d6(): number {
  try {
    return (itemAt(crypto.getRandomValues(new Uint32Array(1)), 0) % 6) + 1;
  } catch {
    return 1 + Math.floor(Math.random() * 6);
  }
}

// ------------------------------------------------------------------ layout

const DESK_GAP = 10; // #desk gap between the notebook and the tray
const HUD_H = 48; // one row of player chips plus its margin: the least the HUD is budgeted

/** The HUD's real height with its margin: player chips wrap to more rows on a narrow board (3–4 players). */
function hudHeight(): number {
  const hud = screen === 'play' ? page.querySelector<HTMLElement>('.hud') : null;
  return hud ? Math.max(HUD_H, hud.offsetHeight + 4) : HUD_H;
}

/** The HUD height the last layout() fitted the board to. */
let fittedHudH = HUD_H;
/** Re-fit when the HUD grows after layout: chips change, or the web fonts load and widen them. Only growth, so it can't loop. */
const hudObserver = new ResizeObserver(() => {
  if (hudHeight() > fittedHudH) layout();
});

function layout() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Short landscape (phones on their side): side-by-side too, with tight padding and the board sized to the height.
  const short = vh < 500 && vw / vh > 1.2;
  const wide = short || (vw >= 820 && vw / vh > 1.2);
  desk.classList.toggle('wide', wide);
  desk.classList.toggle('short', short);
  const pad = vw < 380 || short ? 10 : 14;
  document.documentElement.style.setProperty('--pad', `${String(pad)}px`);
  const deskPad = short ? 16 + 4 + 4 : 22 + 8 + 16;
  const trayH = wide || tray.hidden ? 0 : tray.offsetHeight + DESK_GAP;
  const availW = (wide ? vw - (short ? 270 + 20 : 300 + 36) - 40 : vw - 28) - pad * 2;
  // A narrower board can wrap the chips onto another row, so re-measure the HUD until it stops growing.
  let hudH = hudHeight();
  let chrome = 0;
  let bw = 0;
  for (let pass = 0; pass < 3; pass++) {
    chrome = 26 + hudH + (short ? 0 : 34) + 10; // page top padding, HUD, score line (hidden when short), bottom padding
    const availH = vh - deskPad - chrome - trayH;
    bw = Math.max(short ? 120 : 200, Math.floor(Math.min(availW, (availH * 13) / 20, 600)));
    document.documentElement.style.setProperty('--board-w', `${String(bw)}px`);
    const measured = hudHeight();
    if (measured <= hudH) break;
    hudH = measured;
  }
  fittedHudH = hudH;
  const pageH = Math.round((bw * 20) / 13 + chrome);
  document.documentElement.style.setProperty('--page-h', `${String(pageH - 36)}px`);
  page.style.height = `${String(pageH)}px`;
  const coils = Math.max(8, Math.floor((bw + pad * 2 - 28) / 25));
  if (spiral.childElementCount !== coils) spiral.innerHTML = '<span class="coil"></span>'.repeat(coils);
  if (screen === 'play') placeDie();
}

window.addEventListener('resize', () => {
  layout();
  fx.resize();
  placeDie();
  board?.fitHits();
});

// ------------------------------------------------------------------ banner

let bannerTimer = 0;
function showBanner(html: string, ms = 1300): Promise<void> {
  banner.innerHTML = html;
  banner.classList.add('show');
  window.clearTimeout(bannerTimer);
  return new Promise((resolve) => {
    bannerTimer = window.setTimeout(() => {
      banner.classList.remove('show');
      resolve();
    }, ms * Math.max(0.6, fx.speed));
  });
}

// ------------------------------------------------------------------ cover

function renderCover() {
  const continueHole = game && !game.finished ? game.holeIndex + 1 : null;
  const canContinue = continueHole !== null;
  cover.innerHTML = `
    <span class="brand">pad &amp; pencil</span>
    <div class="apps">Paper Games™</div>
    <h1>GOLF</h1>
    <div class="menu">
      ${canContinue ? `<button class="btn dark" data-act="continue">Continue · Hole ${String(continueHole)}</button>` : ''}
      <button class="btn ${canContinue ? '' : 'dark'}" data-act="new">New round</button>
      <button class="btn" data-act="rules">How to play</button>
    </div>
    <div class="foot">5 courses · 12 holes of par 6, or 18-hole Proper golf · 1–4 players</div>`;
  cover.querySelector('[data-act=continue]')?.addEventListener('click', () => {
    openCover();
    showPlay();
  });
  query(cover, '[data-act=new]').addEventListener('click', () => {
    openCover();
    showSetup();
  });
  query(cover, '[data-act=rules]').addEventListener('click', () => {
    openCover();
    showRules('cover');
  });
}

function openCover() {
  cover.classList.add('open');
}

function closeCover() {
  void fx.hideDie();
  fx.hideBall();
  screen = 'cover';
  tray.hidden = true;
  layout();
  renderCover();
  cover.classList.remove('open');
}

// ------------------------------------------------------------------ setup

function bestHtml(golf: GolfMode, course: number): string {
  const b = best[bestKey(golf, course)];
  return b !== undefined ? `<div class="best">best ${formatToPar(b - parTotal(golf))}</div>` : '';
}

const GOLF_OPTIONS: readonly { golf: GolfMode; name: string; blurb: string }[] = [
  { golf: 'default', name: 'Dice Golf', blurb: '12 holes, every hole par 6.' },
  { golf: 'proper', name: 'Proper golf', blurb: '18 holes of par 3, 4 and 5. Par 72.' },
];

function showSetup() {
  screen = 'setup';
  tray.hidden = true;
  layout();
  const s = { ...prefs, names: [...prefs.names] };
  const draw = () => {
    page.innerHTML = `
      <div class="sheet">
        <div class="look"><h2>New round</h2>${paletteToggle()}</div>
        <h3>Round</h3>
        <div class="golf-modes">
          ${GOLF_OPTIONS.map(
            (o) => `
            <button class="opt ${s.golf === o.golf ? 'sel' : ''}" data-golf="${o.golf}" aria-pressed="${String(s.golf === o.golf)}">
              <b>${o.name}</b>${o.blurb}
            </button>`,
          ).join('')}
        </div>
        <h3>Course</h3>
        <div class="courses">
          ${COURSES.map(
            (c, i) => `
            <button class="opt ${s.course === i ? 'sel' : ''}" data-course="${String(i)}">
              <span class="num">${String(i + 1)}</span>
              <span><b>${c.name}</b>${c.blurb}</span>
              <span style="text-align:right">
                <span class="diff">${[0, 1, 2, 3, 4].map((k) => `<i class="${k <= Math.round(c.difficulty * 4) ? 'on' : ''}"></i>`).join('')}</span>
                ${bestHtml(s.golf, i)}
              </span>
            </button>`,
          ).join('')}
        </div>
        <h3>Players <span class="stepper">
          <button class="btn small" data-count="-1" aria-label="Fewer players" ${s.count <= 1 ? 'disabled' : ''}>−</button>
          <span class="hand" style="font-size:24px">${String(s.count)}</span>
          <button class="btn small" data-count="1" aria-label="More players" ${s.count >= 4 ? 'disabled' : ''}>+</button>
        </span></h3>
        <div class="players">
          ${Array.from({ length: s.count }, (_, i) => {
            const color = playerInk(itemAt(PLAYER_COLORS, i, 'player colour'));
            const n = String(i + 1);
            return `
            <label class="player-row">
              <span class="dot" style="border-color:${color}"></span>
              <input data-name="${String(i)}" maxlength="14" value="${esc(s.names[i] ?? `Player ${n}`)}" aria-label="Player ${n} name" style="color:${color}" autocomplete="off" />
            </label>`;
          }).join('')}
        </div>
        ${s.count > 1 ? '<p class="hint">Pass-and-play: hand the device round; each player draws in their own colour.</p>' : ''}
        <div class="actions">
          <button class="btn" data-act="back">Back</button>
          <button class="btn primary" data-act="go">Tee off →</button>
        </div>
      </div>`;
    page.querySelectorAll<HTMLButtonElement>('[data-golf]').forEach((b) => {
      b.addEventListener('click', () => {
        s.golf = b.dataset.golf === 'proper' ? 'proper' : 'default';
        draw();
      });
    });
    page.querySelectorAll<HTMLButtonElement>('[data-course]').forEach((b) => {
      b.addEventListener('click', () => {
        s.course = Number(b.dataset.course);
        draw();
      });
    });
    page.querySelectorAll<HTMLButtonElement>('[data-count]').forEach((b) => {
      b.addEventListener('click', () => {
        s.count = Math.min(4, Math.max(1, s.count + Number(b.dataset.count)));
        draw();
      });
    });
    page.querySelectorAll<HTMLInputElement>('[data-name]').forEach((inp) => {
      inp.addEventListener('input', () => {
        s.names[Number(inp.dataset.name)] = inp.value;
      });
    });
    bindPalette(page);
    query(page, '[data-act=back]').addEventListener('click', closeCover);
    query(page, '[data-act=go]').addEventListener('click', () => {
      Object.assign(prefs, s);
      writeJson(KEY_PREFS, prefs);
      game = newGame(s.course, s.names.slice(0, s.count), s.golf);
      saveGame();
      shownHole = -1;
      showPlay();
    });
  };
  draw();
}

// ------------------------------------------------------------------ rules & scorecard

function showRules(back: 'cover' | 'play') {
  screen = 'rules';
  void fx.hideDie();
  tray.hidden = true;
  layout();
  page.innerHTML = `<div class="sheet"><div class="look">${paletteToggle()}</div>${rulesHtml()}<div class="actions"><button class="btn primary" data-act="back">${
    back === 'play' ? 'Back to the hole' : 'Got it'
  }</button></div></div>`;
  bindPalette(page);
  query(page, '[data-act=back]').addEventListener('click', () => {
    if (back === 'play') showPlay();
    else closeCover();
  });
}

/** One total row of the card (Out, In or Total): its par, then each player's strokes and score to par so far. */
function totalRow(g: GameState, k: number, cls: string): string {
  const totals = g.players.map((p) => itemAt(cardTotals(p, g.golf), k, 'card total'));
  const first = itemAt(totals, 0, 'card total');
  const cells = totals
    .map((t) => `<td>${t.played ? `${String(t.strokes)} <span class="hint">(${formatToPar(t.toPar)})</span>` : ''}</td>`)
    .join('');
  return `<tr class="${cls}" data-total="${first.label}"><td>${first.label} <span class="hint">/${String(first.par)}</span></td>${cells}</tr>`;
}

function scorecardHtml(g: GameState): string {
  const head = g.players.map((p) => `<th style="color:${playerInk(p.color)}">${esc(p.name)}</th>`).join('');
  const holes = holesInRound(g.golf);
  // An 18-hole card adds Out after hole 9 and In after hole 18 (cardTotals: Out, In, Total); 12 holes: Total only.
  const nines = holes === 18;
  const rows = Array.from({ length: holes }, (_, h) => {
    const par = holePar(g.golf, h);
    const cells = g.players
      .map((p) => {
        const s = p.scores[h] ?? null;
        if (s === null) return '<td></td>';
        const cls = s < par ? 'hand under circled' : 'hand';
        return `<td class="${cls}" style="color:${s < par ? '' : playerInk(p.color)}">${String(s)}</td>`;
      })
      .join('');
    const row = `<tr class="${h === g.holeIndex && !g.finished ? 'cur' : ''}"><td>Hole ${String(h + 1)} <span class="hint">/${String(par)}</span></td>${cells}</tr>`;
    const sub = nines && h === 8 ? totalRow(g, 0, 'sub') : nines && h === 17 ? totalRow(g, 1, 'sub') : '';
    return row + sub;
  }).join('');
  const mulls = `<tr><td>Mulligans</td>${g.players.map((p) => `<td class="hint">${String(p.mulligans)} left</td>`).join('')}</tr>`;
  return `<table class="card-table${nines ? ' long' : ''}"><thead><tr><th>${esc(courseOf(g).name)}</th>${head}</tr></thead><tbody>${rows}</tbody><tfoot>${totalRow(g, nines ? 2 : 0, '')}${mulls}</tfoot></table>`;
}

function showScorecard() {
  if (!game) return;
  screen = 'card';
  void fx.hideDie();
  tray.hidden = true;
  layout();
  page.innerHTML = `<div class="sheet"><h2>Scorecard</h2>${scorecardHtml(game)}<div class="actions"><button class="btn primary" data-act="back">Back to the hole</button></div></div>`;
  query(page, '[data-act=back]').addEventListener('click', showPlay);
}

function showFinal() {
  if (!game) return;
  const g = game;
  screen = 'card';
  tray.hidden = true;
  layout();
  const ranked = [...g.players].sort((a, b) => totalStrokes(a) - totalStrokes(b));
  const winner = itemAt(ranked, 0, 'ranked player');
  const runnerUp = ranked[1];
  const tie = runnerUp !== undefined && totalStrokes(runnerUp) === totalStrokes(winner);
  // Record course bests.
  const k = bestKey(g.golf, g.course);
  const low = totalStrokes(winner);
  const prevBest = best[k];
  if (prevBest === undefined || low < prevBest) {
    best[k] = low;
    writeJson(KEY_BEST, best);
  }
  if (g !== linkRound) writeJson(KEY_GAME, null);
  const title =
    g.players.length === 1
      ? `${formatToPar(toPar(winner, g.golf))} on ${courseOf(g).name}`
      : tie
        ? "It's a tie!"
        : `${esc(winner.name)} wins!`;
  page.innerHTML = `<div class="sheet">
      <h2 class="hand" style="font-size:38px;margin:0 0 6px">${title}</h2>
      ${scorecardHtml(g)}
      <div class="actions">
        <button class="btn" data-act="home">Home</button>
        <button class="btn primary" data-act="again">Next course →</button>
      </div></div>`;
  query(page, '[data-act=home]').addEventListener('click', () => {
    game = null;
    closeCover();
  });
  query(page, '[data-act=again]').addEventListener('click', () => {
    game = newGame((g.course + 1) % COURSES.length, g.players.map((p) => p.name), g.golf);
    saveGame();
    shownHole = -1;
    showPlay();
  });
  void showBanner(tie ? 'Tie!' : g.players.length > 1 ? 'Winner!' : 'Round done!', 1500);
}

// ------------------------------------------------------------------ play

function showPlay() {
  if (!game) {
    closeCover();
    return;
  }
  if (game.finished) {
    showFinal();
    return;
  }
  screen = 'play';
  tray.hidden = false;
  layout();
  page.innerHTML = `
    <header class="hud" id="hud"></header>
    <div class="board-wrap" id="board-wrap"></div>
    <footer class="scoreline" id="scoreline"></footer>`;
  hudObserver.disconnect();
  hudObserver.observe(byId('hud'));
  board = new Board(byId('board-wrap'));
  shownHole = -1;
  refreshPage();
  beginTurn();
}

function refreshPage() {
  if (!game || !board) return;
  const g = game;
  const hole = currentHole(g);
  if (shownHole !== g.holeIndex || !board.currentHole) {
    board.setHole(hole);
    shownHole = g.holeIndex;
  }
  board.renderShots(g);
  board.renderBalls(g);
  const p = currentPlayer(g);
  const ball = currentBall(g);
  byId('hud').innerHTML = `
    <div class="title"><b>Hole ${String(g.holeIndex + 1)} <span class="hint">of ${String(holesInRound(g.golf))}</span></b><span class="course">${esc(courseOf(g).name)}</span></div>
    <div class="chips">${g.players
      .map((pl, i) => {
        const b = itemAt(g.balls, i, 'ball');
        const done = b.holed || b.pickedUp;
        return `<span class="chip ${i === g.current && !g.holeDone ? 'on' : ''} ${done ? 'done' : ''}" style="color:${playerInk(pl.color)}">
          <i style="background:${playerInk(pl.color)}"></i><span style="color:var(--ink)">${esc(pl.name)}</span>
          <span class="hand">${String(b.strokes)}</span></span>`;
      })
      .join('')}</div>`;
  byId('scoreline').innerHTML = `
    <span>Hole ${String(g.holeIndex + 1)} · Par ${String(curPar(g))}</span>
    <span>Strokes: <span class="hand" style="color:${playerInk(p.color)}">${ball.strokes ? String(ball.strokes) : ''}</span> /${String(curPar(g))}</span>
    <span>Total: <span class="hand" style="color:${playerInk(p.color)}">${p.scores.some((s) => s !== null) ? formatToPar(toPar(p, g.golf)) : ''}</span></span>`;
}

function lieText(): string {
  if (!game) return '';
  const hole = currentHole(game);
  const pos = currentBall(game).pos;
  if (onGreen(hole, pos)) return 'On the green: roll 2 or 3 to putt that far';
  const t = cellAt(hole, pos).t;
  return t === 'fairway' ? 'On the fairway: +1' : t === 'sand' ? 'In the sand: −1' : 'In the rough';
}

function dieSlotCenter() {
  const slot = document.getElementById('die-slot');
  if (!slot) return null;
  const r = slot.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: Math.min(r.width, r.height) * 0.78 };
}

function placeDie() {
  const c = dieSlotCenter();
  if (c) fx.placeDie(c, c.size);
}

function trayTools() {
  return `
    <button class="icon-btn" data-act="card" aria-label="Scorecard" title="Scorecard"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2a2116" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg></button>
    <button class="icon-btn" data-act="rules" aria-label="How to play" title="How to play"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2a2116" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/></svg></button>
    <button class="icon-btn" data-act="home" aria-label="Close notebook" title="Close notebook"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2a2116" stroke-width="2"><path d="M4 11l8-7 8 7v9H4z"/></svg></button>`;
}

function bindTrayTools() {
  tray.querySelector('[data-act=card]')?.addEventListener('click', () => {
    if (!input.busy) showScorecard();
  });
  tray.querySelector('[data-act=rules]')?.addEventListener('click', () => {
    if (!input.busy) showRules('play');
  });
  tray.querySelector('[data-act=home]')?.addEventListener('click', () => {
    if (!input.busy) closeCover();
  });
}

function renderTray(status: string, sub: string, controls: string) {
  tray.innerHTML = `
    <div class="menu-row"><div class="status">${status}<small>${sub}</small></div><div style="display:flex">${trayTools()}</div></div>
    <div class="controls">${controls}</div>
    ${desk.classList.contains('wide') && game ? `<div class="mini-card">${scorecardHtml(game)}</div>` : ''}`;
  bindTrayTools();
}

function beginTurn() {
  if (!game || !board || screen !== 'play') return;
  const g = game;
  if (g.holeDone) {
    board.clearTargets();
    renderTray('Hole complete', '', '');
    showHoleCard();
    return;
  }
  const p = currentPlayer(g);
  const name = `<span style="color:${playerInk(p.color)}">${esc(p.name)}</span>`;
  const mulls = `${String(p.mulligans)} mulligan${p.mulligans === 1 ? '' : 's'}`;
  if (!g.dice && autoPuttMove(g)) {
    board.clearTargets();
    renderTray(`${name}: tap-in`, 'Next to the cup: one putt drops it', '');
    void runShot(() => autoPutt(g), TAP_IN_BEAT_MS);
    return;
  }
  if (!g.dice) {
    board.clearTargets();
    renderTray(
      `${name}${g.players.length > 1 ? "'s" : ', your'} shot`,
      `${lieText()}${currentBall(g).strokes === 0 ? ' · tee: 1 free re-roll' : ` · ${mulls}`}`,
      `<div class="die-slot" id="die-slot">?</div>
       <div class="grow"><button class="btn primary" data-act="roll">${icon('dice', 18)} Roll</button></div>`,
    );
    query(tray, '[data-act=roll]').addEventListener('click', () => void doRoll('roll'));
    return;
  }
  const v = g.dice.value;
  const dist = diceDistance(currentHole(g), currentBall(g).pos, v);
  const moves = availableMoves(g);
  const hits = moves.filter((m) => m.kind === 'hit').length;
  let sub: string;
  const longPutt = greenPuttLength(v);
  if (onGreen(currentHole(g), currentBall(g).pos)) {
    sub = longPutt > 1 && moves.some((m) => m.dist === longPutt) ? `On the green: putt ${String(longPutt)} or 1 · tap a spot` : 'On the green: putt 1';
  } else if (dist <= 1) sub = 'Only a putt from here';
  else if (!hits) sub = `No clear line for ${String(dist)} — putt, or use a mulligan`;
  else sub = `Hit ${String(dist)}${dist !== v ? ` (${String(v)}${dist > v ? '+1' : '−1'})` : ''} or putt 1 · tap a spot`;
  renderTray(
    `${name} rolled <span class="hand">${String(v)}</span>`,
    sub,
    `<div class="die-slot ${fx.enabled ? '' : 'fallback'}" id="die-slot">${fx.enabled ? '' : String(v)}</div>
     <div class="grow">
       ${canTeeReroll(g) ? `<button class="btn" data-act="reroll">Re-roll</button>` : ''}
       <button class="btn" data-act="mull" ${canMulligan(g) ? '' : 'disabled'} aria-label="Mulligan, ${String(p.mulligans)} left">Mulligan <span class="count">${String(p.mulligans)}</span></button>
     </div>`,
  );
  tray.querySelector('[data-act=reroll]')?.addEventListener('click', () => void doRoll('reroll'));
  tray.querySelector('[data-act=mull]')?.addEventListener('click', () => void doRoll('mulligan'));
  const c = dieSlotCenter();
  if (c) fx.showDieStatic(v, c, c.size);
  showTargets(moves);
}

function showTargets(moves: MoveOption[]) {
  if (!game || !board) return;
  const g = game;
  board.setTargets(moves, currentBall(g).pos, currentPlayer(g).color, playShot);
}

async function doRoll(kind: 'roll' | 'reroll' | 'mulligan') {
  const g = game;
  if (!g) return;
  const ran = await input.run(async () => {
    const v = d6();
    if (kind === 'roll') roll(g, v);
    else if (kind === 'reroll') teeReroll(g, v);
    else mulligan(g, v);
    saveGame();
    board?.clearTargets();
    tray.querySelectorAll('button').forEach((b) => (b.disabled = true));
    const c = dieSlotCenter();
    if (c) await fx.rollDie(v, c, c.size);
  });
  if (ran) beginTurn();
}

/** Pause before a tap-in plays, so the player sees whose ball it is. */
const TAP_IN_BEAT_MS = 500;

function playShot(m: MoveOption) {
  const g = game;
  if (g) void runShot(() => shoot(g, m.dir, m.dist));
}

/** Play one shot (`play` updates the game) and animate it, holding the input lock throughout. */
async function runShot(play: () => { record: ShotRecord }, beatMs = 0) {
  const g = game;
  const b = board;
  if (!g || !b) return;
  const who = g.current;
  // Targets, rolls, mulligans and tray tools stay locked until the ball has settled and the line is drawn.
  const ran = await input.run(async () => {
    const ball = itemAt(g.balls, who, 'ball');
    const player = itemAt(g.players, who, 'player');
    const k = ball.shots.length;
    b.clearTargets();
    tray.querySelectorAll('button').forEach((el) => (el.disabled = true));
    if (beatMs > 0) await new Promise((r) => window.setTimeout(r, beatMs));
    const { record } = play();
    saveGame();
    void fx.hideDie();
    await animateShot(who, k, record);
    refreshPage();
    if (record.holed) {
      const strokes = ball.strokes;
      const line = `${esc(player.name)} · ${String(strokes)} stroke${strokes > 1 ? 's' : ''}`;
      const name = scoreName(strokes, curPar(g));
      await showBanner(record.auto ? `Tap-in!<small>${name} · ${line}</small>` : `${name}<small>${line}</small>`, 1500);
    } else if (ball.pickedUp) {
      await showBanner(`Picked up<small>${esc(player.name)} · ${String(ball.strokes)}</small>`, 1300);
    }
  });
  if (!ran) return;
  if (!g.holeDone && g.players.length > 1 && g.current !== who) {
    const next = currentPlayer(g);
    const what = autoPuttMove(g) ? 'tap-in' : 'your shot';
    void showBanner(`<span style="color:${playerInk(next.color)}">${esc(next.name)}</span><small>${what}</small>`, 1000);
  }
  beginTurn();
}

async function animateShot(who: number, k: number, s: ShotRecord) {
  if (!game || !board) return;
  const g = game;
  const color = playerInk(itemAt(g.players, who, 'player').color);
  const seed = who * 1000 + k * 17 + 1;
  // Draw everything except this shot, then animate it in.
  const shots = itemAt(g.balls, who, 'ball').shots;
  const hiddenShot = shots.pop();
  board.renderShots(g);
  if (hiddenShot) shots.push(hiddenShot);
  board.renderBalls(g, who);
  const b = board;
  const px = b.cellPx();
  const r = px * 0.27;
  const putt = s.kind === 'putt' || s.dist === 1;
  // Strokes are created up front (their geometry is read once, here) but stay hidden until their step.
  const line = b.liveStroke(wobblyLine(s.from, s.landing, seed), color);
  const circ = !s.holed || s.rolled ? b.liveStroke(sketchCircle(s.landing, 0.27, seed + 9), color) : null;
  const rollLine = s.rolled ? b.liveStroke(wobblyLine(s.landing, s.end, seed + 5), color, true) : null;
  const from = b.toScreen(s.from);
  const landing = b.toScreen(s.landing);
  const end = b.toScreen(s.end);

  // Reduced motion: no flight at all, just the end state (ball on its spot, lines drawn).
  if (fx.reduced) {
    for (const st of [line, circ, rollLine]) st?.set(1);
    fx.hideBall();
    return;
  }

  fx.setBallColor(color);
  const steps: Record<ShotStep, () => Promise<void> | void> = {
    fly: () => fx.flyShot(from, landing, flightLegs(s.dist, px, putt), r),
    line: () => fx.pencilTrace(line.set, line.tip, putt ? 260 : 300 + s.dist * 15),
    circle: () => (circ ? fx.pencilTrace(circ.set, circ.tip, 280) : undefined),
    roll: () => fx.flyBall(landing, end, { radius: r, height: 0, dur: 380 }),
    'roll-line': () => (rollLine ? fx.pencilTrace(rollLine.set, rollLine.tip, 260) : undefined),
    'lift-pencil': () => fx.liftPencil(),
    sink: () => fx.sinkBall(end, r),
    'hide-ball': () => {
      fx.hideBall();
    },
  };
  for (const step of shotSteps(s)) await steps[step]();
  for (const st of [line, circ, rollLine]) st?.set(1);
}

function showHoleCard() {
  if (!game || screen !== 'play') return;
  const g = game;
  const last = g.holeIndex + 1 >= holesInRound(g.golf);
  const card = document.createElement('div');
  card.className = 'hole-card';
  card.innerHTML = `
    <h2>Hole ${String(g.holeIndex + 1)} done</h2>
    <div class="rows">${g.players
      .map((p) => {
        const s = p.scores[g.holeIndex] ?? 0;
        return `<div class="row"><span><b style="color:${playerInk(p.color)}">${esc(p.name)}</b> · ${scoreName(s, curPar(g)).replace('!', '')}</span>
          <span><span class="hand" style="color:${playerInk(p.color)}">${String(s)}</span> <span class="hint">tot ${formatToPar(toPar(p, g.golf))}</span></span></div>`;
      })
      .join('')}</div>
    <div class="actions">
      <button class="btn" data-act="card">Card</button>
      <button class="btn primary" data-act="next">${last ? 'Final card' : 'Next hole →'}</button>
    </div>`;
  page.appendChild(card);
  query(card, '[data-act=card]').addEventListener('click', showScorecard);
  query(card, '[data-act=next]').addEventListener('click', () => {
    if (last) {
      nextHole(g);
      showFinal();
      return;
    }
    card.remove();
    flipPage();
    nextHole(g);
    saveGame();
    refreshPage();
    if (g.players.length > 1) {
      const first = currentPlayer(g);
      void showBanner(`<span style="color:${playerInk(first.color)}">${esc(first.name)}</span><small>has the honour</small>`, 1100);
    } else void showBanner(`Hole ${String(g.holeIndex + 1)}`, 900);
    beginTurn();
  });
}

function flipPage() {
  const leaf = page.cloneNode(true) as HTMLElement;
  leaf.removeAttribute('id');
  leaf.querySelectorAll('[id]').forEach((e) => {
    e.removeAttribute('id');
  });
  leaf.classList.add('leaf');
  leaf.style.height = page.style.height;
  notebook.appendChild(leaf);
  const done = () => {
    leaf.remove();
  };
  // Child animations (target pops) bubble animationend too; only the leaf's own flip counts.
  leaf.addEventListener('animationend', (e) => {
    if (e.target === leaf) done();
  });
  window.setTimeout(done, 1500);
}

// ------------------------------------------------------------------ keyboard

window.addEventListener('keydown', (e) => {
  if (screen !== 'play' || input.busy || !game || (e.target instanceof HTMLElement && e.target.tagName === 'INPUT')) return;
  if ((e.key === 'r' || e.key === ' ') && !game.dice && !game.holeDone && !autoPuttMove(game)) {
    e.preventDefault();
    void doRoll('roll');
  }
});

// ------------------------------------------------------------------ boot

tray.hidden = true;
showPalette(palette.value);
layout();
renderCover();
// Debug/screenshot hook: ?play=<course>&players=<n>&hole=<n>[&golf=proper] jumps straight into a round. A legacy
// `mode` param is ignored.
{
  if (linkParams.has('play')) {
    const link = parseDeepLink(linkParams);
    game = newGame(link.course, prefs.names.slice(0, link.players), deepLinkGolf(linkParams));
    linkRound = game;
    skipToHole(game, link.holeIndex);
    cover.style.transition = 'none';
    openCover();
    showPlay();
    requestAnimationFrame(() => (cover.style.transition = ''));
  }
}
// The desk stays hidden until the first screen is built (index.html), so no unlaid-out cover or header ever paints.
document.documentElement.classList.remove('boot');
