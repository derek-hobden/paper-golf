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
  autoHole,
  autoHoleMove,
  autoPutt,
  autoPuttMove,
  availableMoves,
  cardTotals,
  canMulligan,
  canTeeReroll,
  currentBall,
  currentHole,
  currentPlayer,
  HOLES_IN_ROUND,
  ROUND_PAR,
  formatToPar,
  holePar,
  holeWind,
  loadState,
  mulligan,
  newGame,
  nextHole,
  parseDeepLink,
  roll,
  scoreName,
  shoot,
  skipToHole,
  teeReroll,
  toPar,
  totalStrokes,
  type GameState,
  type MoveOption,
  type ShotRecord,
} from './game/game';
import { courseBest, parseBests, recordBest } from './game/bests';
import { forgetLegacyPalette, playerInk } from './game/ink';
import { Board } from './ui/board';
import { icon, rulesHtml, windHtml } from './ui/content';
import { byId, query } from './ui/dom';
import { InputLock, flightLegs, shotSteps, windControl, type ShotStep } from './ui/flight';
import { Fx } from './ui/fx';
import { rollDots, rollLine as rollPath, sketchCircle, windCurve, wobblyLine } from './ui/sketch';

// ------------------------------------------------------------------ storage

const KEY_GAME = 'paper-golf:game:v1';
const KEY_PREFS = 'paper-golf:prefs:v1';
const KEY_BEST = 'paper-golf:best:v1';

interface Prefs {
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

/** Saved prefs, keeping only well-typed fields (older prefs also stored the game mode and the 12/18-hole choice; both are dropped). */
function parsePrefs(v: unknown): Partial<Prefs> {
  const out: Partial<Prefs> = {};
  if (typeof v !== 'object' || v === null) return out;
  if ('course' in v && typeof v.course === 'number') out.course = v.course;
  if ('count' in v && typeof v.count === 'number') out.count = v.count;
  if ('names' in v && Array.isArray(v.names) && v.names.every((n: unknown): n is string => typeof n === 'string')) {
    out.names = v.names;
  }
  return out;
}

const prefs: Prefs = {
  course: 0,
  names: ['Player 1', 'Player 2', 'Player 3', 'Player 4'],
  count: 1,
  ...parsePrefs(readJson(KEY_PREFS)),
};

const linkParams = new URLSearchParams(location.search);

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

// Course bests (`src/game/bests.ts`): Proper golf `proper:<course>`; old 12-hole entries stay stored but unshown.
const best = parseBests(readJson(KEY_BEST));
const curPar = (g: GameState) => holePar(g.holeIndex);
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
  const raw = readJson(KEY_GAME);
  const saved = loadState(raw);
  if (saved && !saved.finished) game = saved;
  // A save that can't be played on (an old 12-hole par-6 round, or junk) is discarded: the next round starts fresh.
  else if (raw !== null && !saved) writeJson(KEY_GAME, null);
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

/** A fresh round's wind seed. Math.random, not crypto: the e2e die rig answers one-number crypto reads with dice. */
const windSeed = () => Math.floor(Math.random() * 2 ** 32);

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

const LINE_H = 34; // the score line under the board on one row: the least it is budgeted (hidden when short)

/** The score line's real height with its margin: on a small board its text wraps to a second row. */
function lineHeight(): number {
  const line = screen === 'play' ? page.querySelector<HTMLElement>('.scoreline') : null;
  return line ? Math.max(LINE_H, line.offsetHeight + 2) : LINE_H;
}

/** One row when it fits the board's width, else two ("Hole 1 · Par 4" over "Strokes 0/4 · Total 0"). */
function fitLine() {
  const line = screen === 'play' ? page.querySelector<HTMLElement>('.scoreline') : null;
  if (!line) return;
  // Sum the parts' own widths (they never wrap): a centred flex row's scrollWidth misses its overflow on the left.
  const width = (els: Iterable<Element>) => [...els].reduce((w, el) => w + el.getBoundingClientRect().width, 0);
  line.classList.remove('two-rows'); // measure as one row, with the separator between the halves
  if (width(line.children) > line.clientWidth - 4) line.classList.add('two-rows'); // less its 2px side padding
}

/**
 * A ResizeObserver callback that runs `work` on the next frame, never inside the callback itself, and only when an
 * observed box really changed size. Re-fitting inside the callback resizes the observed boxes again, which WebKit
 * reports as "ResizeObserver loop completed with undelivered notifications" (a page error on iPhone Safari).
 */
function deferredObserver(work: () => void): ResizeObserver {
  const seen = new WeakMap<Element, string>();
  let frame = 0;
  return new ResizeObserver((entries) => {
    let changed = false;
    for (const e of entries) {
      const size = `${String(e.contentRect.width)}x${String(e.contentRect.height)}`;
      if (seen.get(e.target) !== size) changed = true;
      seen.set(e.target, size);
    }
    if (!changed) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(work);
  });
}

/** Re-pick the score line's rows when it or its text changes width (a re-fit board, new scores, late web fonts). */
const lineObserver = deferredObserver(fitLine);

/** The score line is hidden on a phone on its side and on a short portrait screen (style.css `short`, `compact`). */
const noLine = () => desk.classList.contains('short') || desk.classList.contains('compact');

/** The HUD and score line heights the last layout() fitted the board to. */
let fittedHudH = HUD_H;
let fittedLineH = LINE_H;
/**
 * Re-fit when the HUD or the score line grows after layout: chips or scores change, or the web fonts load and widen
 * them. Only growth, so it can't loop.
 */
const hudObserver = deferredObserver(() => {
  if (hudHeight() > fittedHudH || (!noLine() && lineHeight() > fittedLineH)) layout();
});

/** The tray height (with the desk gap) the last layout() budgeted for. */
let fittedTrayH = 0;
/**
 * Re-fit when the tray grows past its budget: its status wraps to more lines on a narrow phone, and the Roll row
 * must stay above Safari's bottom toolbar. Only growth, so it can't loop (and the board doesn't jump every turn).
 */
const trayObserver = deferredObserver(() => {
  if (!desk.classList.contains('wide') && !tray.hidden && tray.offsetHeight + DESK_GAP > fittedTrayH) layout();
});
trayObserver.observe(tray);

/** The desk's vertical padding, safe-area insets included (style.css `#desk`). */
function deskPadding(): number {
  const cs = getComputedStyle(desk);
  return (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
}

function layout() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Short landscape (phones on their side): side-by-side too, with tight padding and the board sized to the height.
  const short = vh < 500 && vw / vh > 1.2;
  const wide = short || (vw >= 820 && vw / vh > 1.2);
  desk.classList.toggle('wide', wide);
  desk.classList.toggle('short', short);
  // A short portrait screen (an iPhone SE with Safari's toolbars showing) drops the score line, like `short`.
  desk.classList.toggle('compact', !wide && vh < 600);
  const pad = vw < 380 || short ? 10 : 14;
  document.documentElement.style.setProperty('--pad', `${String(pad)}px`);
  // Padding (with the safe-area insets) plus a little slack for the page's stacked-leaf edge.
  const deskPad = deskPadding() + (short ? 4 : 16);
  const trayH = wide || tray.hidden ? 0 : tray.offsetHeight + DESK_GAP;
  fittedTrayH = trayH;
  const availW = (wide ? vw - (short ? 270 + 20 : 300 + 36) - 40 : vw - 28) - pad * 2;
  // A narrower board can wrap the chips onto another row, so re-measure the HUD until it stops growing. Start from
  // one row (not the HUD as it is now): a HUD wrapped by an earlier, narrower fit would otherwise keep the board small.
  let hudH = HUD_H;
  let lineH = noLine() ? 0 : LINE_H;
  let chrome = 0;
  let bw = 0;
  for (let pass = 0; pass < 3; pass++) {
    chrome = 26 + hudH + lineH + 10; // page top padding, HUD, score line (hidden when short), bottom padding
    const availH = vh - deskPad - chrome - trayH;
    // Never so wide that the tray (the Roll button) is pushed under a short phone's bottom toolbar.
    bw = Math.max(100, Math.floor(Math.min(availW, (availH * 13) / 20, 600)));
    document.documentElement.style.setProperty('--board-w', `${String(bw)}px`);
    const measured = hudHeight();
    if (!noLine()) fitLine();
    const measuredLine = noLine() ? 0 : lineHeight();
    if (measured <= hudH && measuredLine <= lineH) break;
    hudH = Math.max(hudH, measured);
    lineH = Math.max(lineH, measuredLine);
  }
  fittedHudH = hudH;
  fittedLineH = lineH;
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
    <div class="foot">90 holes · 5 courses · 18 holes, par 72 · 1–4 players</div>`;
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

function bestHtml(course: number): string {
  const b = courseBest(best, course);
  return b !== undefined ? `<div class="best">best ${formatToPar(b - ROUND_PAR)}</div>` : '';
}

function showSetup() {
  screen = 'setup';
  tray.hidden = true;
  layout();
  const s = { ...prefs, names: [...prefs.names] };
  const draw = () => {
    page.innerHTML = `
      <div class="sheet">
        <h2>New round</h2>
        <p class="hint round-info">18 holes of par 3, 4 and 5 · par 72</p>
        <h3>Course</h3>
        <div class="courses">
          ${COURSES.map(
            (c, i) => `
            <button class="opt ${s.course === i ? 'sel' : ''}" data-course="${String(i)}">
              <span class="num">${String(i + 1)}</span>
              <span><b>${c.name}</b>${c.blurb}</span>
              <span style="text-align:right">
                <span class="diff">${[0, 1, 2, 3, 4].map((k) => `<i class="${k <= Math.round(c.difficulty * 4) ? 'on' : ''}"></i>`).join('')}</span>
                ${bestHtml(i)}
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
    query(page, '[data-act=back]').addEventListener('click', closeCover);
    query(page, '[data-act=go]').addEventListener('click', () => {
      Object.assign(prefs, s);
      writeJson(KEY_PREFS, prefs);
      game = newGame(s.course, s.names.slice(0, s.count), windSeed());
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
  page.innerHTML = `<div class="sheet">${rulesHtml()}<div class="actions"><button class="btn primary" data-act="back">${
    back === 'play' ? 'Back to the hole' : 'Got it'
  }</button></div></div>`;
  query(page, '[data-act=back]').addEventListener('click', () => {
    if (back === 'play') showPlay();
    else closeCover();
  });
}

/** One total row of the card (Out, In or Total): its par, then each player's strokes and score to par so far. */
function totalRow(g: GameState, k: number, cls: string): string {
  const totals = g.players.map((p) => itemAt(cardTotals(p), k, 'card total'));
  const first = itemAt(totals, 0, 'card total');
  const cells = totals
    .map((t) => `<td>${t.played ? `${String(t.strokes)} <span class="hint">(${formatToPar(t.toPar)})</span>` : ''}</td>`)
    .join('');
  return `<tr class="${cls}" data-total="${first.label}"><td>${first.label} <span class="hint">/${String(first.par)}</span></td>${cells}</tr>`;
}

function scorecardHtml(g: GameState): string {
  const head = g.players.map((p) => `<th style="color:${playerInk(p.color)}">${esc(p.name)}</th>`).join('');
  // Out after hole 9 and In after hole 18 (cardTotals: Out, In, Total).
  const rows = Array.from({ length: HOLES_IN_ROUND }, (_, h) => {
    const par = holePar(h);
    const cells = g.players
      .map((p) => {
        const s = p.scores[h] ?? null;
        if (s === null) return '<td></td>';
        const cls = s < par ? 'hand under circled' : 'hand';
        return `<td class="${cls}" style="color:${s < par ? '' : playerInk(p.color)}">${String(s)}</td>`;
      })
      .join('');
    const row = `<tr class="${h === g.holeIndex && !g.finished ? 'cur' : ''}"><td>Hole ${String(h + 1)} <span class="hint">/${String(par)}</span></td>${cells}</tr>`;
    const sub = h === 8 ? totalRow(g, 0, 'sub') : h === 17 ? totalRow(g, 1, 'sub') : '';
    return row + sub;
  }).join('');
  const mulls = `<tr><td>Mulligans</td>${g.players.map((p) => `<td class="hint">${String(p.mulligans)} left</td>`).join('')}</tr>`;
  return `<table class="card-table long"><thead><tr><th>${esc(courseOf(g).name)}</th>${head}</tr></thead><tbody>${rows}</tbody><tfoot>${totalRow(g, 2, '')}${mulls}</tfoot></table>`;
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
  if (recordBest(best, g.course, totalStrokes(winner))) writeJson(KEY_BEST, best);
  if (g !== linkRound) writeJson(KEY_GAME, null);
  const title =
    g.players.length === 1
      ? `${formatToPar(toPar(winner))} on ${courseOf(g).name}`
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
    game = newGame((g.course + 1) % COURSES.length, g.players.map((p) => p.name), windSeed());
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
  hudObserver.observe(byId('scoreline'));
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
    <div class="title"><b><span class="hole-no">Hole ${String(g.holeIndex + 1)}</span><span class="hint"> of ${String(HOLES_IN_ROUND)}</span><span class="par-sep"> · </span><span class="par">Par ${String(curPar(g))}</span></b><span class="meta"><span class="course">${esc(courseOf(g).name)}</span>${windHtml(holeWind(g))}</span></div>
    <div class="chips">${g.players
      .map((pl, i) => {
        const b = itemAt(g.balls, i, 'ball');
        const done = b.holed || b.pickedUp;
        return `<span class="chip ${i === g.current && !g.holeDone ? 'on' : ''} ${done ? 'done' : ''}" style="color:${playerInk(pl.color)}">
          <i style="background:${playerInk(pl.color)}"></i><span style="color:var(--ink)">${esc(pl.name)}</span>
          <span class="hand">${String(b.strokes)}</span></span>`;
      })
      .join('')}</div>`;
  const ink = `class="hand" style="color:${playerInk(p.color)}"`;
  // One spaced line: "Hole 1 · Par 4 · Strokes 0/4 · Total 0". Total is the round's strokes so far, this hole's
  // included, then the score to par over the finished holes.
  const played = p.scores.some((s) => s !== null);
  const roundStrokes = totalStrokes(p) + ((p.scores[g.holeIndex] ?? null) === null ? ball.strokes : 0);
  const sep = (cls: string) => `<span class="sep ${cls}"> · </span>`;
  byId('scoreline').innerHTML =
    `<span class="half"><span>Hole ${String(g.holeIndex + 1)}</span>${sep('in')}<span>Par ${String(curPar(g))}</span></span>${sep('mid')}` +
    `<span class="half"><span>Strokes <span ${ink}>${String(ball.strokes)}</span>/${String(curPar(g))}</span>${sep('in')}` +
    `<span>Total <span ${ink}>${String(roundStrokes)}</span>${played ? ` <span class="hint">(${formatToPar(toPar(p))})</span>` : ''}</span></span>`;
  lineObserver.disconnect();
  lineObserver.observe(byId('scoreline'));
  for (const half of byId('scoreline').querySelectorAll('.half')) lineObserver.observe(half);
  fitLine();
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
  if (autoHoleMove(g)) {
    board.clearTargets();
    renderTray(`${name} rolled <span class="hand">${String(v)}</span>`, 'It can drop: straight for the cup', dieSlotHtml(v));
    const c = dieSlotCenter();
    if (c) fx.showDieStatic(v, c, c.size);
    void runShot(() => autoHole(g), TAP_IN_BEAT_MS);
    return;
  }
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
    `${dieSlotHtml(v)}
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

/** The die slot in the tray: fx draws the die over it, or it shows the number when effects are off. */
const dieSlotHtml = (v: number) => `<div class="die-slot ${fx.enabled ? '' : 'fallback'}" id="die-slot">${fx.enabled ? '' : String(v)}</div>`;

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

/** Pause before a tap-in or an automatic hole-out plays, so the player sees whose ball it is and the roll. */
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
  // A shot the wind blew is one curve onto where it stopped (as on the board); any other flies straight and rolls.
  const blown = s.blown === true;
  const line = b.liveStroke(blown ? windCurve(s.from, s.landing, s.end, seed) : wobblyLine(s.from, s.landing, seed), color);
  const circ = blown
    ? s.holed
      ? null
      : b.liveStroke(sketchCircle(s.end, 0.27, seed + 9), color)
    : !s.holed || s.rolled
      ? b.liveStroke(sketchCircle(s.landing, 0.27, seed + 9), color)
      : null;
  const rollLine = s.rolled && !blown ? b.liveStroke(rollPath(rollDots(s), seed + 5), color, true) : null;
  // A chain of slopes rolls dot by dot.
  const rollStops = rollDots(s).map((p) => b.toScreen(p));
  const from = b.toScreen(s.from);
  const landing = b.toScreen(s.landing);
  const end = b.toScreen(s.end);
  const bend = blown ? b.toScreen(windControl(s.from, s.landing)) : undefined;

  // Reduced motion: no flight at all, just the end state (ball on its spot, lines drawn).
  if (fx.reduced) {
    for (const st of [line, circ, rollLine]) st?.set(1);
    fx.hideBall();
    return;
  }

  fx.setBallColor(color);
  const steps: Record<ShotStep, () => Promise<void> | void> = {
    fly: () => (bend ? fx.flyShot(from, end, flightLegs(s.dist, px, putt), r, bend) : fx.flyShot(from, landing, flightLegs(s.dist, px, putt), r)),
    line: () => fx.pencilTrace(line.set, line.tip, putt ? 260 : 300 + s.dist * 15),
    circle: () => (circ ? fx.pencilTrace(circ.set, circ.tip, 280) : undefined),
    roll: async () => {
      for (let i = 1; i < rollStops.length; i++)
        await fx.flyBall(itemAt(rollStops, i - 1, 'roll stop'), itemAt(rollStops, i, 'roll stop'), { radius: r, height: 0, dur: 380 });
    },
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
  const last = g.holeIndex + 1 >= HOLES_IN_ROUND;
  const card = document.createElement('div');
  card.className = 'hole-card';
  card.innerHTML = `
    <h2>Hole ${String(g.holeIndex + 1)} done</h2>
    <div class="rows">${g.players
      .map((p) => {
        const s = p.scores[g.holeIndex] ?? 0;
        return `<div class="row"><span><b style="color:${playerInk(p.color)}">${esc(p.name)}</b> · ${scoreName(s, curPar(g)).replace('!', '')}</span>
          <span><span class="hand" style="color:${playerInk(p.color)}">${String(s)}</span> <span class="hint">tot ${formatToPar(toPar(p))}</span></span></div>`;
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
forgetLegacyPalette(storage());
layout();
renderCover();
// Debug/screenshot hook: ?play=<course>&players=<n>&hole=<n> jumps straight into a round. Legacy `golf` and `mode`
// params are ignored.
{
  if (linkParams.has('play')) {
    const link = parseDeepLink(linkParams);
    // The default wind seed: a deep link always plays the same winds, so screenshots and tests reproduce.
    game = newGame(link.course, prefs.names.slice(0, link.players));
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
