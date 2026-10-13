import '@fontsource/caveat/latin-700.css';
import '@fontsource/space-mono/latin-400.css';
import '@fontsource/space-mono/latin-700.css';
import '@fontsource/space-mono/latin-700-italic.css';
import './style.css';

import { COURSES, HOLES_PER_COURSE } from './engine/generator';
import { PAR, cellAt, diceDistance } from './engine/rules';
import {
  PLAYER_COLORS,
  availableMoves,
  canMulligan,
  canTeeReroll,
  currentBall,
  currentHole,
  formatToPar,
  loadState,
  mulligan,
  newGame,
  nextHole,
  roll,
  scoreName,
  shoot,
  teeReroll,
  toPar,
  totalStrokes,
  type GameState,
  type MoveOption,
  type ShotRecord,
} from './game/game';
import { Board } from './ui/board';
import { icon, rulesHtml } from './ui/content';
import { InputLock, flightLegs, shotSteps, type ShotStep } from './ui/flight';
import { Fx } from './ui/fx';
import { sketchCircle, wobblyLine } from './ui/sketch';

// ------------------------------------------------------------------ storage

const KEY_GAME = 'paper-golf:game:v1';
const KEY_PREFS = 'paper-golf:prefs:v1';
const KEY_BEST = 'paper-golf:best:v1';

interface Prefs {
  course: number;
  names: string[];
  count: number;
}

function readJson<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
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

// Older prefs also stored the game mode; drop it.
const { mode: _mode, ...savedPrefs } = readJson<Partial<Prefs> & { mode?: unknown }>(KEY_PREFS) ?? {};
const prefs: Prefs = {
  course: 0,
  names: ['Player 1', 'Player 2', 'Player 3', 'Player 4'],
  count: 1,
  ...savedPrefs,
};

// Course bests, keyed `dice:<course>` (the prefix predates dice-only play; old `speed:` entries are ignored).
const best: Record<string, number> = readJson(KEY_BEST) ?? {};
const bestKey = (course: number) => `dice:${course}`;

// ------------------------------------------------------------------ elements

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const desk = $('desk');
const notebook = $('notebook');
const page = $('page');
const cover = $('cover');
const tray = $('tray');
const spiral = $('spiral');
const banner = $('banner');
const fx = new Fx($('fx'));

let game: GameState | null = null;
{
  const saved = loadState(readJson<unknown>(KEY_GAME));
  if (saved && !saved.finished) game = saved;
}

type Screen = 'cover' | 'setup' | 'play' | 'rules' | 'card';
let screen: Screen = 'cover';
const input = new InputLock();
let board: Board | null = null;
let shownHole = -1;

const saveGame = () => writeJson(KEY_GAME, game && !game.finished ? game : null);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function d6(): number {
  try {
    return (crypto.getRandomValues(new Uint32Array(1))[0] % 6) + 1;
  } catch {
    return 1 + Math.floor(Math.random() * 6);
  }
}

// ------------------------------------------------------------------ layout

const TRAY_H = 128;

function layout() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const wide = vw >= 820 && vw / vh > 1.2;
  desk.classList.toggle('wide', wide);
  const pad = vw < 380 ? 10 : 14;
  document.documentElement.style.setProperty('--pad', `${pad}px`);
  const chrome = 26 + 48 + 34 + 10; // page top padding, HUD, score line, bottom padding
  const deskPad = 22 + 8 + 16;
  const trayH = wide || tray.hidden ? 0 : TRAY_H;
  const availH = vh - deskPad - chrome - trayH;
  const availW = (wide ? vw - 300 - 36 - 40 : vw - 28) - pad * 2;
  const bw = Math.max(200, Math.floor(Math.min(availW, (availH * 13) / 20, 600)));
  document.documentElement.style.setProperty('--board-w', `${bw}px`);
  const pageH = Math.round((bw * 20) / 13 + chrome);
  document.documentElement.style.setProperty('--page-h', `${pageH - 36}px`);
  page.style.height = `${pageH}px`;
  const coils = Math.max(8, Math.floor((bw + pad * 2 - 28) / 25));
  if (spiral.childElementCount !== coils) spiral.innerHTML = '<span class="coil"></span>'.repeat(coils);
  if (screen === 'play') placeDie();
}

window.addEventListener('resize', () => {
  layout();
  fx.resize();
  placeDie();
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
  const canContinue = !!game && !game.finished;
  cover.innerHTML = `
    <span class="brand">pad &amp; pencil</span>
    <div class="apps">Paper Games™</div>
    <h1>GOLF</h1>
    <div class="menu">
      ${canContinue ? `<button class="btn dark" data-act="continue">Continue · Hole ${game!.holeIndex + 1}</button>` : ''}
      <button class="btn ${canContinue ? '' : 'dark'}" data-act="new">New round</button>
      <button class="btn" data-act="rules">How to play</button>
    </div>
    <div class="foot">60 holes · 5 courses · Dice Golf · 1–4 players</div>`;
  cover.querySelector('[data-act=continue]')?.addEventListener('click', () => {
    openCover();
    showPlay();
  });
  cover.querySelector('[data-act=new]')!.addEventListener('click', () => {
    openCover();
    showSetup();
  });
  cover.querySelector('[data-act=rules]')!.addEventListener('click', () => {
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

function showSetup() {
  screen = 'setup';
  tray.hidden = true;
  layout();
  const s = { ...prefs, names: [...prefs.names] };
  const draw = () => {
    page.innerHTML = `
      <div class="sheet">
        <h2>New round</h2>
        <h3>Course</h3>
        <div class="courses">
          ${COURSES.map(
            (c, i) => `
            <button class="opt ${s.course === i ? 'sel' : ''}" data-course="${i}">
              <span class="num">${i + 1}</span>
              <span><b>${c.name}</b>${c.blurb}</span>
              <span style="text-align:right">
                <span class="diff">${[0, 1, 2, 3, 4].map((k) => `<i class="${k <= Math.round(c.difficulty * 4) ? 'on' : ''}"></i>`).join('')}</span>
                ${best[bestKey(i)] !== undefined ? `<div class="best">best ${formatToPar(best[bestKey(i)] - PAR * HOLES_PER_COURSE)}</div>` : ''}
              </span>
            </button>`,
          ).join('')}
        </div>
        <h3>Players <span class="stepper">
          <button class="btn small" data-count="-1" aria-label="Fewer players" ${s.count <= 1 ? 'disabled' : ''}>−</button>
          <span class="hand" style="font-size:24px">${s.count}</span>
          <button class="btn small" data-count="1" aria-label="More players" ${s.count >= 4 ? 'disabled' : ''}>+</button>
        </span></h3>
        <div class="players">
          ${Array.from(
            { length: s.count },
            (_, i) => `
            <label class="player-row">
              <span class="dot" style="border-color:${PLAYER_COLORS[i]}"></span>
              <input data-name="${i}" maxlength="14" value="${esc(s.names[i] ?? `Player ${i + 1}`)}" aria-label="Player ${i + 1} name" style="color:${PLAYER_COLORS[i]}" autocomplete="off" />
            </label>`,
          ).join('')}
        </div>
        ${s.count > 1 ? '<p class="hint">Pass-and-play: hand the device round; each player draws in their own colour.</p>' : ''}
        <div class="actions">
          <button class="btn" data-act="back">Back</button>
          <button class="btn primary" data-act="go">Tee off →</button>
        </div>
      </div>`;
    page.querySelectorAll<HTMLButtonElement>('[data-course]').forEach((b) =>
      b.addEventListener('click', () => {
        s.course = Number(b.dataset.course);
        draw();
      }),
    );
    page.querySelectorAll<HTMLButtonElement>('[data-count]').forEach((b) =>
      b.addEventListener('click', () => {
        s.count = Math.min(4, Math.max(1, s.count + Number(b.dataset.count)));
        draw();
      }),
    );
    page.querySelectorAll<HTMLInputElement>('[data-name]').forEach((inp) =>
      inp.addEventListener('input', () => {
        s.names[Number(inp.dataset.name)] = inp.value;
      }),
    );
    page.querySelector('[data-act=back]')!.addEventListener('click', closeCover);
    page.querySelector('[data-act=go]')!.addEventListener('click', () => {
      Object.assign(prefs, s);
      writeJson(KEY_PREFS, prefs);
      game = newGame(s.course, s.names.slice(0, s.count));
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
  page.querySelector('[data-act=back]')!.addEventListener('click', () => (back === 'play' ? showPlay() : closeCover()));
}

function scorecardHtml(g: GameState): string {
  const head = g.players.map((p) => `<th style="color:${p.color}">${esc(p.name)}</th>`).join('');
  const rows = Array.from({ length: HOLES_PER_COURSE }, (_, h) => {
    const cells = g.players
      .map((p) => {
        const s = p.scores[h];
        if (s === null) return '<td></td>';
        const cls = s < PAR ? 'hand under circled' : 'hand';
        return `<td class="${cls}" style="color:${s < PAR ? '' : p.color}">${s}</td>`;
      })
      .join('');
    return `<tr class="${h === g.holeIndex && !g.finished ? 'cur' : ''}"><td>Hole ${h + 1} <span class="hint">/${PAR}</span></td>${cells}</tr>`;
  }).join('');
  const totals = g.players.map((p) => `<td>${totalStrokes(p)} <span class="hint">(${formatToPar(toPar(p))})</span></td>`).join('');
  const mulls = `<tr><td>Mulligans</td>${g.players.map((p) => `<td class="hint">${p.mulligans} left</td>`).join('')}</tr>`;
  return `<table class="card-table"><thead><tr><th>${esc(COURSES[g.course].name)}</th>${head}</tr></thead><tbody>${rows}</tbody><tfoot><tr><td>Total</td>${totals}</tr>${mulls}</tfoot></table>`;
}

function showScorecard() {
  if (!game) return;
  screen = 'card';
  void fx.hideDie();
  tray.hidden = true;
  layout();
  page.innerHTML = `<div class="sheet"><h2>Scorecard</h2>${scorecardHtml(game)}<div class="actions"><button class="btn primary" data-act="back">Back to the hole</button></div></div>`;
  page.querySelector('[data-act=back]')!.addEventListener('click', showPlay);
}

function showFinal() {
  if (!game) return;
  const g = game;
  screen = 'card';
  tray.hidden = true;
  layout();
  const ranked = [...g.players].sort((a, b) => totalStrokes(a) - totalStrokes(b));
  const winner = ranked[0];
  const tie = ranked.length > 1 && totalStrokes(ranked[1]) === totalStrokes(winner);
  // Record course bests.
  const k = bestKey(g.course);
  const low = totalStrokes(winner);
  if (best[k] === undefined || low < best[k]) {
    best[k] = low;
    writeJson(KEY_BEST, best);
  }
  writeJson(KEY_GAME, null);
  const title =
    g.players.length === 1
      ? `${formatToPar(toPar(winner))} on ${COURSES[g.course].name}`
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
  page.querySelector('[data-act=home]')!.addEventListener('click', () => {
    game = null;
    closeCover();
  });
  page.querySelector('[data-act=again]')!.addEventListener('click', () => {
    game = newGame((g.course + 1) % COURSES.length, g.players.map((p) => p.name));
    saveGame();
    shownHole = -1;
    showPlay();
  });
  void showBanner(`${tie ? 'Tie!' : g.players.length > 1 ? 'Winner!' : 'Round done!'}`, 1500);
}

// ------------------------------------------------------------------ play

function showPlay() {
  if (!game) return closeCover();
  if (game.finished) return showFinal();
  screen = 'play';
  tray.hidden = false;
  layout();
  page.innerHTML = `
    <header class="hud" id="hud"></header>
    <div class="board-wrap" id="board-wrap"></div>
    <footer class="scoreline" id="scoreline"></footer>`;
  board = new Board($('board-wrap'));
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
  const p = g.players[g.current];
  const ball = currentBall(g);
  $('hud').innerHTML = `
    <div class="title"><b>Hole ${g.holeIndex + 1} <span class="hint">of ${HOLES_PER_COURSE}</span></b>${esc(COURSES[g.course].name)}</div>
    <div class="chips">${g.players
      .map((pl, i) => {
        const b = g.balls[i];
        const done = b.holed || b.pickedUp;
        return `<span class="chip ${i === g.current && !g.holeDone ? 'on' : ''} ${done ? 'done' : ''}" style="color:${pl.color}">
          <i style="background:${pl.color}"></i><span style="color:var(--ink)">${esc(pl.name)}</span>
          <span class="hand">${b.strokes}</span></span>`;
      })
      .join('')}</div>`;
  $('scoreline').innerHTML = `
    <span>Hole ${g.holeIndex + 1}</span>
    <span>Strokes: <span class="hand" style="color:${p.color}">${ball.strokes || ''}</span> /${PAR}</span>
    <span>Total: <span class="hand" style="color:${p.color}">${p.scores.some((s) => s !== null) ? formatToPar(toPar(p)) : ''}</span></span>`;
}

function lieText(): string {
  if (!game) return '';
  const t = cellAt(currentHole(game), currentBall(game).pos).t;
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
  tray.querySelector('[data-act=card]')?.addEventListener('click', () => !input.busy && showScorecard());
  tray.querySelector('[data-act=rules]')?.addEventListener('click', () => !input.busy && showRules('play'));
  tray.querySelector('[data-act=home]')?.addEventListener('click', () => !input.busy && closeCover());
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
  const p = g.players[g.current];
  const name = `<span style="color:${p.color}">${esc(p.name)}</span>`;
  if (!g.dice) {
    board.clearTargets();
    renderTray(
      `${name}${g.players.length > 1 ? "'s" : ', your'} shot`,
      `${lieText()}${currentBall(g).strokes === 0 ? ' · tee: 1 free re-roll' : ` · ${p.mulligans} mulligan${p.mulligans === 1 ? '' : 's'}`}`,
      `<div class="die-slot" id="die-slot">?</div>
       <div class="grow"><button class="btn primary" data-act="roll">${icon('dice', 18)} Roll</button></div>`,
    );
    tray.querySelector('[data-act=roll]')!.addEventListener('click', () => doRoll('roll'));
    return;
  }
  const v = g.dice.value;
  const dist = diceDistance(currentHole(g), currentBall(g).pos, v);
  const moves = availableMoves(g);
  const hits = moves.filter((m) => m.kind === 'hit').length;
  let sub: string;
  if (dist <= 1) sub = 'Only a putt from here';
  else if (!hits) sub = `No clear line for ${dist} — putt, or use a mulligan`;
  else sub = `Hit ${dist}${dist !== v ? ` (${v}${dist > v ? '+1' : '−1'})` : ''} or putt 1 · tap a spot`;
  renderTray(
    `${name} rolled <span class="hand">${v}</span>`,
    sub,
    `<div class="die-slot ${fx.enabled ? '' : 'fallback'}" id="die-slot">${fx.enabled ? '' : v}</div>
     <div class="grow">
       ${canTeeReroll(g) ? `<button class="btn" data-act="reroll">Re-roll</button>` : ''}
       <button class="btn" data-act="mull" ${canMulligan(g) ? '' : 'disabled'} aria-label="Mulligan, ${p.mulligans} left">Mulligan <span class="count">${p.mulligans}</span></button>
     </div>`,
  );
  tray.querySelector('[data-act=reroll]')?.addEventListener('click', () => doRoll('reroll'));
  tray.querySelector('[data-act=mull]')?.addEventListener('click', () => doRoll('mulligan'));
  const c = dieSlotCenter();
  if (c) fx.showDieStatic(v, c, c.size);
  showTargets(moves);
}

function showTargets(moves: MoveOption[]) {
  if (!game || !board) return;
  const g = game;
  board.setTargets(moves, currentBall(g).pos, g.players[g.current].color, (m) => void playShot(m));
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

async function playShot(m: MoveOption) {
  const g = game;
  const b = board;
  if (!g || !b) return;
  const who = g.current;
  // Targets, rolls, mulligans and tray tools stay locked until the ball has settled and the line is drawn.
  const ran = await input.run(async () => {
    const k = g.balls[who].shots.length;
    b.clearTargets();
    tray.querySelectorAll('button').forEach((el) => (el.disabled = true));
    const { record } = shoot(g, m.dir, m.dist);
    saveGame();
    void fx.hideDie();
    await animateShot(who, k, record);
    refreshPage();
    if (record.holed) {
      const strokes = g.balls[who].strokes;
      await showBanner(`${scoreName(strokes)}<small>${esc(g.players[who].name)} · ${strokes} stroke${strokes > 1 ? 's' : ''}</small>`, 1500);
    } else if (g.balls[who].pickedUp) {
      await showBanner(`Picked up<small>${esc(g.players[who].name)} · ${g.balls[who].strokes}</small>`, 1300);
    }
  });
  if (!ran) return;
  if (!g.holeDone && g.players.length > 1 && g.current !== who) {
    void showBanner(`<span style="color:${g.players[g.current].color}">${esc(g.players[g.current].name)}</span><small>your shot</small>`, 1000);
  }
  beginTurn();
}

async function animateShot(who: number, k: number, s: ShotRecord) {
  if (!game || !board) return;
  const g = game;
  const color = g.players[who].color;
  const seed = who * 1000 + k * 17 + 1;
  // Draw everything except this shot, then animate it in.
  const hiddenShot = g.balls[who].shots.pop()!;
  board.renderShots(g);
  g.balls[who].shots.push(hiddenShot);
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

  const steps: Record<ShotStep, () => Promise<void> | void> = {
    fly: () => fx.flyShot(from, landing, flightLegs(s.dist, px, putt), r),
    line: () => fx.pencilTrace(line.set, line.tip, putt ? 260 : 300 + s.dist * 15),
    circle: () => (circ ? fx.pencilTrace(circ.set, circ.tip, 280) : undefined),
    roll: () => fx.flyBall(landing, end, { radius: r, height: 0, dur: 380 }),
    'roll-line': () => (rollLine ? fx.pencilTrace(rollLine.set, rollLine.tip, 260) : undefined),
    'lift-pencil': () => fx.liftPencil(),
    sink: () => fx.sinkBall(end, r),
    'hide-ball': () => fx.hideBall(),
  };
  for (const step of shotSteps(s)) await steps[step]();
  for (const st of [line, circ, rollLine]) st?.set(1);
}

function showHoleCard() {
  if (!game || screen !== 'play') return;
  const g = game;
  const last = g.holeIndex + 1 >= HOLES_PER_COURSE;
  const card = document.createElement('div');
  card.className = 'hole-card';
  card.innerHTML = `
    <h2>Hole ${g.holeIndex + 1} done</h2>
    <div class="rows">${g.players
      .map((p) => {
        const s = p.scores[g.holeIndex] ?? 0;
        return `<div class="row"><span><b style="color:${p.color}">${esc(p.name)}</b> · ${scoreName(s).replace('!', '')}</span>
          <span><span class="hand" style="color:${p.color}">${s}</span> <span class="hint">tot ${formatToPar(toPar(p))}</span></span></div>`;
      })
      .join('')}</div>
    <div class="actions">
      <button class="btn" data-act="card">Card</button>
      <button class="btn primary" data-act="next">${last ? 'Final card' : 'Next hole →'}</button>
    </div>`;
  page.appendChild(card);
  card.querySelector('[data-act=card]')!.addEventListener('click', showScorecard);
  card.querySelector('[data-act=next]')!.addEventListener('click', () => {
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
    if (g.players.length > 1)
      void showBanner(`<span style="color:${g.players[g.current].color}">${esc(g.players[g.current].name)}</span><small>has the honour</small>`, 1100);
    else void showBanner(`Hole ${g.holeIndex + 1}`, 900);
    beginTurn();
  });
}

function flipPage() {
  const leaf = page.cloneNode(true) as HTMLElement;
  leaf.removeAttribute('id');
  leaf.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
  leaf.classList.add('leaf');
  leaf.style.height = page.style.height;
  notebook.appendChild(leaf);
  const done = () => leaf.remove();
  // Child animations (target pops) bubble animationend too; only the leaf's own flip counts.
  leaf.addEventListener('animationend', (e) => e.target === leaf && done());
  window.setTimeout(done, 1500);
}

// ------------------------------------------------------------------ keyboard

window.addEventListener('keydown', (e) => {
  if (screen !== 'play' || input.busy ||!game || (e.target as HTMLElement)?.tagName === 'INPUT') return;
  if ((e.key === 'r' || e.key === ' ') && !game.dice && !game.holeDone) {
    e.preventDefault();
    void doRoll('roll');
  }
});

// ------------------------------------------------------------------ boot

tray.hidden = true;
layout();
renderCover();
// Debug/screenshot hook: ?play=<course>&players=<n>&hole=<n> jumps straight into a round. A legacy `mode` param is ignored.
{
  const q = new URLSearchParams(location.search);
  if (q.has('play')) {
    const course = Math.min(4, Math.max(0, Number(q.get('play')) || 0));
    const n = Math.min(4, Math.max(1, Number(q.get('players')) || 1));
    game = newGame(course, prefs.names.slice(0, n));
    const hole = Number(q.get('hole')) || 1;
    while (game.holeIndex < hole - 1) {
      game.holeDone = true;
      nextHole(game);
    }
    cover.style.transition = 'none';
    openCover();
    showPlay();
    requestAnimationFrame(() => (cover.style.transition = ''));
  }
}
