/** Checked DOM lookups: a missing element is a markup bug, so fail loudly instead of returning null. */

import { must } from '../engine/assert';

/** The element with this id. Throws if it is not in the document. */
export function byId(id: string): HTMLElement {
  return must(document.getElementById(id) ?? undefined, `missing #${id}`);
}

/** The canvas with this id. Throws if it is not in the document, or is not a canvas. */
export function canvasById(id: string): HTMLCanvasElement {
  const e = byId(id);
  if (!(e instanceof HTMLCanvasElement)) throw new Error(`#${id} is not a canvas`);
  return e;
}

/** The first element under `root` matching `selector`. Throws if there is none. */
export function query(root: ParentNode, selector: string): Element {
  return must(root.querySelector(selector) ?? undefined, `missing ${selector}`);
}
