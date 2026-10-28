export const MODEL: string;
export const MAX_DIFF_CHARS: number;
export const ALLOWED_BOTS: readonly string[];
export const DIFF_START: string;
export const LOOP_GUARD: string;

export type FindingKind = 'bug' | 'security' | 'failing' | 'rule' | 'scope' | 'description' | 'other';

export function authorAllowed(login: string, type: string): boolean;
export function truncateDiff(diff: string): string;
export function plainApiError(status: number, bodyText: string, key?: string): string;

export interface Finding {
  severity: 'BLOCKING' | 'NIT';
  kind: FindingKind;
  path: string;
  line: number;
  body: string;
}

export interface PriorThread {
  path: string;
  line: number;
  body: string;
  severity: 'BLOCKING' | 'NIT';
  addressed: boolean;
  url?: string;
}

export interface Verdict {
  blocking: number;
  summary: string;
  findings: Finding[];
}

export function parseVerdict(text: string): Verdict;

export interface PromptInput {
  rules: { claude: string; readme: string; review: string };
  title: string;
  body: string;
  author: string;
  diff: string;
  prior?: PriorThread[];
}

export function priorThreads(comments: unknown, resolvedIds?: ReadonlySet<number>): PriorThread[];

export function settleFindings(
  findings: Finding[],
  threads: PriorThread[],
): {
  toPost: Finding[];
  blocking: number;
  open: (Finding & { severity: 'BLOCKING'; url: string })[];
  fixed: { kind: string; path: string; body: string }[];
};

export function buildPrompt(input: PromptInput): string;

export type ReviewResult =
  | {
      ok: true;
      blocking: number;
      summary: string;
      commentsPosted: number;
      /** Set when the diff was cut at MAX_DIFF_CHARS: the review covered part of the change. */
      incomplete?: true;
      reviewedChars?: number;
      totalChars?: number;
    }
  | { ok: false; marker: 'api' | 'bot' | 'secret' | 'verdict' | 'other'; message: string };

export interface ReviewOptions {
  base: string;
  head: string;
  title?: string;
  body?: string;
  author?: string;
  authorType?: string;
  apiKey?: string;
  repo?: string;
  pr?: string;
  token?: string;
  cwd?: string;
  verdictPath?: string;
  findingsPath?: string;
  round?: number;
  fetchImpl?: typeof fetch;
  git?: (args: readonly string[], cwd: string) => string;
}

export function review(options: ReviewOptions): Promise<ReviewResult>;
