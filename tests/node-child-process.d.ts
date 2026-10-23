// tsconfig loads browser types only (no @types/node); declare the Node APIs the tests use.
declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: readonly string[],
    options: { encoding: 'utf8'; timeout?: number },
  ): { status: number | null; stdout: string; stderr: string };
  export function execFileSync(file: string, args: readonly string[], options: { encoding: 'utf8' }): string;
  // Asynchronous, so an in-process server (tests/hooks.test.ts) can answer the child while it runs.
  export function execFile(
    file: string,
    args: readonly string[],
    options: { encoding: 'utf8'; env: Record<string, string | undefined>; timeout: number },
    callback: (error: { code?: number; message: string } | null, stdout: string, stderr: string) => void,
  ): void;
}

declare module 'node:http' {
  export interface ServerRequest {
    method?: string;
    headers: Record<string, string | undefined>;
    setEncoding(encoding: 'utf8'): void;
    on(event: 'data', listener: (chunk: string) => void): void;
    on(event: 'end', listener: () => void): void;
  }
  export interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(body: string): void;
  }
  export interface Server {
    listen(port: number, host: string, listener: () => void): void;
    address(): { port: number } | string | null;
    close(listener: () => void): void;
  }
  export function createServer(handler: (request: ServerRequest, response: ServerResponse) => void): Server;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
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
