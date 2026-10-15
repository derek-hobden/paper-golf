import { PLAYER_COLORS } from './game';

/** The look of the game: today's greyscale board, or full colour. No DOM here; main.ts applies it. */
export type Palette = 'grey' | 'colour';

export const DEFAULT_PALETTE: Palette = 'grey';
export const KEY_PALETTE = 'paper-golf:palette:v1';

/** The slice of `Storage` the setting needs, so tests can pass a plain fake. */
export interface PaletteStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A stored value read back: only the two known palettes; anything else (missing, junk, old) is greyscale. */
export function parsePalette(v: unknown): Palette {
  return v === 'grey' || v === 'colour' ? v : DEFAULT_PALETTE;
}

/** The saved palette, or greyscale when storage is missing, unreadable or holds junk. */
export function loadPalette(store: PaletteStore | null): Palette {
  try {
    return parsePalette(store?.getItem(KEY_PALETTE));
  } catch {
    return DEFAULT_PALETTE;
  }
}

/**
 * The player's palette choice. `persist: false` (a ?play= deep-link round) still switches the look for this page
 * but never writes storage, so a link can't change the player's saved setting.
 */
export class PaletteSetting {
  private current: Palette;

  constructor(
    private readonly store: PaletteStore | null,
    private readonly persist: boolean,
  ) {
    this.current = loadPalette(store);
  }

  get value(): Palette {
    return this.current;
  }

  set(p: Palette): void {
    this.current = p;
    if (!this.persist) return;
    try {
      this.store?.setItem(KEY_PALETTE, p);
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
  }

  toggle(): Palette {
    this.set(this.current === 'grey' ? 'colour' : 'grey');
    return this.current;
  }
}

/**
 * The CSS colour to draw a player's ink with. Saved rounds store the greyscale-era hex; the known ones map to a
 * per-palette custom property (`--player-1`..`--player-4`, defined in style.css) so a palette switch recolours
 * everything already drawn. Unknown colours are used as they are.
 */
export function playerInk(color: string): string {
  const i = PLAYER_COLORS.indexOf(color);
  return i < 0 ? color : `var(--player-${String(i + 1)}, ${color})`;
}
