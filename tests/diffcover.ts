import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

/** Changed-line coverage for src/engine and src/game. 80% of coverable added lines must be hit. */

export interface LineScore {
  coverable: number;
  covered: number;
  /** Integer percent. 100 when nothing coverable changed. */
  percent: number;
  /** The coverage file was missing while added lines still needed it. */
  missing: boolean;
}

interface StatementSpan {
  start: { line: number };
  end: { line: number };
}

interface FileCoverage {
  path?: string;
  statementMap?: Record<string, StatementSpan>;
  s?: Record<string, number>;
}

const SCOPE = /^(src\/engine\/|src\/game\/).*\.ts$/;

export function inScope(path: string): boolean {
  return SCOPE.test(path) && !path.endsWith('.test.ts');
}

/** Added lines (1-based) per repo path, from a unified diff. */
export function addedLines(diff: string): Map<string, number[]> {
  const lines = new Map<string, number[]>();
  let file: string | null = null;
  let next = 0;
  let hunk = false;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const spec = raw.slice(4);
      file = null;
      hunk = false;
      if (spec === '/dev/null') continue;
      const path = spec.startsWith('b/') ? spec.slice(2) : spec;
      if (inScope(path)) file = path;
      continue;
    }
    if (raw.startsWith('@@')) {
      const plus = /\+(\d+)/.exec(raw);
      const start = plus?.[1];
      next = start === undefined ? 0 : Number(start);
      hunk = file !== null && start !== undefined;
      continue;
    }
    if (!hunk || file === null) continue;
    if (raw.startsWith('+')) {
      const bucket = lines.get(file) ?? [];
      bucket.push(next);
      lines.set(file, bucket);
      next += 1;
    } else if (raw.startsWith('-') || raw.startsWith('\\')) {
      // A deletion does not advance the new-file line. "\ No newline" neither.
    } else {
      next += 1;
    }
  }
  return lines;
}

function isCommentOrBlank(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed === '' ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('*/')
  );
}

function fileCoverage(report: Record<string, FileCoverage>, path: string): FileCoverage | undefined {
  if (path in report) return report[path];
  for (const [key, value] of Object.entries(report)) {
    if (key.endsWith(`/${path}`) || value.path?.endsWith(`/${path}`) || value.path === path) return value;
  }
  return undefined;
}

/**
 * Score added lines against an Istanbul/v8 coverage JSON object.
 * `coverage` null means the file was not produced. Lines that are not statements
 * (comments, blanks, types) do not count when the file is in the report.
 * A changed file the report never mentions counts each non-comment added line as uncovered.
 */
export function scoreDiff(diff: string, coverage: Record<string, FileCoverage> | null): LineScore {
  const added = addedLines(diff);
  let coverable = 0;
  let covered = 0;
  let uncoveredFile = false;
  for (const [path, lineNos] of added) {
    const file = coverage === null ? undefined : fileCoverage(coverage, path);
    if (file?.statementMap === undefined || file.s === undefined) {
      for (const lineNo of lineNos) {
        const text = textAt(diff, path, lineNo);
        if (text !== undefined && !isCommentOrBlank(text)) {
          coverable += 1;
          uncoveredFile = true;
        }
      }
      continue;
    }
    for (const lineNo of lineNos) {
      const hits = statementsOnLine(file, lineNo);
      if (hits.length === 0) continue;
      coverable += 1;
      if (hits.every((hit) => hit > 0)) covered += 1;
    }
  }
  const missing = coverage === null && uncoveredFile;
  const percent = coverable === 0 ? 100 : Math.floor((covered * 100) / coverable);
  return { coverable, covered, percent, missing };
}

export function passes(score: LineScore): boolean {
  return !score.missing && score.covered * 100 >= score.coverable * 80;
}

function statementsOnLine(file: FileCoverage, line: number): number[] {
  const map = file.statementMap ?? {};
  const hits = file.s ?? {};
  const found: number[] = [];
  for (const [id, span] of Object.entries(map)) {
    if (span.start.line <= line && line <= span.end.line) found.push(hits[id] ?? 0);
  }
  return found;
}

/** The added text for a line, used only when the file has no coverage entry. */
function textAt(diff: string, path: string, lineNo: number): string | undefined {
  const lines = addedLines(diff).get(path);
  if (lines === undefined || !lines.includes(lineNo)) return undefined;
  let file: string | null = null;
  let next = 0;
  let hunk = false;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const spec = raw.slice(4);
      file = null;
      hunk = false;
      if (spec !== '/dev/null') {
        const found = spec.startsWith('b/') ? spec.slice(2) : spec;
        if (found === path) file = found;
      }
      continue;
    }
    if (raw.startsWith('@@')) {
      const plus = /\+(\d+)/.exec(raw);
      const start = plus?.[1];
      next = start === undefined ? 0 : Number(start);
      hunk = file !== null && start !== undefined;
      continue;
    }
    if (!hunk || file === null) continue;
    if (raw.startsWith('+')) {
      if (next === lineNo) return raw.slice(1);
      next += 1;
    } else if (!raw.startsWith('-') && !raw.startsWith('\\')) {
      next += 1;
    }
  }
  return undefined;
}

function main(): void {
  const base = argv[2];
  const head = argv[3];
  const coveragePath = argv[4] ?? 'coverage/coverage-final.json';
  if (base === undefined || head === undefined) {
    stderr.write('usage: diffcover.ts <base> <head> [coverage.json]\n');
    exit(2);
  }
  const diff = execFileSync('git', ['diff', '-U0', base, head, '--', 'src/engine', 'src/game'], { encoding: 'utf8' });
  const coverage = existsSync(coveragePath)
    ? (JSON.parse(readFileSync(coveragePath, 'utf8')) as Record<string, FileCoverage>)
    : null;
  const score = scoreDiff(diff, coverage);
  stdout.write(`coverable=${String(score.coverable)}\n`);
  stdout.write(`covered=${String(score.covered)}\n`);
  stdout.write(`percent=${String(score.percent)}\n`);
  if (!passes(score)) {
    const why = score.missing
      ? 'coverage file missing for changed engine/game lines'
      : `changed-line coverage ${String(score.percent)}% is under 80%`;
    stderr.write(`${why}\n`);
    exit(1);
  }
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) main();
