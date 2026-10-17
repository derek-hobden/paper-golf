/**
 * Fitting the notebook to the screen: the board size, the HUD and score-line budgets, the tray, the spiral, and the
 * ResizeObservers that re-fit when any of them grows. `src/main.ts` wires it to the screens.
 */

const DESK_GAP = 10; // #desk gap between the notebook and the tray
const HUD_H = 48; // one row of player chips plus its margin: the least the HUD is budgeted
const LINE_H = 34; // the score line under the board on one row: the least it is budgeted (hidden when short)

/**
 * A ResizeObserver callback that runs `work` on the next frame, never inside the callback itself, and only when an
 * observed box really changed size. Re-fitting inside the callback resizes the observed boxes again, which WebKit
 * reports as "ResizeObserver loop completed with undelivered notifications" (a page error on iPhone Safari).
 */
export function deferredObserver(work: () => void): ResizeObserver {
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

/** The elements the layout fits, what it reads of the app, and what it does after each fit. */
export interface LayoutHost {
  desk: HTMLElement;
  page: HTMLElement;
  tray: HTMLElement;
  spiral: HTMLElement;
  /** The play screen is showing (its HUD and score line are on the page). */
  playing(): boolean;
  /** Runs at the end of every layout(): re-place the die and the wind canvas. */
  fitted(): void;
}

export interface Layout {
  /** Fit the board, HUD, score line, tray and spiral to the viewport. */
  layout: () => void;
  /** One row when it fits the board's width, else two ("Hole 1 · Par 4" over "Strokes 0/4 · Total 0"). */
  fitLine: () => void;
  /** Observe the HUD and the score line on the play screen. */
  hudObserver: ResizeObserver;
  /** Observe the score line and its halves. */
  lineObserver: ResizeObserver;
}

export function createLayout(host: LayoutHost): Layout {
  const { desk, page, tray, spiral } = host;

  /** The HUD's real height with its margin: player chips wrap to more rows on a narrow board (3–4 players). */
  function hudHeight(): number {
    const hud = host.playing() ? page.querySelector<HTMLElement>('.hud') : null;
    return hud ? Math.max(HUD_H, hud.offsetHeight + 4) : HUD_H;
  }

  /** The score line's real height with its margin: on a small board its text wraps to a second row. */
  function lineHeight(): number {
    const line = host.playing() ? page.querySelector<HTMLElement>('.scoreline') : null;
    return line ? Math.max(LINE_H, line.offsetHeight + 2) : LINE_H;
  }

  /** One row when it fits the board's width, else two ("Hole 1 · Par 4" over "Strokes 0/4 · Total 0"). */
  function fitLine() {
    const line = host.playing() ? page.querySelector<HTMLElement>('.scoreline') : null;
    if (!line) return;
    // Sum the parts' own widths (they never wrap): a centred flex row's scrollWidth misses its overflow on the left.
    const width = (els: Iterable<Element>) => [...els].reduce((w, el) => w + el.getBoundingClientRect().width, 0);
    line.classList.remove('two-rows'); // measure as one row, with the separator between the halves
    if (width(line.children) > line.clientWidth - 4) line.classList.add('two-rows'); // less its 2px side padding
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
    if (spiral.childElementCount !== coils) spiral.innerHTML = '<span class="coil"><svg><use href="#coil"/></svg></span>'.repeat(coils);
    host.fitted();
  }

  return { layout, fitLine, hudObserver, lineObserver };
}
