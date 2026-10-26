/**
 * The builder screen. It draws the draft with the same board as a round and calls the pure helpers in
 * `src/engine/builder.ts` for every change. It does not decide whether a hole can be played.
 */
import {
  BROKEN_LINK,
  LEAVE_WARN,
  applyTool,
  blankDraft,
  builderStep,
  cellFromClient,
  clearDraft,
  cloneDraft,
  draftHeight,
  draftsEqual,
  draftToHole,
  encodeHole,
  holeToDraft,
  nextHeight,
  previewHole,
  readyHole,
  setPar,
  toolRefusal,
  toolReplaces,
  toolRepeats,
  type Draft,
  type Par,
  type Tool,
} from '../engine/builder';
import { CALM, type Height, type Hole } from '../engine/types';
import { Board } from './board';
import { byId, query } from './dom';

const TOOLS: readonly { id: Tool; label: string }[] = [
  { id: 'rough', label: 'Rough' },
  { id: 'fairway', label: 'Fairway' },
  { id: 'sand', label: 'Sand' },
  { id: 'water', label: 'Water' },
  { id: 'tree', label: 'Tree' },
  { id: 'slope', label: 'Slope' },
  { id: 'height', label: 'Height' },
  { id: 'tee', label: 'Tee' },
  { id: 'pin', label: 'Pin' },
  { id: 'erase', label: 'Erase' },
];

const PARS: readonly Par[] = [3, 4, 5];

/** How many undo steps are kept. */
const UNDO_DEPTH = 60;

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
  /** Keep the hole on the device (`src/game/library.ts`); the host asks for its name. */
  onSave(hole: Hole): void;
}

function toolLabel(tool: Tool): string {
  return TOOLS.find((t) => t.id === tool)?.label ?? 'Rough';
}

/**
 * The square of colour (terrain) or little drawing (slope, tee, pin, erase) on each tool button, so all nine read at a
 * glance instead of five swatches beside four bare words.
 */
function swatch(tool: Tool): string {
  const glyph = (body: string) => `<i class="swatch glyph" aria-hidden="true"><svg viewBox="-8 -8 16 16">${body}</svg></i>`;
  if (tool === 'slope') return glyph('<path d="M0 -5.5 L4.8 3.5 H-4.8 Z"/>');
  // A sheet of paper glued on the page: the raised ground's look in little.
  if (tool === 'height') return glyph('<rect x="-3.6" y="-3" width="10.5" height="9" rx="1.6" class="g-shadow"/><rect x="-6" y="-5.6" width="10.5" height="9" rx="1.6" class="g-tee"/>');
  if (tool === 'tee') return glyph('<circle cx="0" cy="0" r="4.6" class="g-tee"/>');
  if (tool === 'pin') return glyph('<path d="M-3.4 6 V-6" class="g-line"/><path d="M-3.4 -6 L5 -3.4 L-3.4 -0.8 Z"/>');
  if (tool === 'erase') return glyph('<rect x="-6" y="-4" width="12" height="8" rx="2" class="g-rub"/><path d="M-1.2 -4 V4" class="g-line"/>');
  return `<i class="swatch t-${tool}" aria-hidden="true"></i>`;
}

/** Drop a `#h=` link from the address bar. A round or the title screen should not reopen the builder on refresh. */
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
  /** The page as it opened (blank, or the hole a `#h=` link carried): leaving that behind costs nothing. */
  const opened = cloneDraft(draft);
  const past: Draft[] = [];
  let snapshot: Draft | null = null;
  let stroking = false;
  let once = false;
  let last: { x: number; y: number } | null = null;
  /** The height a Height drag paints: chosen by the first square it touches (`nextHeight`), then the same all the way. */
  let lift: Height | undefined;
  /** Back was tapped once on a drawing that is not blank: the next tap leaves. */
  let leaving = false;

  host.page.innerHTML = `
    <header class="hud build" id="hud">
      <div class="title"><b><span class="hole-no">Build a hole</span><span class="par-sep"> · </span><span class="par" id="builder-par"></span></b></div>
    </header>
    <div class="board-wrap painting" id="board-wrap"></div>`;
  host.tray.innerHTML = `
    <div class="builder-tray">
      <div class="status"><span id="builder-step"></span><small id="builder-note" role="status"></small></div>
      <div class="builder-scroll">
        <div class="builder-tools" role="group" aria-label="Pencil">
          ${TOOLS.map((t) => `<button class="btn small" data-tool="${t.id}" type="button" aria-pressed="false">${swatch(t.id)}<span>${t.label}</span></button>`).join('')}
        </div>
        <div class="builder-row" role="group" aria-label="Par">
          ${PARS.map((p) => `<button class="btn small" data-par="${String(p)}" type="button">Par ${String(p)}</button>`).join('')}
        </div>
        <div class="builder-row">
          <button class="btn small" data-act="undo" type="button">Undo</button>
          <button class="btn small" data-act="clear" type="button">Clear</button>
          <button class="btn small" data-act="share" type="button">Share</button>
          <button class="btn small" data-act="save" type="button">Save</button>
          <button class="btn small" data-act="back" type="button">Back</button>
        </div>
      </div>
      <button class="btn primary builder-play" data-act="play" type="button">Play this hole</button>
    </div>`;

  const board = new Board(byId('board-wrap'));
  const noteEl = () => query(host.tray, '#builder-note');

  function setNote(text: string) {
    note = text;
    noteEl().textContent = text;
  }

  /** The hand-written line over the tray: what the hole still needs, then what the pencil is set to. */
  function drawStep() {
    query(host.tray, '#builder-step').textContent = builderStep(draft);
    if (note === '') noteEl().textContent = tool === 'height' ? 'Pencil: Height · tap: raised, low, level' : `Pencil: ${toolLabel(tool)} · tap or drag the page`;
  }

  function draw() {
    board.setHole(previewHole(draft));
    query(host.page, '#builder-par').textContent = `Par ${String(draft.par)}`;
    noteEl().textContent = note;
    drawStep();
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

  function push(d: Draft) {
    past.push(d);
    if (past.length > UNDO_DEPTH) past.shift();
  }

  function remember() {
    if (snapshot !== null && !draftsEqual(snapshot, draft)) push(snapshot);
    snapshot = null;
  }

  /** Every change makes the shared link stale, so it goes: a reload must never bring back the hole as it was shared. */
  function changed() {
    leaving = false;
    clearHoleLink();
    if (note !== '') setNote('');
  }

  function paintAt(e: PointerEvent) {
    const p = cellFromClient(board.svg.getBoundingClientRect(), e.clientX, e.clientY);
    if (p === null) return;
    if (!toolRepeats(tool)) {
      if (once) return;
      once = true;
    } else if (last !== null && last.x === p.x && last.y === p.y) return;
    last = p;
    // Dragging the tee or the pin moves it to where the finger lifts, so each move starts again from the draft the
    // gesture began on; everything else paints onto what is there.
    if (tool === 'height') lift ??= nextHeight(draftHeight(draft, p.x, p.y));
    const next = applyTool(toolReplaces(tool) ? (snapshot ?? draft) : draft, p.x, p.y, tool, lift);
    if (draftsEqual(next, draft)) {
      // A slope on water or trees paints nothing: say so instead of looking broken.
      const refusal = toolRefusal(draft, p.x, p.y, tool);
      if (refusal !== '' && note !== refusal) setNote(refusal);
      return;
    }
    draft = next;
    changed();
    board.setHole(previewHole(draft));
    drawStep();
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const svg = e.currentTarget;
    if (svg instanceof Element) svg.setPointerCapture(e.pointerId);
    stroking = true;
    once = false;
    last = null;
    lift = undefined;
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
      leaving = false;
      tool = found.id;
      if (note !== '') setNote('');
      draw();
    });
  });
  host.tray.querySelectorAll<HTMLButtonElement>('[data-par]').forEach((b) => {
    b.addEventListener('click', () => {
      const par = Number(b.dataset.par);
      if (par !== 3 && par !== 4 && par !== 5) return;
      const next = setPar(draft, par);
      if (draftsEqual(next, draft)) return;
      // The par is an undo step of its own: without one, undoing a later stroke put the old par back with it.
      push(cloneDraft(draft));
      draft = next;
      changed();
      draw();
    });
  });
  query(host.tray, '[data-act=undo]').addEventListener('click', () => {
    const prev = past.pop();
    if (prev === undefined) return;
    draft = prev;
    changed();
    draw();
  });
  query(host.tray, '[data-act=clear]').addEventListener('click', () => {
    const next = clearDraft(draft);
    if (draftsEqual(next, draft)) return;
    push(cloneDraft(draft));
    draft = next;
    changed();
    draw();
  });
  query(host.tray, '[data-act=back]').addEventListener('click', () => {
    // Leaving throws the drawing away, and undo does not reach back past it: ask once when there is one.
    if (!leaving && !draftsEqual(draft, opened)) {
      leaving = true;
      setNote(LEAVE_WARN);
      return;
    }
    host.onBack();
  });
  query(host.tray, '[data-act=share]').addEventListener('click', () => {
    void share();
  });
  query(host.tray, '[data-act=save]').addEventListener('click', () => {
    leaving = false;
    // The same check Play and Share make: a hole nobody can finish is not worth keeping.
    const ready = readyHole(draft);
    if (!ready.ok) {
      setNote(ready.reason);
      return;
    }
    host.onSave(ready.hole);
  });
  query(host.tray, '[data-act=play]').addEventListener('click', () => {
    leaving = false;
    const ready = readyHole(draft);
    if (!ready.ok) {
      setNote(ready.reason);
      return;
    }
    host.onPlay(ready.hole);
  });

  async function share(): Promise<void> {
    leaving = false;
    // The same check Play makes: a link to a hole nobody can finish is worse than no link.
    const ready = readyHole(draft);
    if (!ready.ok) {
      setNote(ready.reason);
      return;
    }
    const hole = draftToHole(draft);
    const token = hole === null ? null : encodeHole(hole);
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
