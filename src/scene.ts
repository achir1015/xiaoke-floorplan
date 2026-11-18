// 3D 場景：依 Plan 產生牆（自動挖門窗洞）、門片、窗框玻璃、柱子、房間地板與名稱；
// 鳥瞰（OrbitControls）／漫遊（第一人稱、碰撞、手機搖桿）／VR（WebXR，瞬移＋搖桿移動）；匯出 GLB／USDZ／OBJ。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { type Plan, type Wall, type Opening, type El, centroid, distToSeg, hostWall, polygonArea, wallLen } from './plan';

export type ViewMode = 'orbit' | 'walk';

const EYE = 1.6;

function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 512);
  // 木地板條紋（灰階，顏色由材質 color 決定）
  for (let i = 0; i < 8; i++) {
    const y = i * 64;
    const shade = 225 + ((i * 37) % 30);
    g.fillStyle = `rgb(${shade},${shade},${shade})`;
    g.fillRect(0, y, 512, 62);
    g.fillStyle = 'rgba(0,0,0,.18)';
    g.fillRect(0, y + 62, 512, 2);
    const off = (i * 173) % 512;
    g.fillRect(off, y, 2, 62);
    g.strokeStyle = 'rgba(0,0,0,.05)';
    for (let k = 0; k < 6; k++) {
      g.beginPath();
      g.moveTo(0, y + 8 + k * 9);
      g.bezierCurveTo(170, y + 4 + k * 9 + (k % 2) * 6, 340, y + 12 + k * 9, 512, y + 8 + k * 9);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function labelSprite(text: string, sub: string) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = '600 46px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
  g.font = font;
  const w = Math.max(g.measureText(text).width, sub ? g.measureText(sub).width * 0.7 : 0) + 40;
  c.width = Math.ceil(w);
  c.height = sub ? 110 : 70;
  g.font = font;
  g.fillStyle = 'rgba(255,255,255,.88)';
  g.beginPath();
  g.roundRect(0, 0, c.width, c.height, 18);
  g.fill();
  g.fillStyle = '#1c2738';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, 36);
  if (sub) {
    g.font = '500 32px "Microsoft JhengHei", "PingFang TC", sans-serif';
    g.fillStyle = '#5a6a80';
    g.fillText(sub, c.width / 2, 82);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const h = sub ? 0.75 : 0.48;
  s.scale.set((h * c.width) / c.height, h, 1);
  s.renderOrder = 10;
  return s;
}

export interface SceneEvents {
  onSelect?: (id: string | null) => void;
  onMode?: (m: ViewMode | 'vr') => void;
}

export class PlanScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  /** 建築本體（匯出用） */
  readonly model = new THREE.Group();
  readonly labels = new THREE.Group();
  /** VR／漫遊時的「身體」 */
  readonly dolly = new THREE.Group();
  plan: Plan | null = null;
  mode: ViewMode = 'orbit';
  night = false;
  showLabels = true;
  selected: string | null = null;
  private wood = woodTexture();
  private hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.4);
  private sun = new THREE.DirectionalLight(0xfff3df, 2.2);
  private lamps = new THREE.Group();
  private ground: THREE.Mesh;
  private floors: THREE.Object3D[] = [];
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private joy = { x: 0, y: 0 };
  private clock = new THREE.Clock();
  private ray = new THREE.Raycaster();
  private resizeObs: ResizeObserver;
  private ev: SceneEvents;
  private walls: Wall[] = [];
  private openings: Opening[] = [];

  constructor(private host: HTMLElement, ev: SceneEvents = {}) {
    this.ev = ev;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.xr.enabled = true;
    host.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 500);
    this.camera.position.set(10, 12, 14);
    this.dolly.add(this.camera);
    this.scene.add(this.dolly, this.model, this.labels, this.hemi, this.sun, this.lamps);
    this.scene.background = new THREE.Color(0xdfe9f5);
    this.scene.fog = new THREE.Fog(0xdfe9f5, 60, 160);
    this.sun.position.set(12, 20, 8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(80, 48), new THREE.MeshStandardMaterial({ color: 0xc9d8c2, roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.02;
    this.ground.receiveShadow = true;
    this.ground.name = 'ground';
    this.scene.add(this.ground);
    const grid = new THREE.GridHelper(80, 80, 0xa9b9a3, 0xb9c8b3);
    grid.position.y = -0.015;
    this.scene.add(grid);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 120;

    this.bindInput();
    this.setupXR();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------- 建模 ----------------

  build(plan: Plan, keepView = true) {
    const first = !this.plan;
    this.plan = plan;
    const dispose = (g: THREE.Object3D) => {
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        mats.forEach((x) => {
          (x as THREE.SpriteMaterial).map && (x as THREE.SpriteMaterial).map !== this.wood && (x as THREE.SpriteMaterial).map!.dispose();
          x.dispose();
        });
      });
      g.clear();
    };
    dispose(this.model);
    dispose(this.labels);
    this.lamps.clear();
    this.floors = [];
    this.walls = plan.elements.filter((e): e is Wall => e.type === 'wall');
    this.openings = plan.elements.filter((e): e is Opening => e.type === 'door' || e.type === 'window');

    // 整體地板（含房間以外的走道）
    const half = { w: plan.width / 2 + 0.05, d: plan.depth / 2 + 0.05 };
    const cx = this.boundsCenter();
    const baseMat = new THREE.MeshStandardMaterial({ color: plan.floorColor, map: this.wood, roughness: 0.75 });
    baseMat.map!.repeat.set(1 / 2, 1 / 2);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(half.w * 2, half.d * 2), baseMat);
    base.rotation.x = -Math.PI / 2;
    base.position.set(cx.x, 0.002, cx.z);
    base.receiveShadow = true;
    base.name = '地板';
    base.userData = { id: '__floor', kind: 'floor' };
    this.model.add(base);
    this.floors.push(base);
    this.setWoodUV(base.geometry as THREE.PlaneGeometry, half.w * 2, half.d * 2);

    for (const e of plan.elements) {
      const g = new THREE.Group();
      g.userData = { id: e.id, kind: e.type };
      g.name = `${e.type}-${e.id}`;
      if (e.type === 'wall') this.buildWall(e, g);
      else if (e.type === 'door' || e.type === 'window') this.buildOpening(e, g);
      else if (e.type === 'column') {
        const mat = new THREE.MeshStandardMaterial({ color: e.color ?? '#e6e1d8', roughness: 0.8 });
        const geo = e.shape === 'round' ? new THREE.CylinderGeometry(e.w / 2, e.w / 2, e.height, 32) : new THREE.BoxGeometry(e.w, e.height, e.d);
        const m = new THREE.Mesh(geo, mat);
        m.position.set(e.x, e.height / 2, e.z);
        m.castShadow = m.receiveShadow = true;
        g.add(m);
      } else if (e.type === 'room') {
        const shape = new THREE.Shape(e.points.map(([x, z]) => new THREE.Vector2(x, -z)));
        const geo = new THREE.ShapeGeometry(shape);
        const mat = new THREE.MeshStandardMaterial({ color: e.color ?? '#f1e3cc', map: this.wood, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
        // UV：每 2 公尺一片木紋
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        const pos = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 2, pos.getY(i) / 2);
        const m = new THREE.Mesh(geo, mat);
        m.rotation.x = -Math.PI / 2;
        m.position.y = 0.006;
        m.receiveShadow = true;
        g.add(m);
        this.floors.push(m);
        const [lx, lz] = centroid(e.points);
        const area = polygonArea(e.points);
        const s = labelSprite(e.name, `${area.toFixed(1)} m²・${(area / 3.3058).toFixed(1)} 坪`);
        s.position.set(lx, Math.min(plan.wallHeight + 0.6, 3.6), lz);
        s.userData = { id: e.id, kind: 'label' };
        this.labels.add(s);
        // 夜晚燈光
        const lamp = new THREE.PointLight(0xffd9a0, 0, 9, 1.6);
        lamp.position.set(lx, Math.max(2.2, plan.wallHeight - 0.4), lz);
        this.lamps.add(lamp);
      }
      this.model.add(g);
    }
    if (plan.showRoof) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(half.w * 2 + 0.3, 0.15, half.d * 2 + 0.3), new THREE.MeshStandardMaterial({ color: 0x9a8f86, roughness: 0.9 }));
      roof.position.set(cx.x, plan.wallHeight + 0.075, cx.z);
      roof.castShadow = true;
      roof.name = '屋頂';
      roof.userData = { id: '__roof', kind: 'roof' };
      this.model.add(roof);
    }
    this.labels.visible = this.showLabels && this.mode === 'orbit';
    // 陰影範圍跟著建築大小
    const R = Math.max(plan.width, plan.depth) * 0.75 + 4;
    Object.assign(this.sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 80 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.position.set(cx.x + R * 0.6, 22, cx.z + R * 0.4);
    this.sun.target.position.set(cx.x, 0, cx.z);
    this.sun.target.updateMatrixWorld();
    this.applyLighting();
    if (first || !keepView) this.resetView();
    this.highlight(this.selected);
  }

  private setWoodUV(geo: THREE.PlaneGeometry, w: number, d: number) {
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 2, (uv.getY(i) * d) / 2);
    (this.wood as THREE.Texture).repeat.set(1, 1);
  }

  private boundsCenter() {
    const box = new THREE.Box3();
    const p = this.plan;
    if (!p) return new THREE.Vector3();
    for (const e of p.elements) {
      if (e.type === 'wall') {
        box.expandByPoint(new THREE.Vector3(e.x1, 0, e.z1));
        box.expandByPoint(new THREE.Vector3(e.x2, 0, e.z2));
      } else if (e.type === 'room') e.points.forEach(([x, z]) => box.expandByPoint(new THREE.Vector3(x, 0, z)));
      else box.expandByPoint(new THREE.Vector3(e.x, 0, e.z));
    }
    return box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  }

  private buildWall(w: Wall, g: THREE.Group) {
    const L = wallLen(w);
    const ang = Math.atan2(w.z2 - w.z1, w.x2 - w.x1);
    const mat = new THREE.MeshStandardMaterial({ color: w.color ?? this.plan!.wallColor, roughness: 0.92 });
    const H = w.height;
    // 每道牆的高度差一點點，避免牆角重疊處上緣閃爍
    const eps = (parseInt(w.id.replace(/\D/g, '').slice(-3) || '0', 10) % 7) * 0.0007;
    const ext = w.thickness / 2;
    const holes = this.openings
      .filter((o) => hostWall(o, [w]) === w)
      .map((o) => {
        const { t } = distToSeg(o.x, o.z, w);
        const u = t * L - L / 2;
        return { a: u - o.width / 2, b: u + o.width / 2, sill: o.sill, top: Math.min(H, o.sill + o.height) };
      })
      .sort((p, q) => p.a - q.a);
    const piece = (a: number, b: number, y0: number, y1: number) => {
      if (b - a < 0.005 || y1 - y0 < 0.005) return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(b - a, y1 - y0, w.thickness), mat);
      m.position.set((a + b) / 2, (y0 + y1) / 2, 0);
      m.castShadow = m.receiveShadow = true;
      wrap.add(m);
    };
    const wrap = new THREE.Group();
    wrap.position.set((w.x1 + w.x2) / 2, 0, (w.z1 + w.z2) / 2);
    wrap.rotation.y = -ang;
    let cur = -L / 2 - ext;
    for (const h of holes) {
      const a = Math.max(cur, h.a), b = Math.min(L / 2 + ext, h.b);
      if (b <= a) continue;
      piece(cur, a, 0, H + eps);
      piece(a, b, 0, h.sill);
      piece(a, b, h.top, H + eps);
      cur = b;
    }
    piece(cur, L / 2 + ext, 0, H + eps);
    g.add(wrap);
  }

  private buildOpening(o: Opening, g: THREE.Group) {
    const wall = hostWall(o, this.walls);
    const t = wall?.thickness ?? 0.15;
    const ang = wall ? Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1) : o.angle;
    const wrap = new THREE.Group();
    wrap.position.set(o.x, 0, o.z);
    wrap.rotation.y = -ang;
    g.add(wrap);
    const frameMat = new THREE.MeshStandardMaterial({ color: o.type === 'door' ? '#6b4a2f' : '#f7f7f5', roughness: 0.6 });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      wrap.add(m);
      return m;
    };
    const W = o.width, H = o.height, y0 = o.sill;
    const fw = 0.05;
    // 門框／窗框
    box(fw, H, t + 0.02, -W / 2 + fw / 2, y0 + H / 2, 0, frameMat);
    box(fw, H, t + 0.02, W / 2 - fw / 2, y0 + H / 2, 0, frameMat);
    box(W, fw, t + 0.02, 0, y0 + H - fw / 2, 0, frameMat);
    if (o.type === 'door') {
      const leafMat = new THREE.MeshStandardMaterial({ color: o.color ?? '#a8784f', roughness: 0.55 });
      const pivot = new THREE.Group();
      pivot.position.set(-W / 2 + fw, 0, t / 2);
      pivot.rotation.y = -1.15;
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(W - 2 * fw, H - fw, 0.04), leafMat);
      leaf.position.set((W - 2 * fw) / 2, (H - fw) / 2, 0);
      leaf.castShadow = true;
      pivot.add(leaf);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardMaterial({ color: '#d4b24c', metalness: 0.8, roughness: 0.3 }));
      knob.position.set(W - 2 * fw - 0.08, 1.0, 0.04);
      pivot.add(knob);
      wrap.add(pivot);
    } else {
      box(W, fw, t + 0.02, 0, y0 + fw / 2, 0, frameMat);
      if (W > 1.2) box(fw * 0.7, H, 0.04, 0, y0 + H / 2, 0, frameMat);
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(W - 2 * fw, H - 2 * fw, 0.02),
        new THREE.MeshStandardMaterial({ color: o.color ?? '#a9d8ff', transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1, depthWrite: false }),
      );
      glass.position.set(0, y0 + H / 2, 0);
      wrap.add(glass);
    }
  }

  // ---------------- 選取 ----------------

  highlight(id: string | null) {
    this.selected = id;
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      let p: THREE.Object3D | null = m;
      while (p && !p.userData?.id) p = p.parent;
      const on = !!id && p?.userData?.id === id;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat?.emissive) {
        mat.emissive.set(on ? 0x2f7de0 : 0x000000);
        mat.emissiveIntensity = on ? 0.55 : 0;
      }
    });
  }

  private pick(clientX: number, clientY: number): string | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hits = this.ray.intersectObjects(this.model.children, true);
    // 優先選牆、門窗、柱（地板在最下面）
    for (const h of hits) {
      let p: THREE.Object3D | null = h.object;
      while (p && !p.userData?.id) p = p.parent;
      const id = p?.userData?.id as string | undefined;
      if (id && !id.startsWith('__')) return id;
    }
    return null;
  }

  // ---------------- 視角 ----------------

  resetView() {
    const p = this.plan;
    const c = this.boundsCenter();
    const R = p ? Math.max(p.width, p.depth) : 10;
    this.setMode('orbit');
    this.dolly.position.set(0, 0, 0);
    this.camera.position.set(c.x + R * 0.55, R * 0.95 + 3, c.z + R * 0.95);
    this.controls.target.copy(c);
    this.controls.update();
  }

  topView() {
    const p = this.plan;
    const c = this.boundsCenter();
    const R = p ? Math.max(p.width, p.depth) : 10;
    this.setMode('orbit');
    this.camera.position.set(c.x, R * 1.35 + 2, c.z + 0.01);
    this.controls.target.copy(c);
    this.controls.update();
  }

  /** 漫遊起點：大門內側；沒有門就在最大房間中央 */
  private startPoint() {
    const p = this.plan;
    if (!p) return { x: 0, z: 0, yaw: 0 };
    const c = this.boundsCenter();
    const rooms = p.elements.filter((e) => e.type === 'room').sort((a, b) => polygonArea((b as never as { points: [number, number][] }).points) - polygonArea((a as never as { points: [number, number][] }).points));
    let [x, z] = [c.x, c.z];
    if (rooms.length && rooms[0].type === 'room') [x, z] = centroid(rooms[0].points);
    // 面向最開闊的方向（不要一進去就對著牆）
    let best = 0, yaw = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const dx = -Math.sin(a), dz = -Math.cos(a);
      let d = 0;
      while (d < 30 && !this.blocked(x + dx * (d + 0.2), z + dz * (d + 0.2))) d += 0.2;
      if (d > best) {
        best = d;
        yaw = a;
      }
    }
    return { x, z, yaw };
  }

  setMode(m: ViewMode) {
    if (m === this.mode) return;
    this.mode = m;
    this.controls.enabled = m === 'orbit';
    // 漫遊時房間名稱會擋視線：只在鳥瞰顯示
    this.labels.visible = this.showLabels && m === 'orbit';
    if (m === 'walk') {
      const s = this.startPoint();
      this.camera.position.set(s.x, EYE, s.z);
      this.yaw = s.yaw;
      this.pitch = 0;
      this.applyLook();
    } else {
      this.camera.rotation.set(0, 0, 0);
    }
    this.ev.onMode?.(m);
  }

  private applyLook() {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  setNight(on: boolean) {
    this.night = on;
    this.applyLighting();
  }

  private applyLighting() {
    const n = this.night;
    this.hemi.intensity = n ? 0.25 : 1.4;
    this.sun.intensity = n ? 0.08 : 2.2;
    (this.scene.background as THREE.Color).set(n ? 0x101a2c : 0xdfe9f5);
    (this.scene.fog as THREE.Fog).color.set(n ? 0x101a2c : 0xdfe9f5);
    this.lamps.children.forEach((l) => ((l as THREE.PointLight).intensity = n ? 14 : 0));
  }

  setLabels(on: boolean) {
    this.showLabels = on;
    this.labels.visible = on && this.mode === 'orbit';
  }

  // ---------------- 輸入 ----------------

  private bindInput() {
    const el = this.renderer.domElement;
    el.tabIndex = 0;
    let down: { x: number; y: number; moved: boolean } | null = null;
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, moved: false };
      if (this.mode === 'walk') el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true;
      if (this.mode === 'walk' && down.moved) {
        this.yaw -= e.movementX * 0.004;
        this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - e.movementY * 0.004));
        this.applyLook();
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (down && !down.moved) {
        const id = this.pick(e.clientX, e.clientY);
        this.highlight(id);
        this.ev.onSelect?.(id);
      }
      down = null;
    });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** 手機搖桿：x 左右、y 前後（-1~1） */
  setJoystick(x: number, y: number) {
    this.joy = { x, y };
  }

  private blocked(x: number, z: number) {
    const r = 0.22;
    for (const w of this.walls) {
      const { d, t } = distToSeg(x, z, w);
      if (d > w.thickness / 2 + r) continue;
      // 在門洞（或落地窗）範圍內可以通過
      const L = wallLen(w);
      const u = t * L;
      const pass = this.openings.some((o) => {
        if (o.sill > 0.3 || hostWall(o, [w]) !== w) return false;
        const ou = distToSeg(o.x, o.z, w).t * L;
        return Math.abs(u - ou) < o.width / 2 - r * 0.6;
      });
      if (!pass) return true;
    }
    for (const e of this.plan?.elements ?? []) {
      if (e.type === 'column' && Math.abs(x - e.x) < e.w / 2 + r && Math.abs(z - e.z) < e.d / 2 + r) return true;
    }
    return false;
  }

  private moveBy(obj: THREE.Object3D, fx: number, fz: number) {
    const nx = obj.position.x + fx, nz = obj.position.z + fz;
    if (!this.blocked(nx, nz)) obj.position.set(nx, obj.position.y, nz);
    else if (!this.blocked(nx, obj.position.z)) obj.position.x = nx;
    else if (!this.blocked(obj.position.x, nz)) obj.position.z = nz;
  }

  private tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.renderer.xr.isPresenting) this.xrMove(dt);
    else if (this.mode === 'walk') {
      const k = this.keys;
      let f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) + -this.joy.y;
      let s = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0) + this.joy.x;
      if (k.has('arrowleft')) this.yaw += 1.8 * dt;
      if (k.has('arrowright')) this.yaw -= 1.8 * dt;
      if (k.has('arrowleft') || k.has('arrowright')) this.applyLook();
      f = Math.max(-1, Math.min(1, f));
      s = Math.max(-1, Math.min(1, s));
      const speed = (k.has('shift') ? 4 : 2.2) * dt;
      if (f || s) {
        const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
        this.moveBy(this.camera, (-sin * f + cos * s) * speed, (-cos * f - sin * s) * speed);
      }
    } else this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ---------------- VR ----------------

  private controllers: THREE.Group[] = [];
  private marker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.25, 32), new THREE.MeshBasicMaterial({ color: 0x5ae6ff }));

  private setupXR() {
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.scene.add(this.marker);
    for (let i = 0; i < 2; i++) {
      const c = this.renderer.xr.getController(i);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -6)]), new THREE.LineBasicMaterial({ color: 0x5ae6ff }));
      c.add(line);
      c.addEventListener('selectend', () => {
        if (this.marker.visible) this.dolly.position.set(this.marker.position.x, 0, this.marker.position.z);
      });
      this.dolly.add(c);
      this.controllers.push(c);
    }
    this.renderer.xr.addEventListener('sessionstart', () => {
      const s = this.startPoint();
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
      this.dolly.position.set(s.x, 0, s.z);
      this.dolly.rotation.set(0, s.yaw, 0);
      this.labels.visible = false;
      this.ev.onMode?.('vr');
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.dolly.position.set(0, 0, 0);
      this.dolly.rotation.set(0, 0, 0);
      this.marker.visible = false;
      this.mode = 'walk';
      this.setMode('orbit');
      this.resetView();
    });
  }

  private xrMove(dt: number) {
    // 控制器指向地板 → 顯示瞬移落點
    this.marker.visible = false;
    for (const c of this.controllers) {
      const m = new THREE.Matrix4().extractRotation(c.matrixWorld);
      this.ray.ray.origin.setFromMatrixPosition(c.matrixWorld);
      this.ray.ray.direction.set(0, 0, -1).applyMatrix4(m);
      const hit = this.ray.intersectObjects(this.floors, false)[0];
      if (hit) {
        this.marker.position.set(hit.point.x, 0.02, hit.point.z);
        this.marker.visible = true;
        break;
      }
    }
    // 搖桿平滑移動（左手）與轉向（右手）
    const session = this.renderer.xr.getSession();
    if (!session) return;
    const head = this.renderer.xr.getCamera();
    const dir = new THREE.Vector3();
    head.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();
    for (const src of session.inputSources) {
      const ax = src.gamepad?.axes;
      if (!ax || ax.length < 4) continue;
      const x = Math.abs(ax[2]) > 0.15 ? ax[2] : 0, y = Math.abs(ax[3]) > 0.15 ? ax[3] : 0;
      if (src.handedness === 'right') {
        this.dolly.rotation.y -= x * 1.6 * dt;
      } else if (x || y) {
        const right = new THREE.Vector3(-dir.z, 0, dir.x);
        const v = dir.clone().multiplyScalar(-y).add(right.multiplyScalar(x)).multiplyScalar(1.8 * dt);
        this.moveBy(this.dolly, v.x, v.z);
      }
    }
  }

  async vrSupported() {
    try {
      return !!(navigator as Navigator & { xr?: XRSystem }).xr && (await (navigator as Navigator & { xr: XRSystem }).xr.isSessionSupported('immersive-vr'));
    } catch {
      return false;
    }
  }

  async enterVR() {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) throw new Error('這個瀏覽器不支援 WebXR');
    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);
  }

  // ---------------- 匯出 ----------------

  private exportRoot() {
    const root = this.model.clone(true);
    root.name = this.plan?.name || '平面圖';
    // 取消選取的高亮
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        if (mat.emissive) mat.emissive.set(0);
        m.material = mat;
      }
    });
    return root;
  }

  async exportGLB(): Promise<Blob> {
    const data = (await new GLTFExporter().parseAsync(this.exportRoot(), { binary: true })) as ArrayBuffer;
    return new Blob([data], { type: 'model/gltf-binary' });
  }

  async exportUSDZ(): Promise<Blob> {
    const root = this.exportRoot();
    const scene = new THREE.Scene();
    scene.add(root);
    const data = await new USDZExporter().parseAsync(scene);
    return new Blob([data as BlobPart], { type: 'model/vnd.usdz+zip' });
  }

  exportOBJ(): Blob {
    return new Blob([new OBJExporter().parse(this.exportRoot())], { type: 'text/plain' });
  }

  /** 3D 列印用（公尺 → 公釐，縮小 1/100） */
  exportSTL(): Blob {
    const root = this.exportRoot();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material).transparent) m.visible = false;
    });
    root.scale.setScalar(10);
    root.updateMatrixWorld(true);
    const data = new STLExporter().parse(root, { binary: true }) as DataView;
    return new Blob([data.buffer as ArrayBuffer], { type: 'model/stl' });
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /** 讓教學示範能看到某個元素 */
  focus(el: El | null) {
    if (!el || this.mode !== 'orbit') return;
    let x = 0, z = 0;
    if (el.type === 'wall') [x, z] = [(el.x1 + el.x2) / 2, (el.z1 + el.z2) / 2];
    else if (el.type === 'room') [x, z] = centroid(el.points);
    else [x, z] = [el.x, el.z];
    this.controls.target.set(x, 1, z);
    this.controls.update();
  }

  dispose() {
    this.resizeObs.disconnect();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}
