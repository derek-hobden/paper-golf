import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { at } from './helpers';

/**
 * Dependabot alert 1: qs below 6.16.0 carries remotely triggerable denial-of-service advisories
 * (GHSA-q8mj-m7cp-5q26, the `qs.stringify` crash on null entries in comma-format arrays, plus
 * GHSA-x5fp-wj9c-mxmx and GHSA-4mjr-xmp4-gh2g). qs reaches the tree only as a dev dependency,
 * @stryker-mutator/core -> typed-rest-client -> qs, and typed-rest-client 2.3.1 pins `"qs": "6.15.1"`
 * exactly, so no in-range update of a parent moves it (`npm update qs`, `npm update typed-rest-client`,
 * `npm update @stryker-mutator/core` and `npm audit fix` all leave 6.15.1 in place). The `overrides`
 * entry in package.json is the only thing holding qs at a patched version: a lockfile regenerated
 * without it resolves the vulnerable 6.15.1 again.
 */
const qsOverride = '^6.16.1';
/** The first qs release outside every advisory range above. */
const qsFloor = '6.16.0';

/** The plain `major.minor.patch` numbers npm writes in the lockfile. */
function release(version: string): number[] {
  const numbers = version.split('.').map(Number);
  if (numbers.length !== 3 || numbers.some((n) => !Number.isInteger(n))) {
    throw new Error(`not a plain major.minor.patch version: ${version}`);
  }
  return numbers;
}

/** Whether `version` is at least `floor`, both plain releases. */
function atLeast(version: string, floor: string): boolean {
  const left = release(version);
  const right = release(floor);
  for (let i = 0; i < 3; i++) {
    const l = at(left, i);
    const r = at(right, i);
    if (l !== r) return l > r;
  }
  return true;
}

function json(path: string): object {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`${path} is not an object`);
  return parsed;
}

function field(from: object, key: string, what: string): object {
  const value: unknown = Reflect.get(from, key);
  if (typeof value !== 'object' || value === null) throw new Error(`no ${what}`);
  return value;
}

/** Every version of `name` the lockfile resolves, at its own path and nested under a dependent. */
function lockedVersions(name: string): { path: string; version: string }[] {
  const packages = field(json('package-lock.json'), 'packages', 'packages in package-lock.json');
  const found: { path: string; version: string }[] = [];
  for (const path of Object.keys(packages)) {
    if (path !== `node_modules/${name}` && !path.endsWith(`/node_modules/${name}`)) continue;
    const entry: unknown = Reflect.get(packages, path);
    if (typeof entry !== 'object' || entry === null || !('version' in entry) || typeof entry.version !== 'string') {
      throw new Error(`no version for ${path}`);
    }
    found.push({ path, version: entry.version });
  }
  return found;
}

describe('qs stays patched (Dependabot alert 1)', () => {
  it('package.json overrides qs', () => {
    const overrides = field(json('package.json'), 'overrides', 'overrides in package.json');
    expect(Reflect.get(overrides, 'qs')).toBe(qsOverride);
  });

  it('every qs in the lockfile is at least the patched release', () => {
    const locked = lockedVersions('qs');
    expect(locked.length).toBeGreaterThan(0);
    for (const { path, version } of locked) {
      expect(atLeast(version, qsFloor), `${path} is qs ${version}, below ${qsFloor}`).toBe(true);
    }
  });
});

describe('release comparison', () => {
  it('orders each part numerically', () => {
    expect(atLeast('6.16.1', '6.16.0')).toBe(true);
    expect(atLeast('6.16.0', '6.16.0')).toBe(true);
    expect(atLeast('6.15.1', '6.16.0')).toBe(false);
    expect(atLeast('6.9.0', '6.16.0')).toBe(false);
    expect(atLeast('7.0.0', '6.16.0')).toBe(true);
    expect(atLeast('5.99.99', '6.16.0')).toBe(false);
  });

  it('rejects a version that is not a plain release', () => {
    expect(() => atLeast('6.16', '6.16.0')).toThrow('not a plain major.minor.patch version');
    expect(() => atLeast('6.16.1-beta.1', '6.16.0')).toThrow('not a plain major.minor.patch version');
  });
});
