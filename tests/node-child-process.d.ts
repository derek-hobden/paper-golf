// tsconfig loads browser types only (no @types/node); declare the Node APIs the tests use.
declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: readonly string[],
    options: { encoding: 'utf8'; timeout?: number },
  ): { status: number | null; stdout: string; stderr: string };
  export function execFileSync(file: string, args: readonly string[], options: { encoding: 'utf8' }): string;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
  export function mkdtempSync(prefix: string): string;
  export function mkdirSync(path: string): void;
}

declare module 'node:process' {
  export const argv: string[];
  export const stderr: { write(chunk: string): void };
  export const stdout: { write(chunk: string): void };
  export function exit(code?: number): never;
}

declare module 'node:url' {
  export function pathToFileURL(path: string): URL;
}
