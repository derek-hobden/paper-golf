// tsconfig loads browser types only (no @types/node); declare the Node APIs the tests use.
declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: readonly string[],
    options: { encoding: 'utf8' },
  ): { status: number | null; stdout: string; stderr: string };
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
