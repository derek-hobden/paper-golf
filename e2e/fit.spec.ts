import { expect, test, type Page } from '@playwright/test';
import { newGame, nextHole, type GameState } from '../src/game/game';
import { holeOutWithPutt } from '../tests/helpers';
import { queueDice, rigDice } from './rig';

// Every screen fits every phone and desktop size: each case opens one screen at one viewport with 1 or 4 players and
// checks that every control and everything the player has to see (HUD, chips, board, strip, die, hole card) is inside
// the visible viewport (window.innerHeight and Safari's visualViewport, and the width), not cut off by the page or a
// sheet (scrolling a box that scrolls, such as a long sheet or the chips row, is fine), with no horizontal or vertical
// page overflow and no console or page errors. A new HUD element, banner or button that overflows fails here without
// anyone adding a spec. Runs in Chrome and, tagged @webkit, in WebKit as an iPhone 14.

const KEY_GAME = 'paper-golf:game:v1';

const VIEWPORTS = [
  { width: 390, height: 844, phone: true }, // iPhone 14, Safari's toolbars collapsed
  { width: 390, height: 664, phone: true }, // iPhone 14 with Safari's top and bottom toolbars showing
  { width: 375, height: 548, phone: true }, // iPhone SE with the toolbars showing (`compact`)
  { width: 844, height: 390, phone: true }, // iPhone 14 on its side (`short`)
  { width: 740, height: 360, phone: true }, // a small Android on its side
  { width: 1440, height: 900, phone: false }, // desktop
] as const;

const PLAYERS = [1, 4] as const;

/** Hole 17 of Thunder Peaks (the longest course name) with holes 1-16 scored, so the card's Out/In/Total are full. */
function lateRound(players: number): GameState {
  const g = newGame(
    4,
    Array.from({ length: players }, (_, i) => `Player ${String(i + 1)}`),
  );
  for (let h = 0; h < 16; h++) {
    for (const [i, p] of g.players.entries()) p.scores[h] = 3 + ((h + 2 * i) % 6);
    g.holeDone = true;
    nextHole(g);
  }
  return g;
}

/** Saves `g` as the round in progress and opens it from the cover's Continue. */
async function continueRound(page: Page, g: GameState) {
  await page.goto('/');
  await page.evaluate(([k, v]) => {
    localStorage.setItem(k, v);
  }, [KEY_GAME, JSON.stringify(g)] as const);
  await page.reload();
  await page.locator('#cover [data-act=continue]').click();
}

interface Screen {
  name: string;
  /** The screen's main control: it must be among the controls measured, so the check sees the screen it opened. */
  main: string;
  open: (page: Page, players: number) => Promise<void>;
}

const SCREENS: Screen[] = [
  {
    // 1 player: a first visit (New round, How to play and the footer); 4 players: a round to continue (3 buttons).
    name: 'cover',
    main: '#cover [data-act=new]',
    open: async (page, players) => {
      await page.goto('/');
      if (players > 1) {
        await continueRound(page, lateRound(players));
        await page.locator('#tray [data-act=home]').click();
        await expect(page.locator('#cover [data-act=continue]')).toBeVisible();
      }
      await expect(page.locator('#cover [data-act=new]')).toBeVisible();
    },
  },
  {
    name: 'setup',
    main: '.sheet [data-act=go]',
    open: async (page, players) => {
      await page.goto('/');
      await page.locator('#cover [data-act=new]').click();
      await expect(page.locator('.sheet h2')).toHaveText('New round');
      for (let n = 1; n < players; n++) await page.locator('[data-count="1"]').click();
      await expect(page.locator('.player-row')).toHaveCount(players);
    },
  },
  {
    name: 'builder',
    main: '#tray [data-act=play]',
    open: async (page, players) => {
      await page.goto('/');
      await page.locator('#cover [data-act=new]').click();
      await expect(page.locator('.sheet h2')).toHaveText('New round');
      for (let n = 1; n < players; n++) await page.locator('[data-count="1"]').click();
      await page.locator('[data-act=build]').click();
      await expect(page.locator('#hud')).toContainText('Build a hole');
      await expect(page.locator('#tray [data-act=play]')).toBeVisible();
    },
  },
  {
    // Before the roll (Roll), then after it (Re-roll, Mulligan and the shot markers: the tray's tallest state).
    name: 'play',
    main: '#tray [data-act=roll]',
    open: async (page, players) => {
      await rigDice(page);
      await page.goto(`/?play=4&players=${String(players)}&hole=1`);
      await expect(page.locator('#hud .chip')).toHaveCount(players);
      await expect(page.locator('#tray [data-act=roll]')).toBeEnabled();
    },
  },
  {
    name: 'How to play',
    main: '.sheet [data-act=back]',
    open: async (page, players) => {
      await page.goto(`/?play=4&players=${String(players)}&hole=1`);
      await page.locator('#tray [data-act=rules]').click();
      await expect(page.locator('.sheet .legend')).toBeVisible();
    },
  },
  {
    // Everyone has holed out on hole 17: the card lists each player and, with 4, the next tee order.
    name: 'hole card',
    main: '.hole-card [data-act=next]',
    open: async (page, players) => {
      const g = lateRound(players);
      for (let i = 0; i < players; i++) holeOutWithPutt(g);
      expect(g.holeDone, 'every ball holed').toBe(true);
      await continueRound(page, g);
      await expect(page.locator('.hole-card')).toBeVisible();
    },
  },
  {
    name: 'scorecard',
    main: '.sheet [data-act=back]',
    open: async (page, players) => {
      await continueRound(page, lateRound(players));
      await page.locator('#tray [data-act=card]').click();
      await expect(page.locator('.sheet h2')).toHaveText('Scorecard');
    },
  },
];

interface Fit {
  /** Every box measured, as `"label" (tag#id.class[data-act])`. */
  boxes: string[];
  /** The screen's main control was one of them. */
  mainMeasured: boolean;
  /** One line per box outside the viewport or cut off, and per page-level overflow. */
  problems: string[];
}

/**
 * Measures the screen once layout has settled (fonts loaded, every box the same three frames running). It checks
 * every control (anything tappable) and everything the player has to see to play (the HUD title and player chips,
 * the board, the score strip, the tray's status and die, the hole card) that is shown and takes pointer events (the
 * folded-back cover is skipped). Shot markers are judged by their drawn dot, as their invisible 44 px hit circle may
 * cross the page edge.
 */
async function measureFit(page: Page, main: string): Promise<Fit> {
  return page.evaluate(async (mainSelector) => {
    const SHOWN = [
      'button, input, select, textarea, a[href], [role=button]',
      '#hud .title, #hud .chip, #board-wrap, #scoreline, #tray .status, #tray .die-slot, .hole-card',
    ].join(', ');
    await document.fonts.ready;
    const layout = () => [...document.querySelectorAll(`${SHOWN}, #tray`)].map((e) => JSON.stringify(e.getBoundingClientRect())).join();
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    for (let last = '', same = 0, n = 0; same < 3 && n < 300; n++) {
      await frame();
      const now = layout();
      same = now === last ? same + 1 : 0;
      last = now;
    }

    const SLACK = 0.5;
    const vv = window.visualViewport;
    const right = Math.min(window.innerWidth, vv?.width ?? Infinity);
    const bottom = Math.min(window.innerHeight, vv?.height ?? Infinity);
    const px = (n: number) => String(Math.round(n * 10) / 10);
    const rect = (r: DOMRect) => `[${px(r.left)},${px(r.top)} → ${px(r.right)},${px(r.bottom)}]`;
    const outside = (r: DOMRect, b: { left: number; top: number; right: number; bottom: number }) =>
      r.left < b.left - SLACK || r.top < b.top - SLACK || r.right > b.right + SLACK || r.bottom > b.bottom + SLACK;
    const name = (e: Element) => {
      const act = e.getAttribute('data-act');
      const label = (e.getAttribute('aria-label') ?? e.textContent).trim().replace(/\s+/g, ' ').slice(0, 30);
      const id = e.id ? `#${e.id}` : '';
      const cls = typeof e.className === 'string' && e.className ? `.${e.className.trim().split(/\s+/).join('.')}` : '';
      return `"${label}" (${e.tagName.toLowerCase()}${id}${cls}${act ? `[data-act=${act}]` : ''})`;
    };
    const userScrolls = (o: string) => o === 'auto' || o === 'scroll';
    const clippers = (e: Element) => {
      const out: { box: Element; style: CSSStyleDeclaration }[] = [];
      for (let a = e.parentElement; a; a = a.parentElement) {
        const style = getComputedStyle(a);
        if (style.overflowX !== 'visible' || style.overflowY !== 'visible') out.push({ box: a, style });
      }
      return out;
    };

    const boxes: string[] = [];
    const problems: string[] = [];
    const mainEl = document.querySelector(mainSelector);
    let mainMeasured = false;
    // A shut cover hides the page under it (a round to continue is laid out there).
    const coverShut = document.querySelector('#cover:not(.open)') !== null;
    for (const e of document.querySelectorAll(SHOWN)) {
      if (!e.checkVisibility({ visibilityProperty: true }) || getComputedStyle(e).pointerEvents === 'none') continue;
      if (coverShut && e.closest('#page')) continue;
      const what = name(e);
      boxes.push(what);
      if (e === mainEl) mainMeasured = true;
      const body = e.querySelector(':scope > circle.mark') ?? e;
      // Bring it into view as a player could: by scrolling a box that scrolls (a long sheet, the chips row). Boxes the
      // player can't scroll (overflow hidden: the page, the document) are put back, so what they cut off stays cut off.
      body.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const clips = clippers(e);
      for (const { box, style } of clips) {
        if (!userScrolls(style.overflowX)) box.scrollLeft = 0;
        if (!userScrolls(style.overflowY)) box.scrollTop = 0;
      }
      const r = body.getBoundingClientRect();
      if (outside(r, { left: 0, top: 0, right, bottom })) {
        problems.push(
          `${what} ${rect(r)} outside the viewport [0,0 → ${px(right)},${px(bottom)}] (innerHeight ${String(window.innerHeight)}, visualViewport ${px(vv?.height ?? NaN)})`,
        );
      }
      // The document and body clip at the viewport, checked above.
      for (const { box } of clips.filter((c) => c.box !== document.documentElement && c.box !== document.body)) {
        const b = box.getBoundingClientRect();
        if (outside(r, b)) problems.push(`${what} ${rect(r)} cut off by ${name(box)} ${rect(b)}`);
      }
      // A player chip reads on one line: its name and strokes never wrap onto a second line or run out of the chip.
      if (e.matches('#hud .chip')) {
        for (const part of e.querySelectorAll(':scope > span')) {
          const range = document.createRange();
          range.selectNodeContents(part);
          const lines = new Set([...range.getClientRects()].map((l) => Math.round(l.top))).size;
          if (lines > 1) problems.push(`${what}: "${part.textContent.trim()}" wraps onto ${String(lines)} lines`);
          if (outside(part.getBoundingClientRect(), r)) problems.push(`${what}: "${part.textContent.trim()}" runs out of the chip ${rect(r)}`);
        }
      }
    }

    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth) problems.push(`horizontal overflow: scrollWidth ${String(doc.scrollWidth)} > ${String(doc.clientWidth)}`);
    if (doc.scrollHeight > bottom + SLACK) problems.push(`vertical overflow: scrollHeight ${String(doc.scrollHeight)} > ${px(bottom)}`);
    return { boxes, problems, mainMeasured };
  }, main);
}

async function expectFits(page: Page, main: string, where: string) {
  await expect(page.locator(main), where).toBeVisible();
  const fit = await measureFit(page, main);
  expect(fit.mainMeasured, `${where}: ${main} among the boxes measured: ${fit.boxes.join(', ')}`).toBe(true);
  expect(fit.problems, `${where}: out of view or cut off`).toEqual([]);
}

// A failing case leaves a screenshot of the screen next to its trace (test-results/). A control pushed off the screen
// fails its click in seconds, not at the 60 s test timeout.
test.use({ screenshot: 'only-on-failure', actionTimeout: 10_000 });

for (const vp of VIEWPORTS) {
  const size = `${String(vp.width)}x${String(vp.height)}`;

  test.describe(`fit ${size}`, { tag: '@webkit' }, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.phone, hasTouch: vp.phone });

    for (const screen of SCREENS) {
      for (const players of PLAYERS) {
        const key = `${screen.name} ${size} ${String(players)}p`;
        test(`${screen.name}, ${String(players)} player${players > 1 ? 's' : ''}`, async ({ page }) => {
          const errors: string[] = [];
          page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
          page.on('console', (m) => {
            if (m.type() === 'error') errors.push(`console: ${m.text()}`);
          });

          await screen.open(page, players);
          await expectFits(page, screen.main, key);
          if (screen.name === 'play') {
            // A 2 from the tee can't reach the cup, so nothing plays itself: Re-roll, Mulligan and the markers stay.
            await queueDice(page, 2);
            await page.locator('#tray [data-act=roll]').click();
            await expect(page.locator('#tray .status')).toContainText('rolled');
            await expect(page.locator('g.target').first()).toBeVisible();
            await expectFits(page, '#tray [data-act=mull]', `${key}, rolled`);
          }
          expect(errors, `${key}: console and page errors`).toEqual([]);
        });
      }
    }
  });
}
