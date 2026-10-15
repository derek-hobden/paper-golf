import { PLAYER_COLORS } from './game';

/**
 * Where the old greyscale / colour toggle saved its choice. The game is always in colour now: the value is never
 * read, only removed (`forgetLegacyPalette`), so a stale "grey" from an old visit changes nothing.
 */
export const LEGACY_PALETTE_KEY = 'paper-golf:palette:v1';

/** The slice of `Storage` the cleanup needs, so tests can pass a plain fake. */
export interface LegacyStore {
  removeItem(key: string): void;
}

/** Drop the old palette setting from storage; missing or throwing storage is fine (there is nothing to undo). */
export function forgetLegacyPalette(store: LegacyStore | null): void {
  try {
    store?.removeItem(LEGACY_PALETTE_KEY);
  } catch {
    /* storage unavailable: the old value is ignored anyway */
  }
}

/**
 * The CSS colour to draw a player's ink with. Saved rounds store the hex from PLAYER_COLORS; the known ones map to
 * a custom property (`--player-1`..`--player-4`, defined in style.css). Unknown colours are used as they are.
 */
export function playerInk(color: string): string {
  const i = PLAYER_COLORS.indexOf(color);
  return i < 0 ? color : `var(--player-${String(i + 1)}, ${color})`;
}
