import '@fontsource/caveat/latin-700.css';
import '@fontsource/space-mono/latin-400.css';
import '@fontsource/space-mono/latin-700.css';
import '@fontsource/space-mono/latin-700-italic.css';
import './style.css';

import { boot, restoreRound } from './boot';
import type { Hole } from './engine/types';
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
  builtHole,
  currentHole,
  currentPlayer,
  HOLES_IN_ROUND,
  ROUND_PAR,
  formatToPar,
  holePar,
  holeWind,
  holesInRound,
  isPersisted,
  newBuiltRound,
  recordsCourseBest,
  mulligan,
  newGame,
  nextHole,
  teeOrder,
  turnReason,
  type TurnReason,
  roll,
  scoreName,
  shoot,
  teeReroll,
  toPar,
  totalStrokes,
  type GameState,
  type MoveOption,
  type PersistedGame,
  type ShotRecord,
} from './game/game';
import { courseBest, parseBests, recordBest } from './game/bests';
import { playerInk } from './game/ink';
import { clearHoleLink, mountBuilder } from './ui/builder';
import { Board } from './ui/board';
import { icon, rulesHtml, windHtml } from './ui/content';
import { byId, query } from './ui/dom';
import { InputLock, flightLegs, shotSteps, windControl, type ShotStep } from './ui/flight';
import { Fx } from './ui/fx';
import { createLayout } from './ui/layout';
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

// Course bests (`src/game/bests.ts`): Proper golf `proper:<course>`; old 12-hole entries stay stored but unshown.
const best = parseBests(readJson(KEY_BEST));
const curPar = (g: GameState) => currentHole(g).par;
const courseName = (g: GameState) => (builtHole(g) ? 'Your hole' : itemAt(COURSES, g.course, 'course').name);

/** `count` names, padded, clamped to 1–4. A built hole tees off with whoever was set up. */
function playerNames(count: number, names: readonly string[]): string[] {
  const n = Math.min(4, Math.max(1, Math.trunc(count)));
  return Array.from({ length: n }, (_, i) => names[i] ?? `Player ${String(i + 1)}`);
}

// ------------------------------------------------------------------ elements

const desk = byId('desk');
const notebook = byId('notebook');
const page = byId('page');
const cover = byId('cover');
const tray = byId('tray');
const spiral = byId('spiral');
const banner = byId('banner');
const fx = new Fx(byId('fx'));

let game: GameState | null = restoreRound(readJson(KEY_GAME), () => {
  writeJson(KEY_GAME, null);
});

type Screen = 'cover' | 'setup' | 'play' | 'rules' | 'card' | 'build';
let screen: Screen = 'cover';
const input = new InputLock();
let board: Board | null = null;
let shownHole = -1;

/**
 * Save a round, or clear the save once it is finished. Only a saved round (`newGame`, `loadState`) type-checks: a
 * ?play= deep-link round (`newLinkGame`) never is one, so it can't overwrite (or clear) the player's real round.
 */
const saveGame = (g: PersistedGame) => {
  writeJson(KEY_GAME, g.finished ? null : g);
};

/** Save the round in play, unless it is a ?play= deep-link round. */
const saveRound = () => {
  if (game && isPersisted(game)) saveGame(game);
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);

/** Why it's this player's turn, by golf etiquette (multiplayer only). */
const WHY: Record<TurnReason, string> = { honour: 'honour', tee: 'on the tee', away: 'away' };

/** "Player 2 · away" in the player's ink: who is up and why. Just the name in solo play. */
function whoHtml(g: GameState): string {
  const p = currentPlayer(g);
  const why = turnReason(g);
  return `<span style="color:${playerInk(p.color)}">${esc(p.name)}</span>${why ? `<span class="why"> · ${WHY[why]}</span>` : ''}`;
}

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

const { layout, fitLine } = createLayout({
  desk,
  notebook,
  page,
  spiral,
  playing: () => screen === 'play',
  fitted: () => {
    if (screen === 'play') placeDie();
    board?.fitWind();
  },
});

window.addEventListener('resize', () => {
  layout();
  fx.resize();
  placeDie();
  board?.fitHits();
  board?.fitWind();
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
  // A built hole is not a saved round. Leaving it brings back the round that was saved before, if there is one.
  if (game && !isPersisted(game)) {
    game = restoreRound(readJson(KEY_GAME), () => {
      writeJson(KEY_GAME, null);
    });
  }
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
        <button class="btn" data-act="build">Build a hole</button>
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
    query(page, '[data-act=build]').addEventListener('click', () => {
      showBuilder(null, false, playerNames(s.count, s.names));
    });
    query(page, '[data-act=go]').addEventListener('click', () => {
      Object.assign(prefs, s);
      writeJson(KEY_PREFS, prefs);
      const round = newGame(s.course, s.names.slice(0, s.count), windSeed());
      game = round;
      saveGame(round);
      shownHole = -1;
      showPlay();
    });
  };
  draw();
}

/** The builder: draw one hole, then play it. `broken` is a `#h=` link that did not decode. */
function showBuilder(shared: Hole | null, broken: boolean, names: readonly string[]) {
  screen = 'build';
  tray.hidden = false;
  mountBuilder({
    page,
    tray,
    names,
    shared,
    broken,
    layout,
    onBack: () => {
      clearHoleLink();
      showSetup();
    },
    onPlay: (hole) => {
      clearHoleLink();
      game = newBuiltRound(hole, names, windSeed());
      shownHole = -1;
      showPlay();
    },
  });
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

/** One hole, the par the player picked. A built round is not an 18-hole card. */
function builtScorecard(g: GameState): string {
  const par = currentHole(g).par;
  const head = g.players.map((p) => `<th style="color:${playerInk(p.color)}">${esc(p.name)}</th>`).join('');
  const cells = g.players
    .map((p) => {
      const s = p.scores[0] ?? null;
      if (s === null) return '<td></td>';
      return `<td class="hand" style="color:${playerInk(p.color)}">${String(s)}</td>`;
    })
    .join('');
  const total = g.players
    .map((p) => {
      const s = p.scores[0] ?? null;
      if (s === null) return '<td></td>';
      return `<td>${String(s)} <span class="hint">(${formatToPar(s - par)})</span></td>`;
    })
    .join('');
  return `<table class="card-table"><thead><tr><th>Your hole</th>${head}</tr></thead><tbody><tr><td>Hole 1 <span class="hint">/${String(par)}</span></td>${cells}</tr></tbody><tfoot><tr><td>Total <span class="hint">/${String(par)}</span></td>${total}</tr></tfoot></table>`;
}

function scorecardHtml(g: GameState): string {
  if (builtHole(g)) return builtScorecard(g);
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
  return `<table class="card-table long"><thead><tr><th>${esc(courseName(g))}</th>${head}</tr></thead><tbody>${rows}</tbody><tfoot>${totalRow(g, 2, '')}${mulls}</tfoot></table>`;
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
  // A built hole is not a course best. Every other finished round is.
  if (recordsCourseBest(g) && recordBest(best, g.course, totalStrokes(winner))) writeJson(KEY_BEST, best);
  if (isPersisted(g)) saveGame(g);
  const title =
    g.players.length === 1
      ? `${formatToPar(toPar(winner, g))} on ${courseName(g)}`
      : tie
        ? "It's a tie!"
        : `${esc(winner.name)} wins!`;
  page.innerHTML = `<div class="sheet">
      <h2 class="hand" style="font-size:38px;margin:0 0 6px">${title}</h2>
      ${scorecardHtml(g)}
      <div class="actions">
        <button class="btn" data-act="home">Home</button>
        ${
          builtHole(g)
            ? '<button class="btn primary" data-act="build">Build another</button>'
            : '<button class="btn primary" data-act="again">Next course →</button>'
        }
      </div></div>`;
  query(page, '[data-act=home]').addEventListener('click', () => {
    if (isPersisted(g)) game = null;
    closeCover();
  });
  page.querySelector('[data-act=build]')?.addEventListener('click', () => {
    showBuilder(null, false, g.players.map((p) => p.name));
  });
  page.querySelector('[data-act=again]')?.addEventListener('click', () => {
    const round = newGame((g.course + 1) % COURSES.length, g.players.map((p) => p.name), windSeed());
    game = round;
    saveGame(round);
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
    board.setWind(holeWind(g), fx.reduced);
    shownHole = g.holeIndex;
  }
  board.renderShots(g);
  board.renderBalls(g);
  const p = currentPlayer(g);
  const ball = currentBall(g);
  byId('hud').innerHTML = `
    <div class="title"><b><span class="hole-no">Hole ${String(g.holeIndex + 1)}</span><span class="hint"> of ${String(holesInRound(g))}</span><span class="par-sep"> · </span><span class="par">Par ${String(curPar(g))}</span></b><span class="meta"><span class="course">${esc(courseName(g))}</span>${windHtml(holeWind(g))}</span></div>
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
    `<span>Total <span ${ink}>${String(roundStrokes)}</span>${played ? ` <span class="hint">(${formatToPar(toPar(p, g))})</span>` : ''}</span></span>`;
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
      g.players.length > 1 ? whoHtml(g) : `${name}, your shot`,
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
    saveRound();
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
    saveRound();
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
  // Every shot re-decides who plays (the ball furthest away), so the banner says who and why, even the same player again.
  if (!g.holeDone && g.players.length > 1) {
    void showBanner(`${whoHtml(g)}${autoPuttMove(g) ? '<small>tap-in</small>' : ''}`, 1000);
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
  const line = b.liveStroke(blown ? windCurve(s.from, s.landing, s.end, seed, b.size()) : wobblyLine(s.from, s.landing, seed), color);
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
  const bend = blown ? b.toScreen(windControl(s.from, s.landing, b.size())) : undefined;

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

const teeName = (g: GameState, i: number) => {
  const p = itemAt(g.players, i, 'player');
  return `<b style="color:${playerInk(p.color)}">${esc(p.name)}</b>`;
};

function showHoleCard() {
  if (!game || screen !== 'play') return;
  const g = game;
  const last = g.holeIndex + 1 >= holesInRound(g);
  const card = document.createElement('div');
  card.className = 'hole-card';
  card.innerHTML = `
    <h2>Hole ${String(g.holeIndex + 1)} done</h2>
    <div class="rows">${g.players
      .map((p) => {
        const s = p.scores[g.holeIndex] ?? 0;
        return `<div class="row"><span><b style="color:${playerInk(p.color)}">${esc(p.name)}</b> · ${scoreName(s, curPar(g)).replace('!', '')}</span>
          <span><span class="hand" style="color:${playerInk(p.color)}">${String(s)}</span> <span class="hint">tot ${formatToPar(toPar(p, g))}</span></span></div>`;
      })
      .join('')}</div>
    ${!last && g.players.length > 1 ? `<div class="tee-order">Next tee: ${teeOrder(g, g.holeIndex + 1).map((i) => teeName(g, i)).join(' · ')}</div>` : ''}
    <div class="actions">
      <button class="btn" data-act="card">Card</button>
      <button class="btn primary" data-act="next">${last ? 'Final card' : 'Next hole →'}</button>
    </div>`;
  // The holder covers the page, so the card sizes itself to the page (style.css .hole-card-holder).
  const holder = document.createElement('div');
  holder.className = 'hole-card-holder';
  holder.appendChild(card);
  page.appendChild(holder);
  query(card, '[data-act=card]').addEventListener('click', showScorecard);
  query(card, '[data-act=next]').addEventListener('click', () => {
    if (last) {
      nextHole(g);
      showFinal();
      return;
    }
    holder.remove();
    flipPage();
    nextHole(g);
    saveRound();
    refreshPage();
    if (g.players.length > 1) {
      void showBanner(whoHtml(g), 1100);
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

boot({
  tray,
  cover,
  names: prefs.names,
  layout,
  renderCover,
  openCover,
  play: (round) => {
    game = round;
    showPlay();
  },
  build: (hole) => {
    showBuilder(hole, hole === null, playerNames(prefs.count, prefs.names));
  },
});
