/**
 * One log line for every bot ping: `bot ping http=NNN`, NNN the HTTP status the webhook answered, 000
 * when it could not be reached. Ported from the fleet template's RuckBee test.
 *
 * The ping workflows and scripts/ci/bot-event-ping.sh once logged three wordings: "bot-event-ping:
 * http=200" from the script, "bot ping http=200" from the inline steps, and "http=000000" on a failed
 * POST, because curl prints 000 for `-w '%{http_code}'` before it exits non-zero and `|| echo 000` added
 * a second 000. Every workflow that reads the bot secrets is covered: the bot-ping-*.yml workflows and
 * the deploy pings in deploy.yml. (The session hook's own log file, scripts/claude-hooks/bot-ping.sh, is
 * not a workflow log and keeps its timestamped line: tests/claude-no-prompts.test.ts.)
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOOK, jobIds, jobSteps, KEY, readWorkflow, stepNamed, useStubs, WORKFLOWS } from './bot-ping-harness';
import { REPO } from './hook-harness';

const PING = `${REPO}scripts/ci/bot-event-ping.sh`;
const LOG_LINE = 'echo "bot ping http=${code:-000}"';

const pingers = readdirSync(WORKFLOWS)
  .filter((f) => /\.ya?ml$/.test(f))
  .filter((f) => readWorkflow(f).includes('secrets.BOT_WEBHOOK_URL'))
  .sort();

/** Every step that holds the bot secrets, with its workflow and job. */
const pingSteps = pingers.flatMap((file) =>
  jobIds(readWorkflow(file)).flatMap((job) =>
    jobSteps(file, job)
      .filter((s) => s.env.BOT_WEBHOOK_URL !== undefined)
      .map((s) => ({ file, job, step: s })),
  ),
);

describe('every bot ping logs exactly "bot ping http=NNN"', () => {
  const t = useStubs();

  it('covers every bot-ping workflow and both deploy pings', () => {
    const botPings = readdirSync(WORKFLOWS).filter((f) => /^bot-ping-.*\.yml$/.test(f));
    expect(botPings.length).toBeGreaterThanOrEqual(7);
    expect(pingers).toEqual(expect.arrayContaining([...botPings, 'deploy.yml']));
    for (const file of pingers) {
      expect(
        pingSteps.some((p) => p.file === file),
        file,
      ).toBe(true);
    }
    // deploy.yml pings from both of its deploy jobs.
    expect(pingSteps.filter((p) => p.file === 'deploy.yml').map((p) => p.job)).toEqual(['staging-deploy', 'production']);
  });

  it.each(pingSteps.map((p) => [`${p.file} ${p.job}/${p.step.name}`, p] as const))(
    '%s posts through bot-event-ping.sh, or logs the one line itself',
    (_, { step }) => {
      const run = step.run;
      expect(run).not.toMatch(/echo 000/);
      if (/\bcurl\b/.test(run)) {
        // An inline POST (bot-ping-pr-closed.yml checks nothing out): the same line.
        expect(run).not.toMatch(/bot-event-ping\.sh/);
        const logged = run.split('\n').filter((l) => /\bhttp=/.test(l) && !/^\s*#/.test(l));
        expect(logged.map((l) => l.trim())).toEqual([LOG_LINE]);
      } else {
        if (/review-verdict-ping\.sh/.test(run)) {
          // The review verdict ping builds its payload in a script, which posts through bot-event-ping.sh.
          const script = readFileSync(`${REPO}scripts/ci/review-verdict-ping.sh`, 'utf8');
          expect(script).toMatch(/^bash "\$dir\/bot-event-ping\.sh" "\$payload"$/m);
          expect(script).not.toMatch(/\bhttp=/);
        } else {
          expect(run).toMatch(/^\s*bash \S*bot-event-ping\.sh"? "\$(payload|PAYLOAD)"$/m);
        }
        expect(run).not.toMatch(/\bhttp=/);
      }
    },
  );

  it('bot-event-ping.sh logs the one line, and nothing else prints an HTTP status', () => {
    const src = readFileSync(PING, 'utf8');
    const logged = src.split('\n').filter((l) => /\bhttp=/.test(l) && !/^\s*#/.test(l));
    expect(logged.map((l) => l.trim())).toEqual([LOG_LINE]);
    expect(src).not.toMatch(/echo 000/);
  });

  const secrets = { BOT_WEBHOOK_URL: HOOK, BOT_WEBHOOK_KEY: KEY };

  it.each([
    ['answered 200', '200', { FAKE_CURL_CODE: '200' }],
    ['answered 503', '503', { FAKE_CURL_CODE: '503' }],
    ['unreachable (curl prints 000, exits 7)', '000', { FAKE_CURL_EXIT: '7' }],
  ])('bot-event-ping.sh, webhook %s: "bot ping http=%s"', (_, code, env) => {
    const r = t.sh([PING, '{"kind":"deploy"}'], { ...secrets, ...env });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`bot ping http=${code}\n`);
  });

  it('bot-event-ping.sh, curl killed before it printed anything: "bot ping http=000"', () => {
    writeFileSync(join(t.dir(), 'curl'), '#!/usr/bin/env bash\nexit 28\n');
    const r = t.sh([PING, '{}'], secrets);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('bot ping http=000\n');
  });

  it.each([
    ['200', { FAKE_CURL_CODE: '200' }],
    ['502', { FAKE_CURL_CODE: '502' }],
    ['000', { FAKE_CURL_EXIT: '7' }],
  ])('bot-ping-pr-closed.yml\'s inline POST logs the same line: "bot ping http=%s"', (code, env) => {
    const file = 'bot-ping-pr-closed.yml';
    const step = stepNamed(file, 'ping', 'Ping owning bot on the unmerged close');
    const r = t.runStep(file, step, {
      event: 'pull_request_target.closed.unmerged.bot-pr.json',
      env,
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n').at(-1)).toBe(`bot ping http=${code}`);
  });
});
