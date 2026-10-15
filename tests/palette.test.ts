import { describe, expect, it } from 'vitest';
import { PLAYER_COLORS } from '../src/game/game';
import { DEFAULT_PALETTE, KEY_PALETTE, PaletteSetting, loadPalette, parsePalette, playerInk, type PaletteStore } from '../src/game/palette';

/** An in-memory Storage stand-in that records every write. */
function fakeStore(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  const writes: [string, string][] = [];
  const store: PaletteStore = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      writes.push([k, v]);
      data.set(k, v);
    },
  };
  return { store, data, writes };
}

describe('palette setting', () => {
  it('defaults to greyscale', () => {
    expect(DEFAULT_PALETTE).toBe('grey');
    expect(loadPalette(fakeStore().store)).toBe('grey');
    expect(loadPalette(null)).toBe('grey');
    expect(new PaletteSetting(fakeStore().store, true).value).toBe('grey');
  });

  it('persists to and loads from storage', () => {
    const { store, data } = fakeStore();
    const s = new PaletteSetting(store, true);
    expect(s.toggle()).toBe('colour');
    expect(data.get(KEY_PALETTE)).toBe('colour');
    expect(new PaletteSetting(store, true).value).toBe('colour');
    s.set('grey');
    expect(data.get(KEY_PALETTE)).toBe('grey');
    expect(loadPalette(store)).toBe('grey');
  });

  it('falls back to greyscale for invalid stored values', () => {
    for (const junk of ['', 'color', 'COLOUR', '"colour"', 'null', '1', 'true']) {
      expect(loadPalette(fakeStore({ [KEY_PALETTE]: junk }).store), junk).toBe('grey');
    }
    for (const junk of [null, undefined, 1, true, {}, ['colour']]) expect(parsePalette(junk)).toBe('grey');
    expect(parsePalette('colour')).toBe('colour');
  });

  it('falls back to greyscale when storage throws', () => {
    const throwing: PaletteStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const s = new PaletteSetting(throwing, true);
    expect(s.value).toBe('grey');
    expect(s.toggle()).toBe('colour');
  });

  it('never writes storage in a ?play= round, but still switches the look', () => {
    const { store, writes } = fakeStore({ [KEY_PALETTE]: 'grey' });
    const s = new PaletteSetting(store, false);
    expect(s.value).toBe('grey');
    expect(s.toggle()).toBe('colour');
    s.set('colour');
    expect(s.value).toBe('colour');
    expect(writes).toEqual([]);
    expect(loadPalette(store)).toBe('grey');
  });

  it('a ?play= round starts from the saved choice', () => {
    expect(new PaletteSetting(fakeStore({ [KEY_PALETTE]: 'colour' }).store, false).value).toBe('colour');
  });

  it('maps every player colour to its own palette property', () => {
    const inks = PLAYER_COLORS.map(playerInk);
    expect(inks).toEqual(PLAYER_COLORS.map((c, i) => `var(--player-${String(i + 1)}, ${c})`));
    expect(playerInk('#123456')).toBe('#123456');
  });
});
