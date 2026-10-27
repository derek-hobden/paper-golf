// The session ping explainer's scenes: flat SVG illustrations and CSS motion in one
// self-contained page, drawn for a 1280x720 frame. session-ping.spec.ts sets
// `data-scene` on the body to each index in turn and holds it for SCENE_SECONDS[i];
// a scene's animations start when it becomes the current one.

/** How long each scene is held: title, before, the hook's signal, Flo routing it, the point. */
export const SCENE_SECONDS: readonly number[] = [6, 12, 12, 12, 8];

export const SCENES_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Claude session pings</title>
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
  .card-body { fill:#fff; stroke:var(--ink); stroke-width:4; }
  .bar { fill:var(--line); }
  svg.scene * { animation-play-state: paused; }
  body[data-scene="0"] #s0, body[data-scene="1"] #s1, body[data-scene="2"] #s2,
  body[data-scene="3"] #s3, body[data-scene="4"] #s4 { opacity:1; }
  body[data-scene="0"] #s0 *, body[data-scene="1"] #s1 *, body[data-scene="2"] #s2 *,
  body[data-scene="3"] #s3 *, body[data-scene="4"] #s4 * { animation-play-state: running; }

  @keyframes pop { 0% { opacity:0; transform:scale(.3); } 70% { opacity:1; transform:scale(1.12); } 100% { opacity:1; transform:scale(1); } }
  @keyframes fadeup { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:none; } }
  @keyframes spin { to { transform:rotate(360deg); } }
  @keyframes wave { 0% { opacity:.9; transform:scale(.4); } 100% { opacity:0; transform:scale(1.6); } }
  @keyframes drift { 0% { opacity:0; transform:translate(0,0); } 30% { opacity:1; } 100% { opacity:0; transform:translate(30px,-60px); } }
  @keyframes dim { to { opacity:.35; } }
  .pop { transform-box:fill-box; transform-origin:center; animation:pop .6s ease-out both; }
  .fadeup { animation:fadeup .7s ease-out both; }
  .wave { transform-box:fill-box; transform-origin:center; animation:wave 2s ease-out infinite both; }
  .hand { transform-box:view-box; transform-origin:300px 560px; animation:spin 3s linear infinite both; }
  .zz { animation:drift 2.4s ease-out infinite both; }

  /* Scene 2: one session, three things it can need, one signal each time. */
  @keyframes phase1 { 0%, 31% { opacity:1; } 33%, 100% { opacity:0; } }
  @keyframes phase2 { 0%, 32% { opacity:0; } 34%, 64% { opacity:1; } 66%, 100% { opacity:0; } }
  @keyframes phase3 { 0%, 65% { opacity:0; } 67%, 100% { opacity:1; } }
  .phase1 { animation:phase1 12s linear both; }
  .phase2 { animation:phase2 12s linear both; }
  .phase3 { animation:phase3 12s linear both; }
  @keyframes fly { 0% { opacity:0; transform:translate(0,0); } 12% { opacity:1; transform:translate(0,0); }
    60% { opacity:1; transform:translate(360px,0); } 70%, 100% { opacity:0; transform:translate(360px,0); } }
  .fly { animation:fly 4s ease-in-out 3 both; }
  @keyframes arrive { 0%, 55% { opacity:0; transform:scale(.6); } 65% { opacity:.9; } 100% { opacity:0; transform:scale(1.7); } }
  .arrive { transform-box:fill-box; transform-origin:center; animation:arrive 4s ease-out 3 both; }

  /* Scene 3: Flo picks the owner, the owner acts. */
  @keyframes inbound { 0% { opacity:0; transform:translate(-260px,0); } 20% { opacity:1; } 100% { opacity:1; transform:none; } }
  .inbound { animation:inbound 1.4s ease-out both; }
  @keyframes route { 0%, 20% { opacity:0; transform:translate(0,0); } 30% { opacity:1; transform:translate(0,0); }
    85% { opacity:1; transform:translate(460px,-60px); } 100% { opacity:0; transform:translate(460px,-60px); } }
  .route { animation:route 3.6s ease-in-out both; }
  @keyframes lit { 0%, 85% { stroke:var(--line); } 100% { stroke:var(--green); } }
  .lit { animation:lit 3.6s linear both; }
  @keyframes glow { 0%, 88% { opacity:0; } 100% { opacity:.18; } }
  .glow { animation:glow 3.8s linear both; }
</style></head>
<body data-scene="-1">
<svg width="0" height="0" style="position:absolute">
  <defs>
    <g id="card">
      <rect class="card-body" x="0" y="0" width="300" height="200" rx="18"/>
      <line x1="0" y1="46" x2="300" y2="46" stroke="#23324a" stroke-width="4"/>
      <circle cx="24" cy="23" r="7" fill="#d0573f"/><circle cx="46" cy="23" r="7" fill="#e2a72e"/><circle cx="68" cy="23" r="7" fill="#3a8a55"/>
      <rect class="bar" x="26" y="72" width="210" height="14" rx="7"/>
      <rect class="bar" x="26" y="102" width="160" height="14" rx="7"/>
      <rect class="bar" x="26" y="132" width="228" height="14" rx="7"/>
      <rect class="bar" x="26" y="162" width="120" height="14" rx="7"/>
    </g>
    <g id="done"><circle r="34" fill="#3a8a55"/><path d="M-15 1 L-4 12 L16 -11" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></g>
    <g id="ask"><circle r="34" fill="#e2a72e"/><text x="0" y="15" text-anchor="middle" font-size="44" font-weight="800" style="fill:#fff">?</text></g>
    <g id="err"><circle r="34" fill="#d0573f"/><text x="0" y="15" text-anchor="middle" font-size="44" font-weight="800" style="fill:#fff">!</text></g>
    <g id="envelope">
      <rect x="-40" y="-28" width="80" height="56" rx="8" fill="#fff" stroke="#23324a" stroke-width="4"/>
      <path d="M-36 -24 L0 4 L36 -24" fill="none" stroke="#23324a" stroke-width="4" stroke-linejoin="round"/>
    </g>
    <g id="bot">
      <line x1="0" y1="-62" x2="0" y2="-82" stroke="#23324a" stroke-width="5"/><circle cx="0" cy="-88" r="9" fill="#23324a"/>
      <rect x="-60" y="-62" width="120" height="100" rx="26" fill="#fff" stroke="#23324a" stroke-width="5"/>
      <circle cx="-22" cy="-16" r="10" fill="#23324a"/><circle cx="22" cy="-16" r="10" fill="#23324a"/>
      <path d="M-20 14 Q0 26 20 14" fill="none" stroke="#23324a" stroke-width="5" stroke-linecap="round"/>
    </g>
    <g id="person">
      <circle cx="0" cy="-46" r="30" fill="#23324a"/>
      <path d="M-56 40 Q-56 -8 0 -8 Q56 -8 56 40 Z" fill="#23324a"/>
    </g>
  </defs>
</svg>

<!-- 0: title -->
<svg class="scene" id="s0" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <g transform="translate(490 120)">
    <use href="#card"/>
    <g transform="translate(300 0)"><circle class="wave" r="40" fill="none" stroke="#3a8a55" stroke-width="6"/>
      <circle class="wave" r="40" fill="none" stroke="#3a8a55" stroke-width="6" style="animation-delay:1s"/></g>
  </g>
  <text class="fadeup" x="640" y="430" text-anchor="middle" font-size="72" font-weight="800">Claude session pings</text>
  <text class="fadeup" x="640" y="500" text-anchor="middle" font-size="34" style="animation-delay:.5s;fill:#5b6578">When a cloud session needs attention, it says so</text>
</svg>

<!-- 1: before -->
<svg class="scene" id="s1" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <text class="tag" x="60" y="70" style="fill:#d0573f">BEFORE</text>
  <g transform="translate(90 110)"><use href="#card"/><use href="#done" class="pop" x="300" y="0" style="animation-delay:.6s"/></g>
  <g transform="translate(490 110)"><use href="#card"/><use href="#ask" class="pop" x="300" y="0" style="animation-delay:1.6s"/></g>
  <g transform="translate(890 110)"><use href="#card"/><use href="#err" class="pop" x="300" y="0" style="animation-delay:2.6s"/></g>
  <text class="label fadeup" x="240" y="360" text-anchor="middle" style="animation-delay:.8s">Finished</text>
  <text class="label fadeup" x="640" y="360" text-anchor="middle" style="animation-delay:1.8s">Waiting on a question</text>
  <text class="label fadeup" x="1040" y="360" text-anchor="middle" style="animation-delay:2.8s">Hit an error</text>
  <g class="fadeup" style="animation-delay:3.6s">
    <circle cx="300" cy="560" r="62" fill="#fff" stroke="#23324a" stroke-width="5"/>
    <line x1="300" y1="560" x2="300" y2="512" stroke="#23324a" stroke-width="6" stroke-linecap="round" class="hand"/>
    <circle cx="300" cy="560" r="7" fill="#23324a"/>
    <text class="label" x="390" y="570">Hours go by...</text>
  </g>
  <g class="fadeup" style="animation-delay:5s">
    <g transform="translate(900 580)" opacity=".85"><use href="#person"/></g>
    <text class="zz" x="950" y="500" font-size="34" font-weight="700" style="fill:#8a93a3;animation-delay:5.4s">z</text>
    <text class="zz" x="975" y="485" font-size="26" font-weight="700" style="fill:#8a93a3;animation-delay:6.4s">z</text>
  </g>
  <text class="caption fadeup" x="640" y="690" text-anchor="middle" style="animation-delay:6s">Nobody knows until someone happens to look.</text>
</svg>

<!-- 2: after, the hook -->
<svg class="scene" id="s2" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <text class="tag" x="60" y="70" style="fill:#3a8a55">AFTER</text>
  <g transform="translate(100 190)"><use href="#card"/></g>
  <use href="#done" class="phase1" x="400" y="190"/>
  <use href="#ask" class="phase2" x="400" y="190"/>
  <use href="#err" class="phase3" x="400" y="190"/>
  <text class="label phase1" x="250" y="440" text-anchor="middle">It stops</text>
  <text class="label phase2" x="250" y="440" text-anchor="middle">It asks a question</text>
  <text class="label phase3" x="250" y="440" text-anchor="middle">It hits an error</text>
  <line x1="440" y1="290" x2="800" y2="290" stroke="#e3dcc8" stroke-width="6" stroke-dasharray="4 14" stroke-linecap="round"/>
  <use href="#envelope" class="fly" x="450" y="290"/>
  <text class="small" x="620" y="250" text-anchor="middle">one small signal</text>
  <circle class="arrive" cx="920" cy="290" r="110" fill="none" stroke="#3a8a55" stroke-width="6"/>
  <circle cx="920" cy="290" r="100" fill="#3a8a55"/>
  <text x="920" y="306" text-anchor="middle" font-size="48" font-weight="800" style="fill:#fff">Flo</text>
  <text class="small" x="920" y="460" text-anchor="middle">the factory webhook</text>
  <text class="caption fadeup" x="640" y="640" text-anchor="middle" style="animation-delay:1s">The hook sends one small signal, every time.</text>
</svg>

<!-- 3: Flo routes it to the owner bot, which acts -->
<svg class="scene" id="s3" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <text class="tag" x="60" y="70" style="fill:#3a8a55">AFTER</text>
  <line x1="300" y1="360" x2="760" y2="150" stroke="#e3dcc8" stroke-width="6"/>
  <line class="lit" x1="300" y1="360" x2="760" y2="300" stroke="#e3dcc8" stroke-width="6"/>
  <line x1="300" y1="360" x2="760" y2="510" stroke="#e3dcc8" stroke-width="6"/>
  <circle cx="300" cy="360" r="100" fill="#3a8a55"/>
  <text x="300" y="376" text-anchor="middle" font-size="48" font-weight="800" style="fill:#fff">Flo</text>
  <g class="inbound"><use href="#envelope" class="route" x="300" y="360"/></g>
  <g transform="translate(820 190)" opacity=".55"><use href="#bot"/></g>
  <circle class="glow" cx="820" cy="320" r="92" fill="#3a8a55"/>
  <g transform="translate(820 340)"><use href="#bot"/></g>
  <g transform="translate(820 560)" opacity=".55"><use href="#bot"/></g>
  <text class="small" x="820" y="446" text-anchor="middle" style="fill:#3a8a55;font-weight:700">owner of this session</text>
  <g class="fadeup" style="animation-delay:4.4s">
    <rect x="930" y="230" width="300" height="56" rx="28" fill="#fff" stroke="#e2a72e" stroke-width="4"/>
    <text class="label" x="1080" y="267" text-anchor="middle">Answers it</text>
  </g>
  <g class="fadeup" style="animation-delay:5.6s">
    <rect x="930" y="300" width="300" height="56" rx="28" fill="#fff" stroke="#d0573f" stroke-width="4"/>
    <text class="label" x="1080" y="337" text-anchor="middle">Fixes it</text>
  </g>
  <g class="fadeup" style="animation-delay:6.8s">
    <rect x="930" y="370" width="300" height="56" rx="28" fill="#fff" stroke="#3e70b8" stroke-width="4"/>
    <text class="label" x="1080" y="407" text-anchor="middle">Tells Derek</text>
  </g>
  <text class="caption fadeup" x="640" y="680" text-anchor="middle" style="animation-delay:1.2s">Flo routes it to the bot that owns the session, and that bot acts.</text>
</svg>

<!-- 4: the point -->
<svg class="scene" id="s4" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <g transform="translate(160 110) scale(.7)"><use href="#card"/></g>
  <g transform="translate(535 110) scale(.7)"><use href="#card"/></g>
  <g transform="translate(910 110) scale(.7)"><use href="#card"/></g>
  <circle class="wave" cx="370" cy="110" r="34" fill="none" stroke="#3a8a55" stroke-width="6"/>
  <circle class="wave" cx="745" cy="110" r="34" fill="none" stroke="#e2a72e" stroke-width="6" style="animation-delay:.6s"/>
  <circle class="wave" cx="1120" cy="110" r="34" fill="none" stroke="#d0573f" stroke-width="6" style="animation-delay:1.2s"/>
  <use href="#done" x="370" y="110"/><use href="#ask" x="745" y="110"/><use href="#err" x="1120" y="110"/>
  <text class="fadeup" x="640" y="430" text-anchor="middle" font-size="60" font-weight="800" style="animation-delay:.4s">Sessions that need attention</text>
  <text class="fadeup" x="640" y="510" text-anchor="middle" font-size="60" font-weight="800" style="animation-delay:.9s;fill:#3a8a55">now say so.</text>
</svg>
</body></html>`;
