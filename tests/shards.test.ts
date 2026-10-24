import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * The CI and staging matrices (chrome × 4, iphone-webkit × 3) have to be the whole project
 * exactly once. Playwright's own shard split is what those jobs run; this is the check that
 * a new spec did not fall between two shards or land in both.
 */

function listed(project: string, shard: string | undefined): string[] {
  const args = ['playwright', 'test', '--list', `--project=${project}`];
  if (shard !== undefined) args.push(`--shard=${shard}`);
  const result = spawnSync('npx', args, { encoding: 'utf8', timeout: 20_000 });
  const detail = result.stderr.length > 0 ? result.stderr : result.stdout;
  expect(result.status, detail).toBe(0);
  return result.stdout
    .split('\n')
    .filter((line) => line.includes('›'))
    .sort();
}

function shardCover(project: string, shards: readonly string[]): void {
  const full = listed(project, undefined);
  const parts = shards.flatMap((shard) => listed(project, shard));
  expect(new Set(parts).size, `${project} lists a test in two shards`).toBe(parts.length);
  expect(parts.slice().sort(), `${project} shards dropped or added a test`).toEqual(full);
  expect(full.length, `${project} listed nothing`).toBeGreaterThan(0);
}

describe('playwright shards', () => {
  it('covers chrome exactly once', () => {
    shardCover('chrome', ['1/4', '2/4', '3/4', '4/4']);
  });

  it('covers iphone-webkit exactly once', () => {
    shardCover('iphone-webkit', ['1/3', '2/3', '3/3']);
  });
});
