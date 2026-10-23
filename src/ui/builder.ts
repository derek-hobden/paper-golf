/**
 * The builder screen. It draws the draft with the same board as a round and calls the pure helpers in
 * `src/engine/builder.ts` for every change. It does not decide whether a hole can be played.
 */
import {
  BROKEN_LINK,
  PLACE_BOTH,
  PLACE_PIN,
  PLACE_TEE,
  applyTool,
  blankDraft,
  cellFromClient,
  clearDraft,
  cloneDraft,
  draftsEqual,
  draftToHole,
  encodeHole,
  holeToDraft,
  previewHole,
  readyHole,
  setPar,
  toolRepeats,
  type Draft,
  type Par,
  type Tool,
} from '../engine/builder';
import { CALM, type Hole } from '../engine/types';
import { Board } from './board';
import { byId, query } from './dom';

const TOOLS: readonly { id: Tool; label: string }[] = [
  { id: 'rough', label: 'Rough' },
  { id: 'fairway', label: 'Fairway' },
  { id: 'sand', label: 'Sand' },
  { id: 'water', label: 'Water' },
  { id: 'tree', label: 'Tree' },
  { id: 'slope', label: 'Slope' },
  { id: 'tee', label: 'Tee' },
  { id: 'pin', label: 'Pin' },
  { id: 'erase', label: 'Erase' },
];

const PARS: readonly Par[] = [3, 4, 5];

export interface BuilderMount {
  page: HTMLElement;
  tray: HTMLElement;
  /** Who tees off when the hole is played. */
  names: readonly string[];
  /** A shared hole to open, or null for an empty page. */
  shared: Hole | null;
  /** The link was a `#h=` link and did not decode. */
  broken: boolean;
  layout(): void;
  onBack(): void;
  onPlay(hole: Hole): void;
}

function toolLabel(tool: Tool): string {
  return TOOLS.find((t) => t.id === tool)?.label ?? 'Rough';
}

function swatch(tool: Tool): string {
  if (tool === 'slope' || tool === 'tee' || tool === 'pin' || tool === 'erase') return '';
  return `<i class="swatch t-${tool}"></i>`;
}

/** Drop a `#h=` link from the address bar. A round or the setup screen should not reopen the builder on refresh. */
export function clearHoleLink(): void {
  if (!location.hash.startsWith('#h=')) return;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}

/** Fill the page and the tray with the builder and wire painting, undo, share and play. */
export function mountBuilder(host: BuilderMount): void {
  const fromLink = host.shared === null ? null : holeToDraft(host.shared);
  let draft: Draft = fromLink ?? blankDraft();
  let tool: Tool = 'fairway';
  let note = host.broken || (host.shared !== null && fromLink === null) ? BROKEN_LINK : '';
  const past: Draft[] = [];
  let snapshot: Draft | null = null;
  let stroking = false;
  let once = false;
  let last: { x: number; y: number } | null = null;

  host.page.innerHTML = `
    <header class="hud" id="hud">
      <div class="title"><b><span class="hole-no">Build a hole</span></b></div>
    </header>
    <div class="board-wrap painting" id="board-wrap"></div>
    <footer class="scoreline" id="scoreline"></footer>`;
  host.tray.innerHTML = `
    <div class="builder-tray">
      <div class="status"><span id="builder-tool"></span><small id="builder-note" role="status"></small></div>
      <div class="builder-scroll">
        <div class="builder-row" role="group" aria-label="Par">
          ${PARS.map((p) => `<button class="btn small" data-par="${String(p)}" type="button">Par ${String(p)}</button>`).join('')}
        </div>
        <div class="builder-tools" role="group" aria-label="Tools">
          ${TOOLS.map((t) => `<button class="btn small" data-tool="${t.id}" type="button" aria-pressed="false">${swatch(t.id)}${t.label}</button>`).join('')}
        </div>
        <div class="builder-row">
          <button class="btn small" data-act="undo" type="button">Undo</button>
          <button class="btn small" data-act="clear" type="button">Clear</button>
          <button class="btn small" data-act="back" type="button">Back</button>
        </div>
        <button class="btn" data-act="share" type="button">Share</button>
      </div>
      <button class="btn primary builder-play" data-act="play" type="button">Play it</button>
    </div>`;

  const board = new Board(byId('board-wrap'));
  const noteEl = () => query(host.tray, '#builder-note');

  function setNote(text: string) {
    note = text;
    noteEl().textContent = text;
  }

  function draw() {
    board.setHole(previewHole(draft));
    query(host.page, '#scoreline').textContent = `Par ${String(draft.par)} · paint the page`;
    query(host.tray, '#builder-tool').textContent = toolLabel(tool);
    noteEl().textContent = note;
    host.tray.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
      const on = b.dataset.tool === tool;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    host.tray.querySelectorAll<HTMLButtonElement>('[data-par]').forEach((b) => {
      b.classList.toggle('sel', Number(b.dataset.par) === draft.par);
    });
    query(host.tray, '[data-act=undo]').toggleAttribute('disabled', past.length === 0);
  }

  function remember() {
    if (snapshot !== null && !draftsEqual(snapshot, draft)) past.push(snapshot);
    if (past.length > 60) past.shift();
    snapshot = null;
  }

  function paintAt(e: PointerEvent) {
    const p = cellFromClient(board.svg.getBoundingClientRect(), e.clientX, e.clientY);
    if (p === null) return;
    if (!toolRepeats(tool)) {
      if (once) return;
      once = true;
    } else if (last !== null && last.x === p.x && last.y === p.y) return;
    last = p;
    const next = applyTool(draft, p.x, p.y, tool);
    if (draftsEqual(next, draft)) return;
    draft = next;
    if (note !== '') setNote('');
    board.setHole(previewHole(draft));
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const svg = e.currentTarget;
    if (svg instanceof Element) svg.setPointerCapture(e.pointerId);
    stroking = true;
    once = false;
    last = null;
    snapshot = cloneDraft(draft);
    paintAt(e);
  }

  function onMove(e: PointerEvent) {
    if (!stroking) return;
    paintAt(e);
  }

  function onUp() {
    if (!stroking) return;
    stroking = false;
    remember();
    draw();
  }

  board.svg.addEventListener('pointerdown', onDown);
  board.svg.addEventListener('pointermove', onMove);
  board.svg.addEventListener('pointerup', onUp);
  board.svg.addEventListener('pointercancel', onUp);

  host.tray.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.tool;
      const found = TOOLS.find((t) => t.id === id);
      if (!found) return;
      tool = found.id;
      draw();
    });
  });
  host.tray.querySelectorAll<HTMLButtonElement>('[data-par]').forEach((b) => {
    b.addEventListener('click', () => {
      const par = Number(b.dataset.par);
      if (par !== 3 && par !== 4 && par !== 5) return;
      draft = setPar(draft, par);
      draw();
    });
  });
  query(host.tray, '[data-act=undo]').addEventListener('click', () => {
    const prev = past.pop();
    if (prev === undefined) return;
    draft = prev;
    draw();
  });
  query(host.tray, '[data-act=clear]').addEventListener('click', () => {
    const next = clearDraft(draft);
    if (draftsEqual(next, draft)) return;
    past.push(cloneDraft(draft));
    draft = next;
    setNote('');
    draw();
  });
  query(host.tray, '[data-act=back]').addEventListener('click', () => {
    host.onBack();
  });
  query(host.tray, '[data-act=share]').addEventListener('click', () => {
    void share();
  });
  query(host.tray, '[data-act=play]').addEventListener('click', () => {
    const ready = readyHole(draft);
    if (!ready.ok) {
      setNote(ready.reason);
      return;
    }
    host.onPlay(ready.hole);
  });

  async function share(): Promise<void> {
    const hole = draftToHole(draft);
    if (hole === null) {
      if (draft.tee === null && draft.cup === null) setNote(PLACE_BOTH);
      else if (draft.tee === null) setNote(PLACE_TEE);
      else setNote(PLACE_PIN);
      return;
    }
    const token = encodeHole(hole);
    if (token === null) {
      setNote(BROKEN_LINK);
      return;
    }
    const hash = `#h=${token}`;
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    let copied = false;
    try {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}${location.search}${hash}`);
      copied = true;
    } catch {
      // The hash is already in the address bar when the clipboard is refused.
    }
    setNote(copied ? 'Link copied.' : 'The link is in the address bar.');
  }

  draw();
  board.setWind(CALM, true);
  host.layout();
  board.fitWind();
}
