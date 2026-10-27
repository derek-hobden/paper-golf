// The "CI tells everyone" explainer's scenes (factory step 2): flat SVG diagrams and CSS
// motion in one self-contained page, drawn for a 1280x720 frame, in the same way as
// session-ping-scenes.ts. ci-tells-everyone.spec.ts sets `data-scene` on the body to each
// index in turn and holds it for SCENE_SECONDS[i]; a scene's animations start when it
// becomes the current one. Labels only, never code, JSON or a sentence to read: the voice
// explains each scene.

/**
 * How long each scene is held: title, every tool through the same checks, the missing
 * steps failing fast with an example, the deleted video link coming back, the blockers
 * comment filling and clearing, the close. CI writes the narration for the whole clip from
 * the pull request's `## How to see it` steps, one per scene in this order. Keep the total
 * near 56 s: the length of the clip sets how many words the narration is asked for
 * (pr-video-script.sh: 2.2 a second, at most 130).
 */
export const SCENE_SECONDS: readonly number[] = [3, 9, 12, 11, 15, 6];

export const SCENES_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>CI tells everyone</title>
<style>
  :root { --paper:#fdfbf4; --ink:#23324a; --line:#e3dcc8; --green:#3a8a55; --amber:#e2a72e; --red:#d0573f; --blue:#3e70b8; --soft:#8a93a3; }
  html, body { margin:0; height:100%; background:var(--paper); overflow:hidden; }
  body { font-family: Inter, "Helvetica Neue", Arial, "Liberation Sans", "DejaVu Sans", sans-serif; }
  svg.scene { position:absolute; inset:0; width:100vw; height:100vh; opacity:0; transition:opacity .6s ease; }
  text { fill:var(--ink); }
  .tag { font-size:26px; font-weight:700; letter-spacing:.12em; }
  .caption { font-size:34px; font-weight:600; }
  .label { font-size:26px; font-weight:600; }
  .small { font-size:22px; fill:var(--soft); }
  svg.scene * { animation-play-state: paused; }
  body[data-scene="0"] #s0, body[data-scene="1"] #s1, body[data-scene="2"] #s2,
  body[data-scene="3"] #s3, body[data-scene="4"] #s4, body[data-scene="5"] #s5 { opacity:1; }
  body[data-scene="0"] #s0 *, body[data-scene="1"] #s1 *, body[data-scene="2"] #s2 *,
  body[data-scene="3"] #s3 *, body[data-scene="4"] #s4 *, body[data-scene="5"] #s5 * { animation-play-state: running; }

  @keyframes pop { 0% { opacity:0; transform:scale(.3); } 70% { opacity:1; transform:scale(1.12); } 100% { opacity:1; transform:scale(1); } }
  @keyframes fadeup { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:none; } }
  @keyframes fadeout { from { opacity:1; } to { opacity:0; } }
  @keyframes slide { from { opacity:0; transform:translateX(-120px); } to { opacity:1; transform:none; } }
  @keyframes travel { 0% { opacity:0; transform:translateX(0); } 15% { opacity:1; } 80% { opacity:1; } 100% { opacity:0; transform:translateX(470px) scale(.4); } }
  @keyframes lift { 0% { opacity:0; transform:translate(0,0); } 20% { opacity:1; } 100% { opacity:1; transform:translate(-470px,-250px); } }
  @keyframes erase { 0% { opacity:1; } 100% { opacity:0; transform:translateX(60px); } }
  @keyframes pulse { 0%, 100% { transform:scale(1); } 50% { transform:scale(1.12); } }
  .pop { transform-box:fill-box; transform-origin:center; animation:pop .6s ease-out both; }
  .fadeup { animation:fadeup .7s ease-out both; }
  .fadeout { animation:fadeout .6s ease-in both; }
  .slide { animation:slide .8s ease-out both; }
  .travel { animation:travel 1.6s ease-in-out both; }
  .lift { animation:lift 1.8s ease-in-out both; }
  .erase { animation:erase .8s ease-in both; }
  .pulse { transform-box:fill-box; transform-origin:center; animation:pulse 1.2s ease-in-out infinite both; }
</style></head>
<body data-scene="-1">
<svg width="0" height="0" style="position:absolute">
  <defs>
    <g id="ok"><circle r="26" fill="#3a8a55"/><path d="M-11 1 L-3 9 L12 -9" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></g>
    <g id="no"><circle r="26" fill="#d0573f"/><path d="M-9 -9 L9 9 M9 -9 L-9 9" stroke="#fff" stroke-width="6" stroke-linecap="round"/></g>
    <g id="wait"><circle r="26" fill="#e2a72e"/><path d="M-9 -12 L9 -12 L-9 12 L9 12 Z" fill="#fff"/></g>
    <g id="bot">
      <line x1="0" y1="-48" x2="0" y2="-62" stroke="#23324a" stroke-width="5"/><circle cx="0" cy="-66" r="7" fill="#23324a"/>
      <rect x="-44" y="-48" width="88" height="74" rx="20" fill="#fff" stroke="#23324a" stroke-width="5"/>
      <circle cx="-16" cy="-14" r="7" fill="#23324a"/><circle cx="16" cy="-14" r="7" fill="#23324a"/>
      <path d="M-14 8 L14 8" stroke="#23324a" stroke-width="5" stroke-linecap="round"/>
    </g>
    <g id="person">
      <circle cx="0" cy="-34" r="20" fill="#fff" stroke="#23324a" stroke-width="5"/>
      <path d="M-36 26 Q-36 -8 0 -8 Q36 -8 36 26 Z" fill="#fff" stroke="#23324a" stroke-width="5" stroke-linejoin="round"/>
    </g>
    <g id="pr">
      <rect x="-60" y="-44" width="120" height="88" rx="12" fill="#fff" stroke="#23324a" stroke-width="4"/>
      <circle cx="-34" cy="-18" r="9" fill="#3e70b8"/><circle cx="-34" cy="20" r="9" fill="#3e70b8"/>
      <path d="M-34 -9 L-34 11" stroke="#3e70b8" stroke-width="5"/>
      <rect x="-14" y="-22" width="56" height="9" rx="4" fill="#e3dcc8"/><rect x="-14" y="14" width="44" height="9" rx="4" fill="#e3dcc8"/>
    </g>
    <g id="film">
      <rect x="-40" y="-28" width="80" height="56" rx="8" fill="#23324a"/>
      <path d="M-10 -14 L16 0 L-10 14 Z" fill="#fdfbf4"/>
    </g>
    <g id="shelf">
      <rect x="-120" y="40" width="240" height="14" rx="6" fill="#8a93a3"/>
      <rect x="-104" y="-26" width="60" height="66" rx="6" fill="#3e70b8"/>
      <rect x="-34" y="-36" width="60" height="76" rx="6" fill="#3a8a55"/>
      <rect x="36" y="-20" width="60" height="60" rx="6" fill="#e2a72e"/>
    </g>
    <g id="funnel">
      <path d="M-90 -60 L90 -60 L24 10 L24 70 L-24 70 L-24 10 Z" fill="#fff" stroke="#23324a" stroke-width="5" stroke-linejoin="round"/>
      <circle cx="-40" cy="-30" r="10" fill="#3a8a55"/><circle cx="0" cy="-30" r="10" fill="#3a8a55"/><circle cx="40" cy="-30" r="10" fill="#3a8a55"/>
      <circle cx="0" cy="34" r="10" fill="#3a8a55"/>
    </g>
  </defs>
</svg>

<!-- 0: title -->
<svg class="scene" id="s0" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <g transform="translate(640 250)"><use href="#pr" class="pop"/></g>
  <text x="640" y="420" text-anchor="middle" class="caption fadeup" style="font-size:52px;animation-delay:.3s">CI tells everyone</text>
  <text x="640" y="470" text-anchor="middle" class="small fadeup" style="animation-delay:.6s">what is wrong, and what to do next</text>
</svg>

<!-- 1: every tool goes through the same checks -->
<svg class="scene" id="s1" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <g transform="translate(150 140)"><use href="#bot" class="pop"/></g>
  <text x="150" y="200" text-anchor="middle" class="small fadeup">Codex</text>
  <g transform="translate(150 290)"><use href="#bot" class="pop" style="animation-delay:.4s"/></g>
  <text x="150" y="350" text-anchor="middle" class="small fadeup" style="animation-delay:.4s">Claude Code</text>
  <g transform="translate(150 440)"><use href="#bot" class="pop" style="animation-delay:.8s"/></g>
  <text x="150" y="500" text-anchor="middle" class="small fadeup" style="animation-delay:.8s">Grok Bot</text>
  <g transform="translate(150 600)"><use href="#person" class="pop" style="animation-delay:1.2s"/></g>
  <text x="150" y="660" text-anchor="middle" class="small fadeup" style="animation-delay:1.2s">a person</text>
  <g transform="translate(250 140)"><use href="#pr" class="travel" style="animation-delay:2.0s"/></g>
  <g transform="translate(250 290)"><use href="#pr" class="travel" style="animation-delay:2.3s"/></g>
  <g transform="translate(250 440)"><use href="#pr" class="travel" style="animation-delay:2.6s"/></g>
  <g transform="translate(250 600)"><use href="#pr" class="travel" style="animation-delay:2.9s"/></g>
  <g transform="translate(830 370)"><use href="#funnel" class="pop" style="animation-delay:1.6s"/></g>
  <text x="830" y="490" text-anchor="middle" class="label fadeup" style="animation-delay:4.4s">one set of checks</text>
  <g transform="translate(1060 300)"><use href="#ok" class="pop" style="animation-delay:5.4s"/></g>
  <g transform="translate(1060 370)"><use href="#ok" class="pop" style="animation-delay:5.6s"/></g>
  <g transform="translate(1060 440)"><use href="#ok" class="pop" style="animation-delay:5.8s"/></g>
  <text x="1060" y="530" text-anchor="middle" class="small fadeup" style="animation-delay:6.2s">same rules</text>
</svg>

<!-- 2: no steps: the video check fails at once, with an example -->
<svg class="scene" id="s2" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <rect x="120" y="120" width="320" height="440" rx="16" fill="#fff" stroke="#23324a" stroke-width="5" class="fadeup"/>
  <text x="150" y="170" class="label fadeup" style="animation-delay:.2s">pull request</text>
  <g class="fadeup" style="animation-delay:.4s">
    <rect x="150" y="200" width="240" height="12" rx="6" fill="#e3dcc8"/><rect x="150" y="230" width="200" height="12" rx="6" fill="#e3dcc8"/>
    <rect x="150" y="260" width="220" height="12" rx="6" fill="#e3dcc8"/>
  </g>
  <rect x="150" y="310" width="260" height="200" rx="10" fill="none" stroke="#d0573f" stroke-width="4" stroke-dasharray="14 10" class="fadeup" style="animation-delay:1.4s"/>
  <text x="280" y="420" text-anchor="middle" class="label fadeup" style="fill:#d0573f;animation-delay:1.6s">no steps</text>
  <path d="M460 340 L580 340" stroke="#23324a" stroke-width="5" class="fadeup" style="animation-delay:2.6s"/>
  <g transform="translate(650 340)"><use href="#no" class="pop" style="animation-delay:3.0s"/></g>
  <text x="650" y="420" text-anchor="middle" class="label fadeup" style="animation-delay:3.2s">fails at once</text>
  <text x="650" y="455" text-anchor="middle" class="small fadeup" style="animation-delay:3.4s">no waiting</text>
  <rect x="820" y="150" width="340" height="420" rx="16" fill="#fff" stroke="#3a8a55" stroke-width="5" class="slide" style="animation-delay:5.2s"/>
  <text x="850" y="200" class="label slide" style="fill:#3a8a55;animation-delay:5.4s">example</text>
  <g class="slide" style="animation-delay:6.2s">
    <circle cx="866" cy="260" r="8" fill="#3a8a55"/><rect x="890" y="253" width="220" height="14" rx="6" fill="#e3dcc8"/>
  </g>
  <g class="slide" style="animation-delay:6.8s">
    <circle cx="866" cy="320" r="8" fill="#3a8a55"/><rect x="890" y="313" width="160" height="14" rx="6" fill="#e3dcc8"/>
  </g>
  <g class="slide" style="animation-delay:7.4s">
    <circle cx="866" cy="380" r="8" fill="#3a8a55"/><rect x="890" y="373" width="190" height="14" rx="6" fill="#e3dcc8"/>
  </g>
  <g class="slide" style="animation-delay:8.0s">
    <circle cx="866" cy="440" r="8" fill="#3a8a55"/><rect x="890" y="433" width="140" height="14" rx="6" fill="#e3dcc8"/>
  </g>
  <text x="990" y="530" text-anchor="middle" class="small fadeup" style="animation-delay:9.0s">paste, then mark ready</text>
  <text x="280" y="620" text-anchor="middle" class="small fadeup" style="animation-delay:10.0s">a draft gets a warning</text>
</svg>

<!-- 3: a deleted video link comes back -->
<svg class="scene" id="s3" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <rect x="120" y="100" width="420" height="500" rx="16" fill="#fff" stroke="#23324a" stroke-width="5" class="fadeup"/>
  <text x="150" y="150" class="label fadeup" style="animation-delay:.2s">pull request</text>
  <g transform="translate(200 220)"><use href="#film" class="erase" style="animation-delay:2.2s"/></g>
  <rect x="260" y="210" width="240" height="18" rx="8" fill="#3e70b8" class="erase" style="animation-delay:2.2s"/>
  <line x1="150" y1="280" x2="510" y2="280" stroke="#8a93a3" stroke-width="4"/>
  <g class="fadeup" style="animation-delay:.4s">
    <rect x="150" y="320" width="300" height="12" rx="6" fill="#e3dcc8"/><rect x="150" y="350" width="240" height="12" rx="6" fill="#e3dcc8"/>
    <rect x="150" y="380" width="280" height="12" rx="6" fill="#e3dcc8"/>
  </g>
  <g class="fadeout" style="animation-delay:7.2s"><text x="330" y="490" text-anchor="middle" class="label fadeup" style="fill:#d0573f;animation-delay:2.8s">link deleted</text></g>
  <g transform="translate(940 520)"><use href="#shelf" class="pop" style="animation-delay:3.8s"/></g>
  <text x="940" y="610" text-anchor="middle" class="small fadeup" style="animation-delay:4.0s">the video shelf</text>
  <g transform="translate(670 470)"><use href="#film" class="lift" style="animation-delay:5.6s"/></g>
  <g transform="translate(940 300)"><use href="#bot" class="pop" style="animation-delay:4.6s"/></g>
  <text x="940" y="360" text-anchor="middle" class="small fadeup" style="animation-delay:4.8s">CI</text>
  <rect x="260" y="210" width="240" height="18" rx="8" fill="#3a8a55" class="fadeup" style="animation-delay:7.4s"/>
  <g transform="translate(560 220)"><use href="#ok" class="pop" style="animation-delay:8.0s"/></g>
  <text x="330" y="490" text-anchor="middle" class="label fadeup" style="fill:#3a8a55;animation-delay:8.2s">put back</text>
  <text x="940" y="160" text-anchor="middle" class="small fadeup" style="animation-delay:9.0s">only a video CI made</text>
</svg>

<!-- 4: one blockers comment, filling and clearing -->
<svg class="scene" id="s4" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <rect x="300" y="80" width="680" height="560" rx="18" fill="#fff" stroke="#23324a" stroke-width="5" class="fadeup"/>
  <text x="340" y="140" class="label fadeup" style="animation-delay:.2s">PR blockers</text>
  <g class="fadeout" style="animation-delay:10.4s">
    <g class="slide" style="animation-delay:1.6s">
      <g transform="translate(370 220)"><use href="#no"/></g>
      <text x="420" y="214" class="label">check</text>
      <rect x="540" y="200" width="200" height="12" rx="6" fill="#e3dcc8"/>
      <text x="420" y="246" class="small">why</text>
      <rect x="780" y="196" width="160" height="34" rx="10" fill="#eaf4ec" stroke="#3a8a55" stroke-width="3"/>
      <text x="860" y="219" text-anchor="middle" class="small" style="fill:#3a8a55">next step</text>
    </g>
    <g class="slide" style="animation-delay:3.2s">
      <g transform="translate(370 330)"><use href="#no"/></g>
      <text x="420" y="324" class="label">smoke</text>
      <rect x="540" y="310" width="180" height="12" rx="6" fill="#e3dcc8"/>
      <text x="420" y="356" class="small">why</text>
      <rect x="780" y="306" width="160" height="34" rx="10" fill="#eaf4ec" stroke="#3a8a55" stroke-width="3"/>
      <text x="860" y="329" text-anchor="middle" class="small" style="fill:#3a8a55">next step</text>
    </g>
    <g class="slide" style="animation-delay:4.8s">
      <g transform="translate(370 440)"><use href="#no"/></g>
      <text x="420" y="434" class="label">video</text>
      <rect x="540" y="420" width="220" height="12" rx="6" fill="#e3dcc8"/>
      <text x="420" y="466" class="small">why</text>
      <rect x="780" y="416" width="160" height="34" rx="10" fill="#eaf4ec" stroke="#3a8a55" stroke-width="3"/>
      <text x="860" y="439" text-anchor="middle" class="small" style="fill:#3a8a55">next step</text>
    </g>
    <g transform="translate(1110 330)"><use href="#wait" class="pop" style="animation-delay:7.0s"/></g>
    <text x="1110" y="390" text-anchor="middle" class="small fadeup" style="animation-delay:7.2s">pending</text>
    <text x="1110" y="420" text-anchor="middle" class="small fadeup" style="animation-delay:7.2s">not listed</text>
  </g>
  <g transform="translate(640 360)"><g class="pop" style="animation-delay:11.2s"><use href="#ok" class="pulse" style="animation-delay:11.8s"/></g></g>
  <text x="640" y="450" text-anchor="middle" class="caption fadeup" style="animation-delay:11.6s">No blockers</text>
  <text x="640" y="560" text-anchor="middle" class="small fadeup" style="animation-delay:12.4s">the same comment, edited in place</text>
</svg>

<!-- 5: the close -->
<svg class="scene" id="s5" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <g transform="translate(260 300)"><use href="#funnel" class="pop"/></g>
  <g transform="translate(520 300)"><use href="#no" class="pop" style="animation-delay:.3s"/></g>
  <g transform="translate(760 300)"><use href="#film" class="pop" style="animation-delay:.6s"/></g>
  <g transform="translate(1000 300)"><use href="#ok" class="pop" style="animation-delay:.9s"/></g>
  <text x="640" y="470" text-anchor="middle" class="caption fadeup" style="animation-delay:1.6s">one place to look, whoever opened it</text>
</svg>
</body></html>`;
