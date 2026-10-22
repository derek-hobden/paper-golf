import { execFile, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { at } from './helpers';

// tsconfig types are vite/client only, same as vite.config.ts.
declare const process: { env: Record<string, string | undefined> };

/**
 * scripts/hooks/notify-bot.sh: the Stop / Notification / SessionEnd hook that POSTs the session event to the
 * owning bot. Every case here runs the real script against a real HTTP receiver on localhost — no fake curl —
 * so the payload, the Authorization header and the 5-second cap are the ones a session would send.
 */

/** Repo root from this file's URL, so the test does not need node:path. */
function repoRoot(): string {
  const path = decodeURIComponent(new URL(import.meta.url).pathname);
  const cut = path.lastIndexOf('/tests/');
  if (cut < 0) throw new Error(`unexpected test url ${import.meta.url}`);
  return path.slice(0, cut);
}

const ROOT = repoRoot();
const SCRIPT = `${ROOT}/scripts/hooks/notify-bot.sh`;
const SETTINGS = `${ROOT}/.claude/settings.json`;
const CACHE = `${ROOT}/node_modules/.cache/pg-hooks-test`;
// The fixture repo's own name is the cwd_repo the payload must carry.
const FIXTURE_REPO = 'paper-golf-fixture';
const FIXTURE_BRANCH = 'chore/session-event-hooks';
const KEY = 'grokbot-test-key';
// The payload's whole shape. Nothing else may be in it: no environment values, no file contents, no secrets.
const FIELDS = [
  'session_id',
  'remote_session_id',
  'branch',
  'event',
  'event_id',
  'event_at',
  'cwd_repo',
  'last_message',
] as const;

function run(cmd: string, args: string[]): string {
  const done = spawnSync(cmd, args, { encoding: 'utf8' });
  if (done.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${done.stderr}`);
  return done.stdout;
}

function git(dir: string, args: string[]): void {
  run('git', ['-C', dir, ...args]);
}

/** A one-commit git repo on a known branch, so `branch` and `cwd_repo` are exact. */
function fixtureRepo(): string {
  const dir = `${CACHE}/${FIXTURE_REPO}`;
  run('rm', ['-rf', dir]);
  run('mkdir', ['-p', dir]);
  git(dir, ['init', '-q', '-b', FIXTURE_BRANCH]);
  git(dir, ['config', 'user.email', 'fixture@example.com']);
  git(dir, ['config', 'user.name', 'Fixture']);
  writeFileSync(`${dir}/README.md`, 'fixture\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-q', '-m', 'fixture']);
  return dir;
}

let counter = 0;
function tempFile(name: string, contents: string): string {
  run('mkdir', ['-p', CACHE]);
  counter += 1;
  const path = `${CACHE}/${String(counter)}-${name}`;
  writeFileSync(path, contents);
  return path;
}

/**
 * A session transcript: one user turn, then one assistant turn per message, then an assistant turn that is
 * only a tool call (no text), which the script must look past to the last message with words in it.
 */
function transcript(messages: string[]): string {
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'go on then' } }),
    ...messages.map((text) =>
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }),
    ),
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
    }),
    '',
  ];
  return tempFile('transcript.jsonl', lines.join('\n'));
}

interface Received {
  method: string;
  auth: string;
  contentType: string;
  body: string;
}

/** 'ok' answers 200, 'error' answers 500, 'silent' never answers at all (only the script's cap ends it). */
type Behaviour = 'ok' | 'error' | 'silent';

interface Receiver {
  url: string;
  got: Received[];
  close: () => Promise<void>;
}

async function receiver(behaviour: Behaviour): Promise<Receiver> {
  const got: Received[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      got.push({
        method: request.method ?? '',
        auth: request.headers.authorization ?? '',
        contentType: request.headers['content-type'] ?? '',
        body,
      });
      if (behaviour === 'silent') return;
      response.statusCode = behaviour === 'ok' ? 200 : 500;
      response.setHeader('Connection', 'close');
      response.end('');
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the receiver got no port');
  return {
    url: `http://127.0.0.1:${String(address.port)}/session-events`,
    got,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

interface Done {
  status: number;
  stdout: string;
  stderr: string;
  ms: number;
}

/** The hook's environment: this process's, minus `drop` (left out entirely, not emptied), plus `set`. */
function hookEnv(set: Record<string, string>, drop: string[] = []): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(process.env)) if (!drop.includes(name)) env[name] = value;
  for (const [name, value] of Object.entries(set)) env[name] = value;
  return env;
}

/** Run the script with `input` on stdin, the way a hook does, and time it. */
async function notify(input: string, env: Record<string, string | undefined>): Promise<Done> {
  const path = tempFile('hook.json', input);
  const started = Date.now();
  return await new Promise<Done>((resolve) => {
    execFile(
      'bash',
      ['-c', 'exec bash "$0" <"$1"', SCRIPT, path],
      { encoding: 'utf8', env, timeout: 25_000 },
      (error, stdout, stderr) => {
        resolve({ status: error === null ? 0 : (error.code ?? -1), stdout, stderr, ms: Date.now() - started });
      },
    );
  });
}

/** A Stop hook's JSON, as Claude Code sends it. */
function stopHook(fields: { session: string; transcriptPath: string; cwd: string; event?: string }): string {
  return JSON.stringify({
    session_id: fields.session,
    transcript_path: fields.transcriptPath,
    cwd: fields.cwd,
    hook_event_name: fields.event ?? 'Stop',
    permission_mode: 'default',
  });
}

interface Payload {
  session_id: string;
  remote_session_id: string;
  branch: string;
  event: string;
  event_id: string;
  event_at: string;
  cwd_repo: string;
  last_message: string;
}

function object(body: string): object {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`the payload is not an object: ${body}`);
  return parsed;
}

function field(from: object, key: string): string {
  const value: unknown = Reflect.get(from, key);
  if (typeof value !== 'string') throw new Error(`payload field ${key} is not a string`);
  return value;
}

function payload(body: string): Payload {
  const parsed = object(body);
  return {
    session_id: field(parsed, 'session_id'),
    remote_session_id: field(parsed, 'remote_session_id'),
    branch: field(parsed, 'branch'),
    event: field(parsed, 'event'),
    event_id: field(parsed, 'event_id'),
    event_at: field(parsed, 'event_at'),
    cwd_repo: field(parsed, 'cwd_repo'),
    last_message: field(parsed, 'last_message'),
  };
}

describe('the session-event hook', () => {
  it('posts the session, the event and the last message the moment the session stops', async () => {
    const repo = fixtureRepo();
    const bot = await receiver('ok');
    try {
      const done = await notify(
        stopHook({ session: 'f0f1-abc', transcriptPath: transcript(['an earlier turn', 'Waiting on you.']), cwd: repo }),
        hookEnv({ GROKBOT_EVENTS_URL: bot.url, GROKBOT_EVENTS_KEY: KEY, CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_0123' }),
      );
      expect(done.status).toBe(0);
      // A hook's output lands in the session: this one says nothing, ever.
      expect(done.stdout).toBe('');
      expect(done.stderr).toBe('');

      expect(bot.got).toHaveLength(1);
      const sent = at(bot.got, 0);
      expect(sent.method).toBe('POST');
      expect(sent.auth).toBe(`Bearer ${KEY}`);
      expect(sent.contentType).toBe('application/json');
      expect(Object.keys(object(sent.body)).sort()).toEqual([...FIELDS].sort());

      const body = payload(sent.body);
      expect(body.session_id).toBe('f0f1-abc');
      expect(body.remote_session_id).toBe('cse_0123');
      expect(body.branch).toBe(FIXTURE_BRANCH);
      expect(body.event).toBe('Stop');
      expect(body.cwd_repo).toBe(FIXTURE_REPO);
      expect(body.last_message).toBe('Waiting on you.');
      expect(body.event_id).toMatch(/^[0-9a-f]{64}$/);
      expect(body.event_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } finally {
      await bot.close();
    }
  });

  it('reports a Notification and a SessionEnd under their own names', async () => {
    const repo = fixtureRepo();
    const bot = await receiver('ok');
    try {
      for (const event of ['Notification', 'SessionEnd']) {
        const done = await notify(
          stopHook({ session: 's', transcriptPath: transcript(['A question for you.']), cwd: repo, event }),
          hookEnv({ GROKBOT_EVENTS_URL: bot.url, GROKBOT_EVENTS_KEY: KEY }, ['CLAUDE_CODE_REMOTE_SESSION_ID']),
        );
        expect(done.status).toBe(0);
      }
      expect(bot.got.map((sent) => payload(sent.body).event)).toEqual(['Notification', 'SessionEnd']);
      // No claude.ai session (a local run): the field is there and empty, never missing.
      expect(payload(at(bot.got, 0).body).remote_session_id).toBe('');
    } finally {
      await bot.close();
    }
  });

  it('gives one event one id, so a repeated delivery is a duplicate the receiver can drop', async () => {
    const repo = fixtureRepo();
    const bot = await receiver('ok');
    try {
      const hook = stopHook({ session: 'dedupe', transcriptPath: transcript(['Same state, same event.']), cwd: repo });
      const env = hookEnv({ GROKBOT_EVENTS_URL: bot.url, GROKBOT_EVENTS_KEY: KEY });
      await notify(hook, env);
      await notify(hook, env);
      await notify(stopHook({ session: 'dedupe', transcriptPath: transcript(['Same state, same event.', 'Now a new one.']), cwd: repo }), env);

      const ids = bot.got.map((sent) => payload(sent.body).event_id);
      expect(ids).toHaveLength(3);
      expect(at(ids, 1)).toBe(at(ids, 0));
      expect(at(ids, 2)).not.toBe(at(ids, 0));
      // The timestamps are per POST, so the duplicate is caught by the id and not by them.
      expect(payload(at(bot.got, 1).body).event_at).not.toBe('');
    } finally {
      await bot.close();
    }
  });

  it('cuts the last message to 1000 characters', async () => {
    const repo = fixtureRepo();
    const bot = await receiver('ok');
    try {
      const long = 'x'.repeat(1500);
      await notify(
        stopHook({ session: 'long', transcriptPath: transcript([long]), cwd: repo }),
        hookEnv({ GROKBOT_EVENTS_URL: bot.url, GROKBOT_EVENTS_KEY: KEY }),
      );
      const body = payload(at(bot.got, 0).body);
      expect(body.last_message).toHaveLength(1000);
      expect(body.last_message).toBe('x'.repeat(1000));
    } finally {
      await bot.close();
    }
  });

  it('posts an empty last message when the session has no transcript yet', async () => {
    const repo = fixtureRepo();
    const bot = await receiver('ok');
    try {
      const done = await notify(
        stopHook({ session: 'fresh', transcriptPath: `${CACHE}/no-such-transcript.jsonl`, cwd: repo }),
        hookEnv({ GROKBOT_EVENTS_URL: bot.url, GROKBOT_EVENTS_KEY: KEY }),
      );
      expect(done.status).toBe(0);
      expect(bot.got).toHaveLength(1);
      expect(payload(at(bot.got, 0).body).last_message).toBe('');
    } finally {
      await bot.close();
    }
  });

  it('posts nothing and exits 0 when the URL or the key is missing', async () => {
    const repo = fixtureRepo();
    const bot = await receiver('ok');
    try {
      const hook = stopHook({ session: 'unset', transcriptPath: transcript(['Nobody to tell.']), cwd: repo });
      const cases: Record<string, string | undefined>[] = [
        hookEnv({ GROKBOT_EVENTS_KEY: KEY }, ['GROKBOT_EVENTS_URL']),
        hookEnv({ GROKBOT_EVENTS_URL: bot.url }, ['GROKBOT_EVENTS_KEY']),
        hookEnv({}, ['GROKBOT_EVENTS_URL', 'GROKBOT_EVENTS_KEY']),
        hookEnv({ GROKBOT_EVENTS_URL: '', GROKBOT_EVENTS_KEY: '' }),
      ];
      for (const env of cases) {
        const done = await notify(hook, env);
        expect(done.status).toBe(0);
        expect(done.stdout).toBe('');
        expect(done.stderr).toBe('');
      }
      expect(bot.got).toEqual([]);
    } finally {
      await bot.close();
    }
  });

  it('exits 0 when the endpoint answers with an error', async () => {
    const repo = fixtureRepo();
    const bot = await receiver('error');
    try {
      const done = await notify(
        stopHook({ session: 'failing', transcriptPath: transcript(['Still stopping.']), cwd: repo }),
        hookEnv({ GROKBOT_EVENTS_URL: bot.url, GROKBOT_EVENTS_KEY: KEY }),
      );
      expect(done.status).toBe(0);
      expect(done.stdout).toBe('');
      expect(done.stderr).toBe('');
      expect(bot.got).toHaveLength(1);
    } finally {
      await bot.close();
    }
  });

  it('exits 0 when the endpoint does not exist', async () => {
    const repo = fixtureRepo();
    // Port 1 on localhost: the connection is refused at once.
    const done = await notify(
      stopHook({ session: 'refused', transcriptPath: transcript(['Nobody listening.']), cwd: repo }),
      hookEnv({ GROKBOT_EVENTS_URL: 'http://127.0.0.1:1/session-events', GROKBOT_EVENTS_KEY: KEY }),
    );
    expect(done.status).toBe(0);
    expect(done.stdout).toBe('');
    expect(done.stderr).toBe('');
  });

  it('gives up and exits 0 when the endpoint never answers', async () => {
    const repo = fixtureRepo();
    const bot = await receiver('silent');
    try {
      const done = await notify(
        stopHook({ session: 'hanging', transcriptPath: transcript(['Hanging about.']), cwd: repo }),
        hookEnv({ GROKBOT_EVENTS_URL: bot.url, GROKBOT_EVENTS_KEY: KEY }),
      );
      expect(done.status).toBe(0);
      expect(done.stdout).toBe('');
      expect(done.stderr).toBe('');
      // The receiver did get it; the script stopped waiting on its own 5s cap rather than holding the session.
      expect(bot.got).toHaveLength(1);
      expect(done.ms).toBeGreaterThan(4000);
      expect(done.ms).toBeLessThan(20_000);
    } finally {
      await bot.close();
    }
  });

  it('exits 0 and posts nothing when the hook JSON does not parse', async () => {
    const bot = await receiver('ok');
    try {
      for (const input of ['not json at all', '', '[]', '"a string"']) {
        const done = await notify(input, hookEnv({ GROKBOT_EVENTS_URL: bot.url, GROKBOT_EVENTS_KEY: KEY }));
        expect(done.status).toBe(0);
        expect(done.stdout).toBe('');
        expect(done.stderr).toBe('');
      }
      expect(bot.got).toEqual([]);
    } finally {
      await bot.close();
    }
  });

  it('puts no environment value, secret or file content in the payload', async () => {
    const repo = fixtureRepo();
    const bot = await receiver('ok');
    try {
      const done = await notify(
        stopHook({ session: 'clean', transcriptPath: transcript(['Nothing to hide.']), cwd: repo }),
        hookEnv({
          GROKBOT_EVENTS_URL: bot.url,
          GROKBOT_EVENTS_KEY: KEY,
          ANTHROPIC_API_KEY: 'sk-ant-must-not-travel',
          DATABASE_URL: 'postgres://must-not-travel',
          VERCEL_TOKEN: 'vercel-must-not-travel',
        }),
      );
      expect(done.status).toBe(0);
      const sent = at(bot.got, 0);
      // The key travels in the header, by name, and nowhere else.
      expect(sent.auth).toBe(`Bearer ${KEY}`);
      for (const secret of ['sk-ant-must-not-travel', 'postgres://must-not-travel', 'vercel-must-not-travel', KEY]) {
        expect(sent.body).not.toContain(secret);
      }
      // Only the session's own fields, and the message is the assistant's words — not the transcript file.
      expect(Object.keys(object(sent.body)).sort()).toEqual([...FIELDS].sort());
      expect(payload(sent.body).last_message).toBe('Nothing to hide.');
    } finally {
      await bot.close();
    }
  });

  it('never passes the key on a command line', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    // The URL and the key go to curl as a config file on stdin (-K -), so `ps` and any log never see them.
    expect(source).toContain('-K -');
    expect(source).not.toMatch(/-H ["']?Authorization/);
    expect(source).not.toMatch(/--header ["']?Authorization/);
    expect(source).not.toMatch(/\$\{?GROKBOT_EVENTS_KEY\}? *["']? *(http|-)/);
  });

  it('is wired to Stop, Notification and SessionEnd in .claude/settings.json', () => {
    const hooks: unknown = Reflect.get(object(readFileSync(SETTINGS, 'utf8')), 'hooks');
    if (typeof hooks !== 'object' || hooks === null) throw new Error('.claude/settings.json has no hooks');
    for (const event of ['Stop', 'Notification', 'SessionEnd']) {
      const matchers: unknown = Reflect.get(hooks, event);
      if (!Array.isArray(matchers)) throw new Error(`no ${event} hook`);
      const commands = matchers.flatMap((matcher: unknown) => {
        if (typeof matcher !== 'object' || matcher === null) throw new Error(`${event} hook is not an object`);
        const entries: unknown = Reflect.get(matcher, 'hooks');
        if (!Array.isArray(entries)) throw new Error(`${event} hook has no commands`);
        return entries.map((entry: unknown) => {
          if (typeof entry !== 'object' || entry === null) throw new Error(`${event} command is not an object`);
          expect(field(entry, 'type')).toBe('command');
          return field(entry, 'command');
        });
      });
      expect(commands).toHaveLength(1);
      expect(at(commands, 0)).toContain('scripts/hooks/notify-bot.sh');
    }
  });
});
