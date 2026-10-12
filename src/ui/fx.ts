import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Full-screen transparent three.js overlay for the 3D touches:
 * a rolling d6, a crumpled paper ball arcing over the page, and a pencil that draws the lines.
 * World units are CSS pixels; the z=0 plane maps 1:1 onto the screen.
 */

export interface ScreenPt {
  x: number;
  y: number;
}

type Tween = { start: number; dur: number; update: (t: number) => void; resolve: () => void };

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Die face values on the BoxGeometry material slots (+x, -x, +y, -y, +z, -z); opposite faces sum to 7. */
const FACE_VALUES = [3, 4, 2, 5, 1, 6];
const FACE_NORMALS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  3: [
    [0.27, 0.27],
    [0.5, 0.5],
    [0.73, 0.73],
  ],
  4: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  5: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.5, 0.5],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  6: [
    [0.27, 0.25],
    [0.73, 0.25],
    [0.27, 0.5],
    [0.73, 0.5],
    [0.27, 0.75],
    [0.73, 0.75],
  ],
};

function faceTexture(value: number): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, '#2f9a4e');
  grad.addColorStop(1, '#23803e');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  for (const [px, py] of PIPS[value]) {
    g.beginPath();
    g.arc(px * s, py * s, s * 0.095, 0, Math.PI * 2);
    g.fillStyle = '#e9efe6';
    g.fill();
    g.beginPath();
    g.arc(px * s - 1.5, py * s - 1.5, s * 0.085, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function paperBallGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Displacement keyed on position so duplicated vertices stay welded (no cracks).
    const k = 0.78 + 0.32 * hash3(Math.round(v.x * 1000), Math.round(v.y * 1000), Math.round(v.z * 1000));
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function makePencil(): THREE.Group {
  const g = new THREE.Group();
  const L = 150;
  const R = 5.5;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, L, 6),
    new THREE.MeshStandardMaterial({ color: '#232326', roughness: 0.45, metalness: 0.1, flatShading: true }),
  );
  body.position.y = 22 + L / 2;
  const wood = new THREE.Mesh(
    new THREE.CylinderGeometry(R, 1.6, 17, 6),
    new THREE.MeshStandardMaterial({ color: '#e2c08f', roughness: 0.8, flatShading: true }),
  );
  wood.position.y = 5 + 17 / 2;
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(1.6, 5, 6),
    new THREE.MeshStandardMaterial({ color: '#3a3a3d', roughness: 0.3, metalness: 0.4 }),
  );
  tip.rotation.x = Math.PI;
  tip.position.y = 2.5;
  const ferrule = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 0.4, R + 0.4, 10, 12),
    new THREE.MeshStandardMaterial({ color: '#b9bcc2', roughness: 0.3, metalness: 0.8 }),
  );
  ferrule.position.y = 22 + L + 5;
  const eraser = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, 9, 12),
    new THREE.MeshStandardMaterial({ color: '#e98b8b', roughness: 0.9 }),
  );
  eraser.position.y = 22 + L + 14;
  for (const m of [body, wood, tip, ferrule, eraser]) {
    m.castShadow = true;
    g.add(m);
  }
  // The pencil's local +y axis runs from tip to eraser; lean it back towards the viewer and to the right.
  const holder = new THREE.Group();
  holder.add(g);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.45, 0.25, 0.86).normalize());
  return holder;
}

export class Fx {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(22, 1, 10, 10000);
  private tweens: Tween[] = [];
  private raf = 0;
  private die: THREE.Mesh | null = null;
  private ball: THREE.Mesh;
  private blob: THREE.Mesh;
  private pencil: THREE.Group;
  private light: THREE.DirectionalLight;
  private shadowPlane: THREE.Mesh;
  private w = 1;
  private h = 1;
  readonly enabled: boolean;
  /** Respect reduced-motion: shorten animations. */
  speed = 1;

  constructor(canvas: HTMLCanvasElement) {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.setClearColor(0x000000, 0);
    } catch {
      this.renderer = null;
    }
    this.enabled = !!this.renderer;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cbb0, 1.6));
    this.light = new THREE.DirectionalLight(0xffffff, 1.6);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.radius = 6;
    this.light.shadow.bias = -0.0005;
    this.scene.add(this.light, this.light.target);

    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.2 }));
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);

    this.ball = new THREE.Mesh(
      paperBallGeometry(),
      new THREE.MeshStandardMaterial({ color: '#f6f3ec', roughness: 0.95, flatShading: true }),
    );
    this.ball.visible = false;
    this.scene.add(this.ball);

    const sc = document.createElement('canvas');
    sc.width = sc.height = 64;
    const g = sc.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(40,30,20,1)');
    grad.addColorStop(0.45, 'rgba(40,30,20,0.55)');
    grad.addColorStop(1, 'rgba(40,30,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }),
    );
    this.blob.visible = false;
    this.scene.add(this.blob);

    this.pencil = makePencil();
    this.pencil.visible = false;
    this.scene.add(this.pencil);

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) this.speed = 0.45;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    const dist = this.h / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.aspect = this.w / this.h;
    this.camera.position.set(0, 0, dist);
    this.camera.near = dist / 10;
    this.camera.far = dist * 3;
    this.camera.updateProjectionMatrix();
    this.shadowPlane.scale.set(this.w * 1.5, this.h * 1.5, 1);
    this.light.position.set(-this.w * 0.25, this.h * 0.35, 900);
    const sc = this.light.shadow.camera;
    sc.left = -this.w;
    sc.right = this.w;
    sc.top = this.h;
    sc.bottom = -this.h;
    sc.near = 1;
    sc.far = 3000;
    sc.updateProjectionMatrix();
    if (this.renderer) {
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.setSize(this.w, this.h, false);
    }
    this.render();
  }

  /** Screen (CSS px, top-left origin) -> world on the z=0 page plane. */
  private world(p: ScreenPt, z = 0): THREE.Vector3 {
    return new THREE.Vector3(p.x - this.w / 2, this.h / 2 - p.y, z);
  }

  private render() {
    this.renderer?.render(this.scene, this.camera);
  }

  private loop = (now: number) => {
    this.raf = 0;
    const done: Tween[] = [];
    for (const tw of this.tweens) {
      if (!tw.start) tw.start = now;
      const t = Math.min(1, (now - tw.start) / tw.dur);
      tw.update(t);
      if (t >= 1) done.push(tw);
    }
    this.tweens = this.tweens.filter((tw) => !done.includes(tw));
    this.render();
    done.forEach((tw) => tw.resolve());
    if (this.tweens.length) this.raf = requestAnimationFrame(this.loop);
  };

  tween(durMs: number, update: (t: number) => void): Promise<void> {
    const dur = Math.max(1, durMs * this.speed);
    return new Promise((resolve) => {
      this.tweens.push({ start: 0, dur, update, resolve });
      if (!this.raf) this.raf = requestAnimationFrame(this.loop);
    });
  }

  // ---------------------------------------------------------------- die

  private ensureDie(size: number): THREE.Mesh {
    if (!this.die) {
      const mats = FACE_VALUES.map(
        (v) => new THREE.MeshStandardMaterial({ map: faceTexture(v), roughness: 0.35, metalness: 0.0, transparent: true }),
      );
      this.die = new THREE.Mesh(new RoundedBoxGeometry(1, 1, 1, 4, 0.14), mats);
      this.die.castShadow = true;
      this.scene.add(this.die);
    }
    this.die.scale.setScalar(size);
    this.setDieOpacity(1);
    this.die.visible = true;
    return this.die;
  }

  private setDieOpacity(o: number) {
    if (!this.die) return;
    for (const m of this.die.material as THREE.MeshStandardMaterial[]) m.opacity = o;
  }

  /** Throw the die so it tumbles in and comes to rest at `at`, showing `value` on top. */
  async rollDie(value: number, at: ScreenPt, size = 54): Promise<void> {
    if (!this.enabled) return;
    const die = this.ensureDie(size);
    const idx = FACE_VALUES.indexOf(value);
    const final = new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[idx], new THREE.Vector3(0, 0, 1));
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (Math.random() - 0.5) * 0.9);
    final.premultiply(spin);

    const end = this.world(at, size / 2);
    const fromRight = at.x < this.w * 0.6;
    const start = this.world(
      { x: fromRight ? this.w + size * 2 : -size * 2, y: at.y - Math.min(220, this.h * 0.25) * (Math.random() * 0.6 + 0.4) },
      size * 4,
    );
    const travel = new THREE.Vector3().subVectors(end, start).setZ(0).normalize();
    const axis = new THREE.Vector3(-travel.y, travel.x, 0).normalize();
    const turns = Math.PI * 2 * (2 + Math.floor(Math.random() * 2)) + Math.random() * Math.PI;
    const q = new THREE.Quaternion();
    await this.tween(1150, (t) => {
      const e = easeOutCubic(t);
      die.position.set(lerp(start.x, end.x, e), lerp(start.y, end.y, e), 0);
      // Decaying bounces.
      const bounce = Math.abs(Math.cos(t * Math.PI * 3.2)) * (1 - t) ** 2;
      die.position.z = end.z + bounce * size * 3.2;
      q.setFromAxisAngle(axis, -turns * (1 - e));
      die.quaternion.copy(final).premultiply(q);
    });
  }

  /** Show the die already at rest (e.g. after returning from the scorecard). */
  showDieStatic(value: number, at: ScreenPt, size = 54) {
    if (!this.enabled) return;
    const die = this.ensureDie(size);
    die.quaternion.setFromUnitVectors(FACE_NORMALS[FACE_VALUES.indexOf(value)], new THREE.Vector3(0, 0, 1));
    die.position.copy(this.world(at, size / 2));
    this.render();
  }

  async hideDie(): Promise<void> {
    if (!this.die || !this.die.visible) return;
    const die = this.die;
    const z0 = die.position.z;
    await this.tween(260, (t) => {
      this.setDieOpacity(1 - t);
      die.position.z = z0 + t * 30;
    });
    die.visible = false;
    this.render();
  }

  /** Keep a resting die glued to its slot when the layout changes. */
  placeDie(at: ScreenPt, size = 54) {
    if (!this.die || !this.die.visible) return;
    const p = this.world(at, size / 2);
    this.die.position.copy(p);
    this.render();
  }

  // ---------------------------------------------------------------- ball + pencil

  /**
   * Fly the paper ball from a to b. `onProgress` is called every frame (0..1) so the caller can draw the pencil line;
   * `tip` (if given) returns where the pencil tip should be at that moment.
   */
  async flyBall(
    a: ScreenPt,
    b: ScreenPt,
    opts: { radius: number; height: number; dur: number; onProgress?: (t: number) => void; tip?: (t: number) => ScreenPt },
  ): Promise<void> {
    if (!this.enabled) {
      opts.onProgress?.(1);
      return;
    }
    const r = opts.radius;
    const A = this.world(a, r);
    const B = this.world(b, r);
    this.ball.scale.setScalar(r);
    this.ball.visible = true;
    const travel = new THREE.Vector3().subVectors(B, A).setZ(0);
    const axis = new THREE.Vector3(-travel.y, travel.x, 0).normalize();
    const spin = travel.length() / r;
    const q0 = this.ball.quaternion.clone();
    const q = new THREE.Quaternion();
    if (opts.tip) this.showPencil(opts.tip(0));
    this.blob.visible = true;
    await this.tween(opts.dur, (t) => {
      const e = opts.height > 0 ? easeInOutSine(t) : easeOutCubic(t);
      const gx = lerp(A.x, B.x, e);
      const gy = lerp(A.y, B.y, e);
      // The camera looks straight down, so sell the arc 2.5D-style: lift the ball up the page and grow it,
      // while its blob shadow stays on the ground track and fades.
      const lift = 4 * opts.height * e * (1 - e);
      this.ball.position.set(gx, gy + lift * 0.75, r + lift * 0.3);
      this.ball.scale.setScalar(r * (1 + lift / (r * 9)));
      this.placeBlob(gx, gy, r, lift);
      if (axis.lengthSq() > 0) {
        q.setFromAxisAngle(axis, -spin * e);
        this.ball.quaternion.copy(q0).premultiply(q);
      }
      // The pencil traces the ground track right under the ball.
      opts.onProgress?.(e);
      if (opts.tip) this.movePencil(opts.tip(e));
    });
  }

  async sinkBall(at: ScreenPt, r: number): Promise<void> {
    if (!this.enabled) return;
    const P = this.world(at, r);
    await this.tween(380, (t) => {
      const e = easeOutCubic(t);
      this.ball.position.set(P.x, P.y, r * (1 - e) - r * 0.6 * e);
      this.ball.scale.setScalar(r * (1 - 0.65 * e));
      this.placeBlob(P.x, P.y, r * (1 - 0.7 * e), 0);
    });
    this.hideBall();
  }

  hideBall() {
    this.ball.visible = false;
    this.blob.visible = false;
    this.render();
  }

  private placeBlob(x: number, y: number, r: number, lift: number) {
    this.blob.position.set(x + lift * 0.08, y - lift * 0.05, 0.3);
    this.blob.scale.setScalar(r * 2.6 * (1 + lift / (r * 14)));
    (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.42 * (1 - Math.min(0.65, lift / (r * 10)));
  }

  showPencil(at: ScreenPt) {
    if (!this.enabled) return;
    this.pencil.visible = true;
    this.movePencil(at);
  }

  movePencil(at: ScreenPt) {
    // A gentle hover wobble makes it feel hand-held.
    const wob = Math.sin(performance.now() / 70) * 0.6;
    this.pencil.position.copy(this.world({ x: at.x + wob, y: at.y }, 0.5));
    this.render();
  }

  async pencilTrace(onProgress: (t: number) => void, tip: (t: number) => ScreenPt, dur: number): Promise<void> {
    if (!this.enabled) {
      onProgress(1);
      return;
    }
    this.showPencil(tip(0));
    await this.tween(dur, (t) => {
      onProgress(t);
      this.movePencil(tip(t));
    });
  }

  async liftPencil(): Promise<void> {
    if (!this.enabled || !this.pencil.visible) return;
    const p0 = this.pencil.position.clone();
    await this.tween(220, (t) => {
      this.pencil.position.set(p0.x + t * 60, p0.y + t * 40, p0.z + t * 160);
    });
    this.pencil.visible = false;
    this.render();
  }
}
