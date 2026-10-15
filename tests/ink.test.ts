import { describe, expect, it } from 'vitest';
import { PLAYER_COLORS } from '../src/game/game';
import { LEGACY_PALETTE_KEY, forgetLegacyPalette, playerInk, type LegacyStore } from '../src/game/ink';
import * as ink from '../src/game/ink';

describe('colour only (no greyscale toggle)', () => {
  it('has no palette setting left to read or toggle', () => {
    expect(Object.keys(ink).sort()).toEqual(['LEGACY_PALETTE_KEY', 'forgetLegacyPalette', 'playerInk']);
  });

  it('removes a stale stored greyscale choice from an old visit', () => {
    for (const old of ['grey', 'colour', 'purple']) {
      const data = new Map([
        [LEGACY_PALETTE_KEY, old],
        ['paper-golf:other', 'kept'],
      ]);
      const store: LegacyStore = { removeItem: (k) => data.delete(k) };
      forgetLegacyPalette(store);
      expect(data.has(LEGACY_PALETTE_KEY)).toBe(false);
      expect(data.get('paper-golf:other')).toBe('kept');
    }
  });

  it('never throws on missing or throwing storage', () => {
    expect(() => {
      forgetLegacyPalette(null);
    }).not.toThrow();
    const throwing: LegacyStore = {
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(() => {
      forgetLegacyPalette(throwing);
    }).not.toThrow();
  });

  it('maps every player colour to its own ink property', () => {
    const inks = PLAYER_COLORS.map(playerInk);
    expect(inks).toEqual(PLAYER_COLORS.map((c, i) => `var(--player-${String(i + 1)}, ${c})`));
    expect(playerInk('#123456')).toBe('#123456');
  });
});
