// The review-first explainer's scenes: flat SVG diagrams and CSS motion in one
// self-contained page, drawn for a 1280x720 frame. review-first.spec.ts sets
// `data-scene` on the body to each index in turn and holds it for SCENE_SECONDS[i];
// a scene's animations start when it becomes the current one.

/** How long each scene is held: title, before, a review that asks for changes, a pass, the point. */
export const SCENE_SECONDS: readonly number[] = [5, 10, 12, 12, 7];

export const SCENES_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Review first, then the video</title>
<style>
  :root { --paper:#fdfbf4; --ink:#23324a; --line:#e3dcc8; --green:#3a8a55; --amber:#e2a72e; --red:#d0573f; --blue:#3e70b8; --soft:#8a93a3; }
  html, body { margin:0; height:100%; background:var(--paper); overflow:hidden; }
  body { font-family: Inter, "Helvetica Neue", Arial, "Liberation Sans", "DejaVu Sans", sans-serif; }
  svg.scene { position:absolute; inset:0; width:100vw; height:100vh; opacity:0; transition:opacity .6s ease; }
  text { fill:var(--ink); }
  .tag { font-size:24px; font-weight:700; letter-spacing:.14em; }
  .caption { font-size:36px; font-weight:700; }
  .label { font-size:26px; font-weight:600; }
  .small { font-size:21px; fill:var(--soft); }
  .white { fill:#fff; }
  .card { fill:#fff; stroke:var(--ink); stroke-width:4; }
  .bar { fill:var(--line); }
  svg.scene * { animation-play-state: paused; }
  body[data-scene="0"] #s0, body[data-scene="1"] #s1, body[data-scene="2"] #s2,
  body[data-scene="3"] #s3, body[data-scene="4"] #s4 { opacity:1; }
  body[data-scene="0"] #s0 *, body[data-scene="1"] #s1 *, body[data-scene="2"] #s2 *,
  body[data-scene="3"] #s3 *, body[data-scene="4"] #s4 * { animation-play-state: running; }

  @keyframes pop { 0% { opacity:0; transform:scale(.3); } 70% { opacity:1; transform:scale(1.12); } 100% { opacity:1; transform:scale(1); } }
  @keyframes fadeup { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:none; } }
  @keyframes draw { from { stroke-dashoffset:400; } to { stroke-dashoffset:0; } }
  @keyframes spin { to { transform:rotate(360deg); } }
  @keyframes shake { 0%, 100% { transform:none; } 25% { transform:translateX(-8px); } 75% { transform:translateX(8px); } }
  @keyframes loop { 0% { opacity:0; transform:translate(0,0); } 10% { opacity:1; } 90% { opacity:1; transform:translate(0,0) rotate(-360deg); } 100% { opacity:0; } }
  .pop { transform-box:fill-box; transform-origin:center; animation:pop .6s ease-out both; }
  .fadeup { animation:fadeup .7s ease-out both; }
  .draw { stroke-dasharray:400; animation:draw .9s ease-out both; }
  .spin { transform-box:fill-box; transform-origin:center; animation:spin 2.4s linear infinite both; }
  .shake { transform-box:fill-box; transform-origin:center; animation:shake .4s ease-in-out 3 both; }
  .d1 { animation-delay:.6s; } .d2 { animation-delay:1.4s; } .d3 { animation-delay:2.2s; }
  .d4 { animation-delay:3s; } .d5 { animation-delay:3.8s; } .d6 { animation-delay:4.6s; }
  .d7 { animation-delay:5.4s; } .d8 { animation-delay:6.2s; } .d9 { animation-delay:7s; }
  .d10 { animation-delay:7.8s; } .d11 { animation-delay:8.6s; } .d12 { animation-delay:9.4s; }

  /* The round counter in scene 2 ticks 1, 2, 3, then a person. */
  @keyframes r1 { 0%, 30% { opacity:1; } 33%, 100% { opacity:0; } }
  @keyframes r2 { 0%, 32% { opacity:0; } 35%, 63% { opacity:1; } 66%, 100% { opacity:0; } }
  @keyframes r3 { 0%, 65% { opacity:0; } 68%, 100% { opacity:1; } }
  .r1 { animation:r1 9s linear 3s both; } .r2 { animation:r2 9s linear 3s both; } .r3 { animation:r3 9s linear 3s both; }
</style></head>
<body data-scene="0">
<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0" aria-hidden="true">
  <defs>
    <symbol id="pr" viewBox="0 0 160 120">
      <rect x="4" y="4" width="152" height="112" rx="14" class="card"/>
      <rect x="22" y="26" width="90" height="12" rx="6" class="bar"/>
      <rect x="22" y="50" width="116" height="10" rx="5" class="bar"/>
      <rect x="22" y="70" width="104" height="10" rx="5" class="bar"/>
      <rect x="22" y="90" width="70" height="10" rx="5" class="bar"/>
    </symbol>
    <symbol id="review" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="54" fill="#fff" stroke="#3e70b8" stroke-width="6"/>
      <circle cx="54" cy="54" r="22" fill="none" stroke="#23324a" stroke-width="7"/>
      <line x1="70" y1="70" x2="90" y2="90" stroke="#23324a" stroke-width="9" stroke-linecap="round"/>
    </symbol>
    <symbol id="camera" viewBox="0 0 140 100">
      <rect x="4" y="18" width="96" height="70" rx="12" fill="#fff" stroke="#23324a" stroke-width="5"/>
      <path d="M100 40 L134 22 L134 84 L100 66 Z" fill="#fff" stroke="#23324a" stroke-width="5" stroke-linejoin="round"/>
      <circle cx="30" cy="40" r="7" fill="#d0573f"/>
    </symbol>
    <symbol id="film" viewBox="0 0 200 120">
      <rect x="4" y="4" width="192" height="112" rx="14" fill="#23324a"/>
      <path d="M84 36 L128 60 L84 84 Z" fill="#fdfbf4"/>
    </symbol>
    <symbol id="tick" viewBox="0 0 80 80">
      <circle cx="40" cy="40" r="36" fill="#3a8a55"/>
      <path d="M22 41 L35 54 L59 28" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="cross" viewBox="0 0 80 80">
      <circle cx="40" cy="40" r="36" fill="#d0573f"/>
      <path d="M26 26 L54 54 M54 26 L26 54" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
    </symbol>
    <symbol id="bot" viewBox="0 0 120 120">
      <rect x="18" y="30" width="84" height="70" rx="18" fill="#fff" stroke="#23324a" stroke-width="5"/>
      <line x1="60" y1="30" x2="60" y2="12" stroke="#23324a" stroke-width="5"/>
      <circle cx="60" cy="10" r="7" fill="#e2a72e"/>
      <circle cx="44" cy="60" r="8" fill="#23324a"/><circle cx="76" cy="60" r="8" fill="#23324a"/>
      <rect x="42" y="78" width="36" height="8" rx="4" fill="#23324a"/>
    </symbol>
    <symbol id="person" viewBox="0 0 100 120">
      <circle cx="50" cy="34" r="24" fill="#e2a72e"/>
      <path d="M10 116 C10 76 90 76 90 116 Z" fill="#3e70b8"/>
    </symbol>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0 L10 5 L0 10 Z" fill="#23324a"/>
    </marker>
  </defs>
</svg>

<!-- 0: title -->
<svg id="s0" class="scene" viewBox="0 0 1280 720">
  <text x="640" y="250" text-anchor="middle" class="tag" style="fill:var(--blue)">PAPER GOLF · PIPELINE</text>
  <text x="640" y="350" text-anchor="middle" style="font-size:72px;font-weight:800" class="fadeup">Review first,</text>
  <text x="640" y="440" text-anchor="middle" style="font-size:72px;font-weight:800" class="fadeup d1">then the video</text>
  <g class="pop d2"><use href="#review" x="440" y="500" width="110" height="110"/></g>
  <path d="M570 555 H700" stroke="#23324a" stroke-width="5" marker-end="url(#arrow)" class="draw d3" fill="none"/>
  <g class="pop d4"><use href="#film" x="720" y="505" width="160" height="96"/></g>
</svg>

<!-- 1: before -->
<svg id="s1" class="scene" viewBox="0 0 1280 720">
  <text x="80" y="90" class="tag" style="fill:var(--red)">BEFORE</text>
  <text x="80" y="140" class="caption">The review and the video started at the same moment</text>
  <g class="pop"><use href="#pr" x="90" y="300" width="200" height="150"/></g>
  <text x="190" y="490" text-anchor="middle" class="label">Marked ready</text>
  <path d="M300 340 C400 300 450 250 560 250" stroke="#23324a" stroke-width="5" fill="none" marker-end="url(#arrow)" class="draw d1"/>
  <path d="M300 410 C400 450 450 500 560 500" stroke="#23324a" stroke-width="5" fill="none" marker-end="url(#arrow)" class="draw d1"/>
  <g class="pop d2"><use href="#review" x="580" y="190" width="120" height="120"/></g>
  <text x="640" y="345" text-anchor="middle" class="label">Review</text>
  <g class="pop d2"><use href="#camera" x="570" y="450" width="140" height="100"/></g>
  <text x="640" y="585" text-anchor="middle" class="label">Recorder</text>
  <path d="M720 250 H880" stroke="#23324a" stroke-width="5" fill="none" marker-end="url(#arrow)" class="draw d5"/>
  <g class="pop d6 shake"><use href="#cross" x="900" y="210" width="80" height="80"/></g>
  <text x="1000" y="262" class="label" style="fill:var(--red)" ><tspan class="fadeup d6">Changes needed</tspan></text>
  <path d="M720 500 H880" stroke="#23324a" stroke-width="5" fill="none" marker-end="url(#arrow)" class="draw d3"/>
  <g class="pop d4"><use href="#film" x="900" y="440" width="200" height="120"/></g>
  <text x="1000" y="600" text-anchor="middle" class="small fadeup d7">a video already made</text>
  <text x="640" y="670" text-anchor="middle" class="label fadeup d9" style="fill:var(--red)">…for work the review then rejects</text>
</svg>

<!-- 2: after, the review asks for changes -->
<svg id="s2" class="scene" viewBox="0 0 1280 720">
  <text x="80" y="90" class="tag" style="fill:var(--green)">AFTER · THE REVIEW RUNS FIRST</text>
  <text x="80" y="140" class="caption">It asks for changes: a problems list, and no video</text>
  <g class="pop"><use href="#review" x="140" y="370" width="120" height="120"/></g>
  <text x="200" y="525" text-anchor="middle" class="label">Review</text>
  <g class="pop d1 shake"><use href="#cross" x="230" y="350" width="56" height="56"/></g>
  <path d="M290 410 H400" stroke="#23324a" stroke-width="5" fill="none" marker-end="url(#arrow)" class="draw d2"/>
  <g class="fadeup d2">
    <rect x="420" y="250" width="440" height="300" rx="18" class="card"/>
    <text x="450" y="300" class="label">Problems found · round</text>
    <text x="760" y="300" class="label r1" style="fill:var(--red)">1</text>
    <text x="760" y="300" class="label r2" style="fill:var(--red)">2</text>
    <text x="760" y="300" class="label r3" style="fill:var(--red)">3</text>
    <circle cx="462" cy="352" r="9" fill="var(--red)"/><rect x="486" y="344" width="310" height="16" rx="8" class="bar"/>
    <circle cx="462" cy="402" r="9" fill="var(--red)"/><rect x="486" y="394" width="260" height="16" rx="8" class="bar"/>
    <circle cx="462" cy="452" r="9" fill="var(--red)"/><rect x="486" y="444" width="290" height="16" rx="8" class="bar"/>
    <text x="450" y="520" class="small">one line each, with a link to its note</text>
  </g>
  <g class="fadeup d4">
    <use href="#film" x="930" y="230" width="150" height="90" style="opacity:.25"/>
    <path d="M920 220 L1090 330" stroke="var(--red)" stroke-width="9" stroke-linecap="round"/>
    <text x="1005" y="370" text-anchor="middle" class="label" style="fill:var(--red)">no video</text>
  </g>
  <g class="pop d5"><use href="#bot" x="960" y="430" width="110" height="110"/></g>
  <text x="1015" y="575" text-anchor="middle" class="label fadeup d5">fix and push</text>
  <path d="M960 600 C760 690 360 690 210 560" stroke="#3e70b8" stroke-width="5" stroke-dasharray="14 10" fill="none" marker-end="url(#arrow)" class="fadeup d6"/>
  <text x="600" y="700" text-anchor="middle" class="small fadeup d7">the push starts a fresh review · at most 3 rounds, then a person</text>
  <g class="pop d11"><use href="#person" x="1130" y="440" width="80" height="96"/></g>
</svg>

<!-- 3: after, the review passes -->
<svg id="s3" class="scene" viewBox="0 0 1280 720">
  <text x="80" y="90" class="tag" style="fill:var(--green)">AFTER · ONLY A PASS MAKES A VIDEO</text>
  <text x="80" y="140" class="caption">A pass adds the review-passed label, and that starts the recorder</text>
  <g class="pop"><use href="#review" x="90" y="260" width="120" height="120"/></g>
  <g class="pop d1"><use href="#tick" x="180" y="240" width="60" height="60"/></g>
  <text x="150" y="415" text-anchor="middle" class="label">Review</text>
  <path d="M230 320 H330" stroke="#23324a" stroke-width="5" fill="none" marker-end="url(#arrow)" class="draw d2"/>
  <g class="pop d2">
    <path d="M350 290 H560 L590 320 L560 350 H350 Z" fill="var(--green)"/>
    <circle cx="372" cy="320" r="8" fill="#fff"/>
    <text x="392" y="329" class="label white">review-passed</text>
  </g>
  <path d="M600 320 H664" stroke="#23324a" stroke-width="5" fill="none" marker-end="url(#arrow)" class="draw d3"/>
  <g class="pop d4"><use href="#camera" x="680" y="270" width="140" height="100"/></g>
  <text x="750" y="415" text-anchor="middle" class="label">Recorder</text>
  <path d="M840 320 H920" stroke="#23324a" stroke-width="5" fill="none" marker-end="url(#arrow)" class="draw d5"/>
  <g class="pop d6"><use href="#film" x="940" y="260" width="200" height="120"/></g>
  <g class="fadeup d7">
    <rect x="160" y="470" width="960" height="170" rx="18" class="card"/>
    <text x="190" y="515" class="small">THE VIDEO, IN FOUR PARTS</text>
    <rect x="190" y="540" width="210" height="70" rx="12" fill="var(--blue)"/>
    <text x="295" y="585" text-anchor="middle" class="label white">Intent</text>
  </g>
  <g class="fadeup d8">
    <rect x="420" y="540" width="210" height="70" rx="12" fill="var(--blue)"/>
    <text x="525" y="585" text-anchor="middle" class="label white">What was built</text>
  </g>
  <g class="fadeup d9">
    <rect x="650" y="540" width="210" height="70" rx="12" fill="var(--blue)"/>
    <text x="755" y="585" text-anchor="middle" class="label white">Review + fixes</text>
  </g>
  <g class="fadeup d10">
    <rect x="880" y="540" width="210" height="70" rx="12" fill="var(--green)"/>
    <text x="985" y="585" text-anchor="middle" class="label white">Verdict</text>
  </g>
</svg>

<!-- 4: the point -->
<svg id="s4" class="scene" viewBox="0 0 1280 720">
  <g class="pop"><use href="#tick" x="580" y="160" width="120" height="120"/></g>
  <text x="640" y="380" text-anchor="middle" style="font-size:54px;font-weight:800" class="fadeup d1">The video now only arrives</text>
  <text x="640" y="455" text-anchor="middle" style="font-size:54px;font-weight:800" class="fadeup d2">for work that passed review</text>
  <text x="640" y="540" text-anchor="middle" class="small fadeup d3">one review per round · one video per pass · a person decides</text>
</svg>
</body></html>`;
