// tsconfig loads browser types only (no @types/node); declare the Node APIs the tests use.
declare module 'node:child_process' {
  type Stdio = 'pipe' | 'ignore' | 'inherit';
  interface RunOptions {
    encoding: 'utf8';
    cwd?: string;
    input?: string;
    env?: Record<string, string | undefined>;
    stdio?: Stdio | readonly Stdio[];
    timeout?: number;
  }
  export function spawnSync(
    command: string,
    args: readonly string[],
    options: RunOptions,
  ): { status: number | null; stdout: string; stderr: string };
  export function execFileSync(file: string, args: readonly string[], options: RunOptions): string;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string, options?: { mode?: number }): void;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
  export function mkdtempSync(prefix: string): string;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function chmodSync(path: string, mode: number): void;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
}

declare module 'node:process' {
  export const argv: string[];
  export const env: Record<string, string | undefined>;
  export const stderr: { write(chunk: string): void };
  export const stdout: { write(chunk: string): void };
  export function exit(code?: number): never;
}

declare module 'node:url' {
  export function pathToFileURL(path: string): URL;
}
