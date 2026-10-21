import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Production's @quick smoke is what rolls a bad deploy back. Every one of those tests has to
// fail on a browser console error or an uncaught page error, or the rollback never fires.
const specs = readdirSync('e2e').filter((name) => name.endsWith('.spec.ts'));

describe('@quick console and page errors', () => {
  it('watches at least the start page and the solo round', () => {
    const quick = specs.filter((name) => readFileSync(`e2e/${name}`, 'utf8').includes('@quick'));
    expect(quick).toContain('smoke.spec.ts');
    expect(quick).toContain('journey.spec.ts');
  });

  it.each(specs)('%s fails the test when the page logs an error', (name) => {
    const text = readFileSync(`e2e/${name}`, 'utf8');
    if (!text.includes('@quick')) return;
    expect(text, name).toContain('watchConsole(');
    expect(text, name).toContain('expect(errors).toEqual([])');
  });
});
