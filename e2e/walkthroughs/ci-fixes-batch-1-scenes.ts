// The CI fixes batch 1 explainer's scenes (PR 61): flat SVG diagrams and CSS motion in one
// self-contained page, drawn for a 1280x720 frame, in the same way as session-ping-scenes.ts.
// ci-fixes-batch-1.spec.ts sets `data-scene` on the body to each index in turn and holds it
// for SCENE_SECONDS[i]; a scene's animations start when it becomes the current one.
// Labels only, never code, JSON or a sentence to read: the voice explains each scene.

/**
 * How long each scene is held: title, the branch update, the gate and the video check that
 * wait, the video tied to its commit, the silent tail, the incomplete review, the close.
 * CI writes the narration for the whole clip from the pull request's `## How to see it`
 * steps, one per scene in this order. The scenes are timed to the speech it actually
 * produced for this story, measured from the audio of pr-61-368a846.mp4 (word timestamps
 * and silencedetect): the lines start at 0, 2.6, 15.4, 29.8, 39.1, 45.4 and 50.3 s, and the
 * speech ends at 56.5 s. Each scene starts as its line starts, and the closing card is held
 * until the speech ends, so there is no silent tail. Keep the total near 56.5 s: the length
 * of the clip sets how many words the narration is asked for (pr-video-script.sh: 2.2 a
 * second, at most 130), and a title card's few seconds are what left PR 61's first video at
 * 26 words. Inside a scene, each reveal starts on the word that names it.
 */
export const SCENE_SECONDS: readonly number[] = [2.6, 12.8, 14.4, 9.3, 6.3, 4.9, 6.2];

export const SCENES_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>CI fixes, batch one</title>
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
  body[data-scene="0"] #s0, body[data-scene="1"] #s1, body[data-scene="2"] #s2, body[data-scene="3"] #s3,
  body[data-scene="4"] #s4, body[data-scene="5"] #s5, body[data-scene="6"] #s6 { opacity:1; }
  body[data-scene="0"] #s0 *, body[data-scene="1"] #s1 *, body[data-scene="2"] #s2 *, body[data-scene="3"] #s3 *,
  body[data-scene="4"] #s4 *, body[data-scene="5"] #s5 *, body[data-scene="6"] #s6 * { animation-play-state: running; }

  @keyframes pop { 0% { opacity:0; transform:scale(.3); } 70% { opacity:1; transform:scale(1.12); } 100% { opacity:1; transform:scale(1); } }
  @keyframes fadeup { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:none; } }
  @keyframes fadeout { from { opacity:1; } to { opacity:0; } }
  @keyframes dim { to { opacity:.3; } }
  @keyframes spin { to { transform:rotate(360deg); } }
  @keyframes pulse { 0%, 100% { transform:scale(1); } 50% { transform:scale(1.12); } }
  @keyframes slide { from { opacity:0; transform:translateX(-120px); } to { opacity:1; transform:none; } }
  @keyframes grow { from { transform:scaleX(0); } to { transform:scaleX(1); } }
  @keyframes cut { 0% { opacity:0; transform:translateY(-40px); } 40% { opacity:1; transform:none; } 100% { opacity:1; transform:none; } }
  .pop { transform-box:fill-box; transform-origin:center; animation:pop .6s ease-out both; }
  .fadeup { animation:fadeup .7s ease-out both; }
  .fadeout { animation:fadeout .8s ease-in both; }
  .dim { animation:dim .8s ease-in both; }
  .slide { animation:slide .8s ease-out both; }
  .hand { transform-box:fill-box; transform-origin:50% 100%; animation:spin 2.4s linear infinite both; }
  .pulse { transform-box:fill-box; transform-origin:center; animation:pulse 1.2s ease-in-out infinite both; }
  .grow { transform-box:fill-box; transform-origin:left center; animation:grow 1.2s ease-out both; }
  .cut { animation:cut .8s ease-out both; }
</style></head>
<body data-scene="-1">
<svg width="0" height="0" style="position:absolute">
  <defs>
    <g id="ok"><circle r="30" fill="#3a8a55"/><path d="M-13 1 L-3 11 L14 -10" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></g>
    <g id="no"><circle r="30" fill="#d0573f"/><path d="M-11 -11 L11 11 M11 -11 L-11 11" stroke="#fff" stroke-width="7" stroke-linecap="round"/></g>
    <g id="wait"><circle r="30" fill="#e2a72e"/><path d="M-10 -14 L10 -14 L-10 14 L10 14 Z" fill="#fff"/></g>
    <g id="clockface"><circle r="34" fill="#fff" stroke="#23324a" stroke-width="5"/></g>
    <g id="bot">
      <line x1="0" y1="-62" x2="0" y2="-82" stroke="#23324a" stroke-width="5"/><circle cx="0" cy="-88" r="9" fill="#23324a"/>
      <rect x="-60" y="-62" width="120" height="100" rx="26" fill="#fff" stroke="#23324a" stroke-width="5"/>
      <circle cx="-22" cy="-16" r="10" fill="#23324a"/><circle cx="22" cy="-16" r="10" fill="#23324a"/>
      <path d="M-20 14 L20 14" fill="none" stroke="#23324a" stroke-width="5" stroke-linecap="round"/>
    </g>
    <g id="app">
      <circle r="62" fill="#fff" stroke="#3a8a55" stroke-width="6"/>
      <line x1="-8" y1="34" x2="-8" y2="-38" stroke="#23324a" stroke-width="6" stroke-linecap="round"/>
      <path d="M-8 -38 L34 -24 L-8 -10 Z" fill="#d0573f"/>
      <ellipse cx="0" cy="36" rx="34" ry="8" fill="#3a8a55"/>
    </g>
    <g id="branch">
      <circle cx="-60" cy="0" r="14" fill="#3e70b8"/><circle cx="60" cy="-40" r="14" fill="#3e70b8"/><circle cx="60" cy="40" r="14" fill="#3e70b8"/>
      <path d="M-46 0 L0 0 Q20 0 30 -20 L46 -40 M0 0 Q20 0 30 20 L46 40" fill="none" stroke="#3e70b8" stroke-width="7"/>
    </g>
    <g id="flag">
      <line x1="0" y1="40" x2="0" y2="-44" stroke="#23324a" stroke-width="6" stroke-linecap="round"/>
      <path d="M0 -44 L46 -30 L0 -16 Z" fill="#3a8a55"/>
    </g>
    <g id="card">
      <rect x="-70" y="-50" width="140" height="100" rx="14" fill="#fff" stroke="#23324a" stroke-width="4"/>
      <rect x="-48" y="-26" width="96" height="10" rx="5" fill="#e3dcc8"/>
      <rect x="-48" y="-4" width="70" height="10" rx="5" fill="#e3dcc8"/>
      <rect x="-48" y="18" width="84" height="10" rx="5" fill="#e3dcc8"/>
    </g>
    <g id="film">
      <rect x="-46" y="-32" width="92" height="64" rx="8" fill="#23324a"/>
      <path d="M-12 -16 L18 0 L-12 16 Z" fill="#fdfbf4"/>
    </g>
    <g id="page">
      <path d="M-26 -34 L14 -34 L26 -22 L26 34 L-26 34 Z" fill="#fff" stroke="#23324a" stroke-width="4" stroke-linejoin="round"/>
      <rect x="-16" y="-14" width="32" height="6" rx="3" fill="#8a93a3"/><rect x="-16" y="0" width="26" height="6" rx="3" fill="#8a93a3"/><rect x="-16" y="14" width="30" height="6" rx="3" fill="#8a93a3"/>
    </g>
    <g id="gear">
      <circle r="22" fill="none" stroke="#d0573f" stroke-width="12" stroke-dasharray="10 7"/>
      <circle r="14" fill="#d0573f"/><circle r="6" fill="#fff"/>
    </g>
    <g id="merge">
      <circle cx="0" cy="0" r="14" fill="#3a8a55"/>
      <path d="M-34 -30 Q-10 -24 -6 -8 M-34 30 Q-10 24 -6 8" fill="none" stroke="#3a8a55" stroke-width="6"/>
    </g>
    <g id="scissors">
      <circle cx="-14" cy="22" r="11" fill="none" stroke="#23324a" stroke-width="5"/><circle cx="14" cy="22" r="11" fill="none" stroke="#23324a" stroke-width="5"/>
      <path d="M-8 14 L14 -30 M8 14 L-14 -30" stroke="#23324a" stroke-width="5" stroke-linecap="round"/>
    </g>
    <g id="lens">
      <circle r="40" fill="rgba(62,112,184,.12)" stroke="#3e70b8" stroke-width="7"/>
      <line x1="28" y1="28" x2="62" y2="62" stroke="#3e70b8" stroke-width="10" stroke-linecap="round"/>
    </g>
  </defs>
</svg>

<!-- 0: title -->
<svg class="scene" id="s0" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <g transform="translate(640 250)"><use href="#app" class="pop"/></g>
  <text x="640" y="430" text-anchor="middle" class="caption fadeup" style="font-size:52px;animation-delay:.3s">CI fixes, batch one</text>
  <text x="640" y="480" text-anchor="middle" class="small fadeup" style="animation-delay:.6s">the checks, the videos and the reviews</text>
</svg>

<!-- 1: the branch update, before and after -->
<svg class="scene" id="s1" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <text x="320" y="90" text-anchor="middle" class="tag" style="fill:#d0573f">BEFORE</text>
  <text x="960" y="90" text-anchor="middle" class="tag" style="fill:#3a8a55">AFTER</text>
  <line x1="640" y1="70" x2="640" y2="650" stroke="#e3dcc8" stroke-width="4"/>
  <g transform="translate(150 330)"><use href="#bot" class="pop"/></g>
  <text x="150" y="430" text-anchor="middle" class="small">workflow bot</text>
  <path d="M220 330 L290 330" stroke="#23324a" stroke-width="5" class="fadeup" style="animation-delay:.8s"/>
  <g transform="translate(380 330)"><use href="#branch" class="fadeup" style="animation-delay:1.1s"/></g>
  <g transform="translate(240 540)">
    <use href="#wait" class="pop" style="animation-delay:5.6s"/>
    <use href="#wait" x="90" class="pop" style="animation-delay:5.8s"/>
    <use href="#wait" x="180" class="pop" style="animation-delay:6.0s"/>
  </g>
  <text x="330" y="620" text-anchor="middle" class="label fadeup" style="animation-delay:6.4s">checks held for approval</text>
  <g transform="translate(790 330)"><use href="#app" class="pop" style="animation-delay:9.0s"/></g>
  <text x="790" y="430" text-anchor="middle" class="small fadeup" style="animation-delay:9.2s">Golf Gus app</text>
  <path d="M860 330 L930 330" stroke="#23324a" stroke-width="5" class="fadeup" style="animation-delay:10.0s"/>
  <g transform="translate(1020 330)"><use href="#branch" class="fadeup" style="animation-delay:10.3s"/></g>
  <g transform="translate(880 540)">
    <use href="#ok" class="pop" style="animation-delay:11.0s"/>
    <use href="#ok" x="90" class="pop" style="animation-delay:11.2s"/>
    <use href="#ok" x="180" class="pop" style="animation-delay:11.4s"/>
  </g>
  <text x="970" y="620" text-anchor="middle" class="label fadeup" style="animation-delay:11.7s">checks run at once</text>
</svg>

<!-- 2: the gate and the video check wait, and the same check turns green -->
<svg class="scene" id="s2" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <text x="90" y="110" class="tag" style="fill:#d0573f">BEFORE</text>
  <g transform="translate(180 220)"><use href="#flag" class="pop"/></g>
  <text x="180" y="300" text-anchor="middle" class="small">ready</text>
  <path d="M230 220 L330 220" stroke="#23324a" stroke-width="5" class="fadeup" style="animation-delay:1.4s"/>
  <g transform="translate(390 220)"><use href="#no" class="pop" style="animation-delay:2.0s"/></g>
  <g transform="translate(390 220)"><use href="#no" class="dim" style="animation-delay:7.8s"/></g>
  <g transform="translate(620 220)"><use href="#card" class="slide" style="animation-delay:6.2s"/></g>
  <text x="620" y="310" text-anchor="middle" class="small fadeup" style="animation-delay:6.4s">review lands</text>
  <g transform="translate(820 220)"><use href="#ok" class="pop" style="animation-delay:7.4s"/></g>
  <text x="600" y="380" text-anchor="middle" class="label fadeup" style="animation-delay:8.0s">the old red stays beside the new green</text>

  <line x1="80" y1="430" x2="1200" y2="430" stroke="#e3dcc8" stroke-width="4"/>
  <text x="90" y="490" class="tag" style="fill:#3a8a55">AFTER</text>
  <g transform="translate(180 590)"><use href="#flag" class="pop" style="animation-delay:8.9s"/></g>
  <text x="180" y="670" text-anchor="middle" class="small fadeup" style="animation-delay:9.0s">ready</text>
  <path d="M230 590 L330 590" stroke="#23324a" stroke-width="5" class="fadeup" style="animation-delay:9.2s"/>
  <g transform="translate(390 590)">
    <use href="#clockface" class="pop" style="animation-delay:9.3s"/>
    <g class="pop" style="animation-delay:9.3s"><line x1="0" y1="0" x2="0" y2="-24" stroke="#23324a" stroke-width="5" stroke-linecap="round" class="hand" style="animation-delay:9.3s"/></g>
  </g>
  <text x="390" y="670" text-anchor="middle" class="small fadeup" style="animation-delay:9.5s">waits</text>
  <g transform="translate(620 590)"><use href="#card" class="slide" style="animation-delay:10.2s"/></g>
  <text x="620" y="680" text-anchor="middle" class="small fadeup" style="animation-delay:10.4s">review lands</text>
  <g transform="translate(390 590)"><use href="#ok" class="pop" style="animation-delay:12.9s"/></g>
  <path d="M700 560 Q560 470 420 545" fill="none" stroke="#3a8a55" stroke-width="5" stroke-dasharray="12 10" class="fadeup" style="animation-delay:11.8s"/>
  <text x="960" y="600" text-anchor="middle" class="label fadeup" style="animation-delay:13.2s">the same check turns green</text>
</svg>

<!-- 3: the video is tied to the commit it shows -->
<svg class="scene" id="s3" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <line x1="140" y1="380" x2="1140" y2="380" stroke="#8a93a3" stroke-width="8" class="grow"/>
  <g transform="translate(220 380)"><circle r="22" fill="#23324a" class="pop" style="animation-delay:.4s"/></g>
  <g transform="translate(220 240)"><use href="#film" class="pop" style="animation-delay:.8s"/></g>
  <text x="220" y="460" text-anchor="middle" class="small fadeup" style="animation-delay:2.0s">filmed here</text>
  <g transform="translate(450 380)"><use href="#page" class="pop" style="animation-delay:3.7s"/></g>
  <text x="450" y="460" text-anchor="middle" class="small fadeup" style="animation-delay:3.8s">docs</text>
  <g transform="translate(450 260)"><use href="#ok" class="pop" style="animation-delay:4.2s"/></g>
  <g transform="translate(680 380)"><use href="#merge" class="pop" style="animation-delay:5.1s"/></g>
  <text x="680" y="460" text-anchor="middle" class="small fadeup" style="animation-delay:5.3s">update from main</text>
  <g transform="translate(680 260)"><use href="#ok" class="pop" style="animation-delay:6.0s"/></g>
  <g transform="translate(910 380)"><use href="#gear" class="pop" style="animation-delay:7.2s"/></g>
  <text x="910" y="460" text-anchor="middle" class="small fadeup" style="animation-delay:7.3s">code change</text>
  <g transform="translate(910 260)"><use href="#no" class="pop" style="animation-delay:7.6s"/></g>
  <g transform="translate(1080 240)"><use href="#film" class="pop pulse" style="animation-delay:8.0s"/></g>
  <text x="1080" y="320" text-anchor="middle" class="label fadeup" style="animation-delay:8.3s">new video</text>
</svg>

<!-- 4: no silent tail -->
<svg class="scene" id="s4" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <g fill="#3e70b8" class="fadeup">
    <rect x="140" y="320" width="16" height="80" rx="6"/><rect x="170" y="290" width="16" height="140" rx="6"/>
    <rect x="200" y="330" width="16" height="60" rx="6"/><rect x="230" y="270" width="16" height="180" rx="6"/>
    <rect x="260" y="300" width="16" height="120" rx="6"/><rect x="290" y="335" width="16" height="50" rx="6"/>
    <rect x="320" y="280" width="16" height="160" rx="6"/><rect x="350" y="310" width="16" height="100" rx="6"/>
    <rect x="380" y="295" width="16" height="130" rx="6"/><rect x="410" y="325" width="16" height="70" rx="6"/>
    <rect x="440" y="285" width="16" height="150" rx="6"/><rect x="470" y="315" width="16" height="90" rx="6"/>
  </g>
  <line x1="500" y1="360" x2="1160" y2="360" stroke="#8a93a3" stroke-width="6"/>
  <g class="fadeout" style="animation-delay:4.4s">
    <line x1="640" y1="360" x2="1160" y2="360" stroke="#d0573f" stroke-width="6" stroke-dasharray="14 10"/>
    <text x="900" y="320" text-anchor="middle" class="label" style="fill:#d0573f">silence</text>
  </g>
  <g transform="translate(640 300)"><use href="#scissors" class="cut" style="animation-delay:1.8s"/></g>
  <text x="570" y="450" text-anchor="middle" class="label fadeup" style="animation-delay:2.6s">ends two seconds after the last word</text>
</svg>

<!-- 5: a review that read part of the change is not a pass -->
<svg class="scene" id="s5" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <rect x="200" y="80" width="300" height="560" rx="16" fill="#fff" stroke="#23324a" stroke-width="5" class="fadeup"/>
  <g class="fadeup" style="animation-delay:.3s">
    <rect x="230" y="120" width="220" height="12" rx="6" fill="#e3dcc8"/><rect x="230" y="150" width="180" height="12" rx="6" fill="#e3dcc8"/>
    <rect x="230" y="180" width="230" height="12" rx="6" fill="#e3dcc8"/><rect x="230" y="210" width="160" height="12" rx="6" fill="#e3dcc8"/>
    <rect x="230" y="240" width="210" height="12" rx="6" fill="#e3dcc8"/><rect x="230" y="270" width="190" height="12" rx="6" fill="#e3dcc8"/>
  </g>
  <rect x="202" y="340" width="296" height="298" rx="14" fill="#e3dcc8" opacity=".75" class="fadeup" style="animation-delay:1.6s"/>
  <text x="350" y="500" text-anchor="middle" class="label fadeup" style="animation-delay:1.8s">not read</text>
  <g transform="translate(380 220)"><use href="#lens" class="pop" style="animation-delay:1.1s"/></g>
  <g transform="translate(780 300)"><use href="#card" class="pop" style="animation-delay:2.4s"/></g>
  <text x="780" y="390" text-anchor="middle" class="small fadeup" style="animation-delay:2.5s">review</text>
  <rect x="680" y="430" width="200" height="54" rx="10" fill="#fff" stroke="#e2a72e" stroke-width="5" class="pop" style="animation-delay:2.8s"/>
  <text x="780" y="468" text-anchor="middle" class="label fadeup" style="fill:#c4861a;animation-delay:2.9s">incomplete</text>
  <g transform="translate(1040 400)"><use href="#no" class="pop" style="animation-delay:3.4s"/></g>
  <text x="1040" y="470" text-anchor="middle" class="small fadeup" style="animation-delay:3.6s">not a pass</text>
</svg>

<!-- 6: the close -->
<svg class="scene" id="s6" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
  <g transform="translate(200 300)"><use href="#app" class="pop"/></g>
  <g transform="translate(420 300)"><use href="#clockface" class="pop" style="animation-delay:.3s"/><use href="#ok" class="pop" style="animation-delay:.5s"/></g>
  <g transform="translate(640 300)"><use href="#film" class="pop" style="animation-delay:.7s"/></g>
  <g transform="translate(860 300)"><use href="#scissors" class="pop" style="animation-delay:.9s"/></g>
  <g transform="translate(1080 300)"><use href="#lens" class="pop" style="animation-delay:1.1s"/></g>
  <text x="640" y="470" text-anchor="middle" class="caption fadeup" style="animation-delay:2.0s">steadier checks, honest videos, whole reviews</text>
</svg>
</body></html>`;
