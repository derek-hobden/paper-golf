import { describe, expect, it } from 'vitest';
import { ELEVATION_LAYERS, allRoundLine, elevationFilters, elevationShortTag, elevationTag } from '../src/ui/elevationlook';

const at = { x: 0, y: 0 };

describe('elevation look', () => {
  it('words the focused tag and the compact one by the climb and the change', () => {
    expect(elevationTag({ change: -1, climb: 1, plain: at })).toBe('+1 uphill · 1 shorter');
    expect(elevationTag({ change: 1, climb: -1, plain: at })).toBe('−1 downhill · 1 longer');
    expect(elevationTag({ change: 2, climb: -2, plain: at })).toBe('−2 downhill · 2 longer');
    expect(elevationTag({ change: -2, climb: 2, plain: at })).toBe('+2 uphill · 2 shorter');
    expect(elevationShortTag({ change: -1, climb: 1, plain: at })).toBe('1 shorter');
    expect(elevationShortTag({ change: 2, climb: -2, plain: at })).toBe('2 longer');
  });

  it('says a shared change once for the tray', () => {
    expect(allRoundLine(1)).toBe('Downhill all round · 1 longer');
    expect(allRoundLine(-2)).toBe('Uphill all round · 2 shorter');
  });

  it('defines every filter a layer names, and draws no lines, hatching or stipple', () => {
    const defs = elevationFilters();
    for (const layer of [...ELEVATION_LAYERS.raised, ...ELEVATION_LAYERS.low]) {
      if ('filter' in layer) expect(defs).toContain(`id="${layer.filter}"`);
    }
    expect(defs).not.toMatch(/<pattern|<line|stroke/u);
  });
});
