// The dependency update explainer: main's own film of a Dependabot or Renovate pull request
// (AGENTS.md "PR explainer videos"). Those pull requests buy no Claude review and write no
// `## How to see it` steps, so .github/workflows/pr-video-deps.yml makes their video from main's
// copy: scripts/ship/pr-video-deps.sh reads the pull request and its CI run through the API into
// facts.json, and dependency-update.spec.ts films this page from it. Nothing from the pull
// request's head is checked out or run: its diff is only ever data, and every word of it drawn here
// goes through parseFacts (a safe set of characters, or it is dropped) and esc.
//
// The order is the plain story's (AGENTS.md "Plain words for someone not in the loop"): what this
// is and what the viewer decides, main today, what changes, the evidence after (the real CI jobs
// on the new versions), and the result last, in the fixed words the narration says
// (dependencyWords, the same sentence scripts/ship/pr-video-script.sh builds from the counts).
// One scene on screen at a time, cut (scene-cut.ts), one `## How to see it` step per scene
// (storyMarkdown), and the spec leaves the scene starts as beats.json for beat mode.
import { sceneCutCss } from '../scene-cut';

/** One dependency moved from one version to another. */
export interface Update {
  readonly name: string;
  readonly from: string;
  readonly to: string;
}

/** One CI job on the new versions: check, a smoke shard, or smoke. */
export interface Check {
  readonly name: string;
  readonly conclusion: string;
  readonly seconds: number;
}

/** What scripts/ship/pr-video-deps.sh decide leaves in facts.json, checked. */
export interface Facts {
  readonly pr: number;
  readonly sha: string;
  readonly author: string;
  readonly updates: readonly Update[];
  readonly more: number;
  readonly dependencyFiles: number;
  readonly otherFiles: number;
  readonly checks: readonly Check[];
  readonly main: { readonly sha: string; readonly conclusion: string } | null;
}

// The same sets of characters pr-video-deps.sh keeps; anything else is dropped, never drawn.
const NAME = /^[@A-Za-z0-9._/-]{1,80}$/;
const VERSION = /^[A-Za-z0-9.^~<>=+_-]{1,40}$/;
const SHA = /^[0-9a-f]{7,40}$/;
const WORD = /^[a-z_]{1,20}$/;
const JOB = /^[A-Za-z0-9 (),._-]{1,60}$/;
const BOTS: Readonly<Record<string, string>> = { 'dependabot[bot]': 'Dependabot', 'renovate[bot]': 'Renovate' };
/** The most updates a scene draws: pr-video-deps.sh's MAX_SHOWN. */
export const MAX_SHOWN = 8;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, re: RegExp): string | undefined => (typeof v === 'string' && re.test(v) ? v : undefined);
const count = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 100_000 ? v : undefined;
const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

/** facts.json, checked field by field; undefined when it is not a dependency update's facts. */
export function parseFacts(raw: unknown): Facts | undefined {
  if (!isRecord(raw)) return undefined;
  const pr = count(raw['pr']);
  const sha = text(raw['sha'], SHA);
  const author = text(raw['author'], /^[a-z]+\[bot\]$/);
  const more = count(raw['more']);
  const dependencyFiles = count(raw['dependency_files']);
  const otherFiles = count(raw['other_files']);
  if (pr === undefined || sha === undefined || author === undefined || !(author in BOTS)) return undefined;
  if (more === undefined || dependencyFiles === undefined || otherFiles === undefined) return undefined;
  const updates = list(raw['updates']).flatMap((u): Update[] => {
    if (!isRecord(u)) return [];
    const name = text(u['name'], NAME);
    const from = text(u['from'], VERSION);
    const to = text(u['to'], VERSION);
    return name === undefined || from === undefined || to === undefined ? [] : [{ name, from, to }];
  });
  const checks = list(raw['checks']).flatMap((c): Check[] => {
    if (!isRecord(c)) return [];
    const name = text(c['name'], JOB);
    const conclusion = text(c['conclusion'], WORD);
    const seconds = count(c['seconds']);
    return name === undefined || conclusion === undefined || seconds === undefined ? [] : [{ name, conclusion, seconds }];
  });
  const m = raw['main'];
  let main: Facts['main'] = null;
  if (isRecord(m)) {
    const mainSha = text(m['sha'], SHA);
    const conclusion = text(m['conclusion'], WORD);
    if (mainSha !== undefined && conclusion !== undefined) main = { sha: mainSha, conclusion };
  }
  return {
    pr, sha, author, more, dependencyFiles, otherFiles, main,
    updates: updates.slice(0, MAX_SHOWN),
    checks: checks.slice(0, 12),
  };
}

/** The bot as a person would name it. */
export const botName = (f: Facts): string => BOTS[f.author] ?? 'A dependency bot';

/** A package name as a voice can say it: no @, no slashes, no dashes (`@playwright/test` is "playwright test"). */
export const spokenName = (name: string): string => name.replace(/^@/, '').replace(/[/._-]+/g, ' ').trim();

/** A version as a voice can say it: without the range sign (`^7.1.3` is "7.1.3"). */
export const spokenVersion = (v: string): string => v.replace(/^[\^~<>=]+/, '');

/**
 * The dependency update's result, in the words scripts/ship/pr-video-script.sh builds from the
 * same two counts and says last: the checks are the proof, since no Claude review reads a
 * dependency bot's pull request.
 */
export const dependencyWords = (checks: number, other: number): string => {
  const passed = checks === 1 ? 'the one test job passed' : `all ${String(checks)} test jobs passed`;
  const proof = `No automatic code review runs on a dependency update, so the tests are the proof: ${passed} on the new versions`;
  if (other === 0) return `${proof}, and the change touches only dependency files. So this is safe to merge once a person approves it.`;
  if (other === 1) {
    return `${proof}. But the change also touches 1 file that is not a dependency file, so a person should look at it closely before approving.`;
  }
  return `${proof}. But the change also touches ${String(other)} files that are not dependency files, so a person should look at them closely before approving.`;
};

/** A CI job as the scene labels it. */
export const jobLabel = (name: string): string => {
  const shard = /^smoke-shard \((chrome|iphone-webkit), (\d+), (\d+)\)$/.exec(name);
  if (shard !== null) {
    return `${shard[1] === 'chrome' ? 'Chrome' : 'iPhone'} ${shard[2] ?? ''} of ${shard[3] ?? ''}`;
  }
  if (name === 'check') return 'Types, style, tests, build';
  if (name === 'smoke') return 'Every browser test';
  return name;
};

const minutes = (s: number): string => (s < 60 ? `${String(s)} s` : `${String(Math.round(s / 60))} min`);
const total = (f: Facts): number => f.updates.length + f.more;
const allPassed = (f: Facts): boolean => f.checks.length > 0 && f.checks.every((c) => c.conclusion === 'success');

export type SceneKind = 'opening' | 'before' | 'change' | 'after' | 'result';

export interface Scene {
  readonly kind: SceneKind;
  readonly tag: string;
  /** The headline on screen, which the scene's step quotes and its paragraph says word for word. */
  readonly title: string;
  readonly seconds: number;
  /** The scene's `## How to see it` step, for the narration. */
  readonly step: string;
}

const q = (t: string): string => `"${t}"`;
const updatesSaid = (f: Facts, how: (u: Update) => string): string => {
  const said = f.updates.map(how);
  if (f.more > 0) said.push(`and ${String(f.more)} more`);
  return said.length === 0 ? 'the versions in the lockfile' : said.join(', ');
};

/** The scenes, in the plain story's order, with the result last. */
export function scenes(f: Facts): Scene[] {
  const n = total(f);
  const bot = botName(f);
  const opening = n === 0 ? 'An automatic dependency update' : `An automatic update of ${String(n)} ${n === 1 ? 'dependency' : 'dependencies'}`;
  const mainSaid =
    f.main === null
      ? 'no run of main’s own checks was found for it'
      : f.main.conclusion === 'success'
        ? 'main’s own checks passed on it'
        : `main’s own checks ended ${f.main.conclusion} on it`;
  const files = `${String(f.dependencyFiles)} dependency ${f.dependencyFiles === 1 ? 'file changes' : 'files change'}, and ${
    f.otherFiles === 0 ? 'no other file' : `${String(f.otherFiles)} other ${f.otherFiles === 1 ? 'file' : 'files'}`
  }`;
  const passed = allPassed(f) ? 'Every check passed on the new versions' : 'Not every check passed on the new versions';
  return [
    {
      kind: 'opening', tag: 'WHAT THIS IS', title: opening, seconds: 15,
      step: `- what this is: ${q(opening)}, opened by ${bot} as pull request ${String(f.pr)}; the viewer decides whether to merge it`,
    },
    {
      kind: 'before', tag: 'TODAY', title: 'Today, main runs the old versions', seconds: 9,
      step: `- today: ${q('Today, main runs the old versions')}: ${updatesSaid(f, (u) => `${spokenName(u.name)} at ${spokenVersion(u.from)}`)}; ${mainSaid}`,
    },
    {
      kind: 'change', tag: 'WHAT CHANGES', title: 'The new versions', seconds: Math.min(20, 6 + 2 * f.updates.length),
      step: `- what changes: ${q('The new versions')}: ${updatesSaid(f, (u) => `${spokenName(u.name)} from ${spokenVersion(u.from)} to ${spokenVersion(u.to)}`)}; ${files}`,
    },
    {
      kind: 'after', tag: 'AFTER', title: passed, seconds: 12,
      step: `- after: ${q(passed)}: the check job (types, code style, unit tests and the build) and the browser tests in Chrome and on an iPhone, ${String(f.checks.length)} test jobs in all`,
    },
    {
      kind: 'result', tag: 'RESULT', title: dependencyWords(f.checks.length, f.otherFiles), seconds: 12,
      step: '- result: the fixed result, shown as it is said',
    },
  ];
}

/** The total the recording runs. */
export const recordingSeconds = (f: Facts): number => scenes(f).reduce((a, s) => a + s.seconds, 0);

/** The spec and the steps the narration reads (story.md), instead of the bot's own body. */
export function storyMarkdown(f: Facts): string {
  const n = total(f);
  return [
    '## Spec',
    '',
    `${botName(f)} opened pull request ${String(f.pr)}, an automatic update of ${String(n)} ${n === 1 ? 'dependency' : 'dependencies'}: ${updatesSaid(
      f,
      (u) => `${spokenName(u.name)} from ${spokenVersion(u.from)} to ${spokenVersion(u.to)}`,
    )}. A person decides whether to merge it.`,
    '',
    '## How to see it',
    '',
    ...scenes(f).map((s) => s.step),
    '',
  ].join('\n');
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);

const tick = (cls: string): string =>
  `<svg class="${cls}" viewBox="-40 -40 80 80" width="80" height="80"><circle r="36" fill="#3a8a55"/><path class="draw" d="M-16 1 L-4 13 L18 -12" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const cross = (cls: string): string =>
  `<svg class="${cls}" viewBox="-40 -40 80 80" width="80" height="80"><circle r="36" fill="#d0573f"/><path d="M-13 -13 L13 13 M13 -13 L-13 13" stroke="#fff" stroke-width="9" stroke-linecap="round"/></svg>`;
const BOT = `<svg class="bot" viewBox="-80 -110 160 170" width="170" height="180"><line x1="0" y1="-66" x2="0" y2="-90" stroke="#23324a" stroke-width="6"/><circle cx="0" cy="-96" r="10" fill="#3e70b8"/><rect x="-62" y="-66" width="124" height="104" rx="28" fill="#fff" stroke="#23324a" stroke-width="6"/><circle cx="-24" cy="-18" r="11" fill="#23324a"/><circle cx="24" cy="-18" r="11" fill="#23324a"/><path d="M-22 14 Q0 28 22 14" fill="none" stroke="#23324a" stroke-width="6" stroke-linecap="round"/></svg>`;
const BOX = `<svg class="box" viewBox="-60 -60 120 120" width="120" height="120"><path d="M-50 -20 L0 -45 L50 -20 L50 35 L0 58 L-50 35 Z" fill="#f3d58c" stroke="#23324a" stroke-width="5" stroke-linejoin="round"/><path d="M-50 -20 L0 5 L50 -20 M0 5 L0 58" fill="none" stroke="#23324a" stroke-width="5"/></svg>`;

const sceneHtml = (f: Facts, s: Scene, i: number): string => {
  const open = `<section id="s${String(i)}" class="scene ${s.kind}"><p class=tag>${esc(s.tag)}</p>`;
  const rows = (draw: (u: Update, k: number) => string): string =>
    `<div class=rows>${f.updates.map((u, k) => draw(u, k)).join('')}${
      f.more > 0 ? `<div class="row more" style="--d:${String(f.updates.length)}">+ ${String(f.more)} more</div>` : ''
    }${f.updates.length === 0 && f.more === 0 ? '<div class=row style="--d:0">The lockfile’s versions</div>' : ''}</div>`;
  switch (s.kind) {
    case 'opening':
      return `${open}<h1>${esc(s.title)}</h1><div class=stage>${BOT}${BOX}<div class=page><b>main</b></div></div>
<div class=chips><span class=chip>${esc(botName(f))} · pull request ${String(f.pr)}</span><span class="chip ask">You decide: merge it, or not</span></div></section>`;
    case 'before': {
      const ok = f.main?.conclusion === 'success';
      const badge =
        f.main === null
          ? '<div class="badge none">No run of main’s checks found</div>'
          : `<div class="badge${ok ? '' : ' bad'}">${ok ? tick('mini') : cross('mini')}<span>main’s checks ${ok ? 'passed' : esc(f.main.conclusion)} · ${esc(f.main.sha.slice(0, 7))}</span></div>`;
      return `${open}<h1>${esc(s.title)}</h1><div class=split>${rows(
        (u, k) => `<div class=row style="--d:${String(k)}"><b class=name>${esc(u.name)}</b><span class="v old">${esc(u.from)}</span></div>`,
      )}${badge}</div></section>`;
    }
    case 'change':
      return `${open}<h1>${esc(s.title)}</h1>${rows(
        (u, k) =>
          `<div class=row style="--d:${String(k)}"><b class=name>${esc(u.name)}</b><span class="v old struck">${esc(u.from)}</span><svg class=arrow viewBox="0 0 90 24" width="90" height="24"><path d="M2 12 H78 M66 2 L84 12 L66 22" fill="none" stroke="#3e70b8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="v new">${esc(u.to)}</span></div>`,
      )}<div class=chips><span class="chip dep">${String(f.dependencyFiles)} dependency ${f.dependencyFiles === 1 ? 'file' : 'files'}</span><span class="chip ${f.otherFiles === 0 ? 'none' : 'warn'}">${String(f.otherFiles)} other ${f.otherFiles === 1 ? 'file' : 'files'}</span></div></section>`;
    case 'after':
      return `${open}<h1>${esc(s.title)}</h1><div class=pipe>${f.checks
        .map(
          (c, k) =>
            `<div class="job${c.conclusion === 'success' ? '' : ' bad'}" style="--d:${String(k)}">${c.conclusion === 'success' ? tick('mini') : cross('mini')}<b>${esc(jobLabel(c.name))}</b><span>${esc(c.conclusion === 'success' ? minutes(c.seconds) : c.conclusion)}</span></div>`,
        )
        .join('')}</div><p class=note>CI run on commit ${esc(f.sha.slice(0, 7))}, the head of pull request ${String(f.pr)}</p></section>`;
    case 'result':
      return `${open}${allPassed(f) ? tick('big') : cross('big')}<h1 class=said>${esc(s.title)}</h1></section>`;
  }
};

/** The whole page, drawn for a 1280x720 frame, everything inside its middle 85%. */
export const pageHtml = (f: Facts): string => {
  const list = scenes(f);
  return `<!doctype html><meta charset="utf-8"><title>Dependency update</title><style>
body{margin:0;width:1280px;height:720px;display:grid;place-items:center;background:#fdfbf4;font:600 22px Arial,'Liberation Sans','DejaVu Sans',sans-serif;color:#23324a;overflow:hidden}
.scene{width:1088px;max-height:612px;box-sizing:border-box;text-align:center}
${sceneCutCss(list.length)}
.tag{color:#3e70b8;font-size:22px;letter-spacing:.14em;margin:0 0 10px}h1{font-size:42px;margin:0 0 24px;animation:up .6s both}
.chips{display:flex;justify-content:center;gap:18px;margin-top:22px}.chip{padding:12px 20px;border-radius:12px;background:#e9eef7;animation:up .5s .9s both}
.chip.ask{background:#3e70b8;color:#fff;animation-delay:1.6s}.chip.dep{background:#3e70b8;color:#fff}.chip.none{background:#3a8a55;color:#fff;animation-delay:1.4s}.chip.warn{background:#e2a72e;color:#23324a;animation-delay:1.4s}
.stage{position:relative;height:250px;width:760px;margin:0 auto}.stage .bot{position:absolute;left:40px;top:40px;animation:walk 1.4s ease-out both}
.stage .box{position:absolute;left:190px;top:60px;z-index:2;animation:carry 2.6s .2s ease-in-out both}
.stage .page{position:absolute;right:40px;top:40px;width:200px;height:190px;border:5px solid #23324a;border-radius:14px;background:#fff;display:grid;place-items:end center;padding-bottom:14px;box-sizing:border-box;background-image:repeating-linear-gradient(#fff 0 26px,#e3dcc8 26px 28px)}
.rows{display:flex;flex-direction:column;align-items:center;gap:10px}
.row{display:flex;align-items:center;gap:16px;padding:10px 18px;border-radius:12px;background:#fff;border:3px solid #e3dcc8;animation:up .45s calc(.4s + .35s*var(--d)) both}
.row.more{color:#5b6578}.name{min-width:300px;text-align:left;font-size:24px}
.v{padding:6px 14px;border-radius:10px;font:700 22px 'Liberation Mono','DejaVu Sans Mono',monospace}
.v.old{background:#e8e4d8;color:#5b6578}.v.new{background:#3a8a55;color:#fff;animation:pop .5s calc(1.3s + .5s*var(--d)) both}
.v.struck{position:relative}.v.struck::after{content:'';position:absolute;left:6px;right:6px;top:50%;height:4px;background:#d0573f;transform-origin:left;animation:strike .4s calc(.9s + .5s*var(--d)) both}
.arrow path{stroke-dasharray:120;animation:draw .5s calc(1s + .5s*var(--d)) both}
.split{display:flex;justify-content:center;align-items:center;gap:44px}
.badge{display:flex;align-items:center;gap:14px;padding:18px 22px;border-radius:16px;background:#fff;border:4px solid #3a8a55;animation:pop .6s 1.8s both}.badge.bad{border-color:#d0573f}.badge.none{border-color:#8a93a3;color:#5b6578}
.pipe{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;max-width:1040px;margin:0 auto}
.job{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 10px;border-radius:14px;background:#fff;border:4px solid #e3dcc8;animation:lit .5s calc(.6s + .55s*var(--d)) both}
.job b{font-size:21px}.job span{font-size:19px;color:#5b6578}.job.bad{border-color:#d0573f;animation-name:up}
.note{color:#5b6578;font-size:19px;margin-top:18px;animation:up .5s 1.2s both}
svg.mini{width:46px;height:46px}svg.big{width:120px;height:120px;animation:pop .6s both}
.draw{stroke-dasharray:60;animation:draw .5s .3s both}
.result h1.said{color:#3a8a55;font-size:31px;line-height:1.35;margin-top:20px;animation:up .6s .4s both}
@keyframes up{from{opacity:0;transform:translateY(18px)}}
@keyframes pop{0%{opacity:0;transform:scale(.4)}70%{opacity:1;transform:scale(1.1)}100%{opacity:1;transform:none}}
@keyframes draw{from{stroke-dashoffset:120}to{stroke-dashoffset:0}}
@keyframes strike{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes lit{from{opacity:.25;transform:scale(.92);border-color:#e3dcc8}to{opacity:1;transform:none;border-color:#3a8a55}}
@keyframes walk{from{opacity:0;transform:translateX(-120px)}}
@keyframes carry{0%{opacity:0;transform:translate(0,0)}20%{opacity:1;transform:translate(0,0)}70%{transform:translate(300px,-60px)}90%{transform:translate(370px,4px)}100%{opacity:1;transform:translate(370px,-8px)}}
</style><body data-scene="0">${list.map((s, i) => sceneHtml(f, s, i)).join('')}`;
};
