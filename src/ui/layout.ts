/**
 * Fitting the notebook to the screen. CSS sizes everything (style.css "layout": the desk grid and the board from its
 * container); this only does what CSS can't: the layout mode classes, the score line's rows, the spiral's loops, and
 * re-placing what JS draws over the board (the die, the wind canvas) whenever the notebook's real box changes.
 * `src/main.ts` wires it to the screens.
 */

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
  notebook: HTMLElement;
  page: HTMLElement;
  spiral: HTMLElement;
  /** The play screen is showing (its HUD and score line are on the page). */
  playing(): boolean;
  /** Runs at the end of every layout(): re-place the die and the wind canvas. */
  fitted(): void;
}

export interface Layout {
  /** Set the layout mode, the score line's rows and the spiral, then re-place the die and the wind canvas. */
  layout: () => void;
  /** One row when it fits the page's width, else two ("Hole 1 · Par 4" over "Strokes 0/4 · Total 0"). */
  fitLine: () => void;
}

export function createLayout(host: LayoutHost): Layout {
  const { desk, notebook, page, spiral } = host;

  /** One row when it fits the page's width, else two ("Hole 1 · Par 4" over "Strokes 0/4 · Total 0"). */
  function fitLine() {
    const line = host.playing() ? page.querySelector<HTMLElement>('.scoreline') : null;
    if (!line) return;
    // Sum the parts' own widths (they never wrap): a centred flex row's scrollWidth misses its overflow on the left.
    const width = (els: Iterable<Element>) => [...els].reduce((w, el) => w + el.getBoundingClientRect().width, 0);
    line.classList.remove('two-rows'); // measure as one row, with the separator between the halves
    if (width(line.children) > line.clientWidth - 4) line.classList.add('two-rows'); // less its 2px side padding
  }

  function layout() {
    // The mode is decided by style.css's media queries (--desk-mode); the classes let the rest of the CSS follow it.
    const mode = getComputedStyle(document.documentElement).getPropertyValue('--desk-mode').trim();
    desk.classList.toggle('wide', mode === 'wide' || mode === 'short');
    desk.classList.toggle('short', mode === 'short');
    desk.classList.toggle('compact', mode === 'compact');
    fitLine();
    // One loop of wire per 25px of the page, between the spiral's 14px insets.
    const coils = Math.max(8, Math.floor((notebook.offsetWidth - 28) / 25));
    if (spiral.childElementCount !== coils) spiral.innerHTML = '<span class="coil"><svg><use href="#coil"/></svg></span>'.repeat(coils);
    host.fitted();
  }

  /**
   * The notebook grows or shrinks with what CSS fits around it: the tray's status wrapping, the HUD's chips, the score
   * line's rows, late web fonts. Re-run layout() on the next frame. It only changes the notebook's size when fitLine
   * picks different rows, and the next call picks the same rows for the same text and room, so this settles.
   */
  deferredObserver(layout).observe(notebook);
  // Late web fonts widen the score line's text without resizing the notebook: pick its rows again.
  document.fonts.addEventListener('loadingdone', fitLine);

  return { layout, fitLine };
}
