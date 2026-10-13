/** Checked DOM lookups: a missing element is a markup bug, so fail loudly instead of returning null. */

import { must } from '../engine/assert';

/** The element with this id. Throws if it is not in the document. */
export function byId(id: string): HTMLElement {
  return must(document.getElementById(id) ?? undefined, `missing #${id}`);
}

/** The first element under `root` matching `selector`. Throws if there is none. */
export function query(root: ParentNode, selector: string): Element {
  return must(root.querySelector(selector) ?? undefined, `missing ${selector}`);
}
