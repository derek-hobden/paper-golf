// tsconfig loads browser types only (no @types/node); declare the one Node API the tests use.
declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: readonly string[],
    options: { encoding: 'utf8' },
  ): { status: number | null; stdout: string; stderr: string };
}
