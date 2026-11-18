// 2D 檢視／修正：原圖上疊畫辨識結果，可點選、畫牆、加門窗柱、刪除。滾輪縮放、拖曳空白處平移。
import { type Plan, type El, type Wall, type Opening, distToSeg, newId, updateBounds, centroid } from './plan';

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'column' | 'delete';

export interface Editor2DEvents {
  onSelect(id: string | null): void;
  /** 修改後的 plan（呼叫端負責存進歷史、重建 3D） */
  onChange(plan: Plan, msg: string): void;
}

export class Editor2D {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  img: HTMLImageElement | null = null;
  plan: Plan | null = null;
  tool: Tool = 'select';
  selected: string | null = null;
  overlay = true;
  /** 世界（公尺）→ 畫面像素 */
  private view = { s: 40, x: 0, y: 0 };
  private drag: { sx: number; sy: number; vx: number; vy: number; pan: boolean; a?: [number, number]; b?: [number, number] } | null = null;
  private ro: ResizeObserver;
  /** 使用者自己縮放／平移過就不自動置中 */
  private userView = false;

  constructor(private host: HTMLElement, private ev: Editor2DEvents) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'plan2d';
    host.append(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => {
      if (!this.userView) this.fit();
      this.draw();
    });
    this.ro.observe(host);
    this.bind();
  }

  set(plan: Plan | null, img: HTMLImageElement | null, refit = false) {
    const changedImg = img !== this.img;
    this.plan = plan;
    this.img = img;
    if (refit || changedImg) this.fit();
    this.draw();
  }

  /** 公尺 ↔ 原圖像素 */
  private im() {
    return this.plan?.image ?? null;
  }

  fit() {
    this.userView = false;
    const r = this.host.getBoundingClientRect();
    const W = Math.max(50, r.width), H = Math.max(50, r.height);
    const im = this.im();
    let x0 = -5, x1 = 5, z0 = -4, z1 = 4;
    if (im && this.img) {
      x0 = -im.ox * im.mPerPx;
      x1 = (im.w - im.ox) * im.mPerPx;
      z0 = -im.oz * im.mPerPx;
      z1 = (im.h - im.oz) * im.mPerPx;
    } else if (this.plan) {
      x0 = -this.plan.width / 2 - 1;
      x1 = this.plan.width / 2 + 1;
      z0 = -this.plan.depth / 2 - 1;
      z1 = this.plan.depth / 2 + 1;
    }
    const s = Math.min(W / (x1 - x0), H / (z1 - z0)) * 0.96;
    this.view = { s, x: W / 2 - ((x0 + x1) / 2) * s, y: H / 2 - ((z0 + z1) / 2) * s };
  }

  private toScreen(x: number, z: number): [number, number] {
    return [x * this.view.s + this.view.x, z * this.view.s + this.view.y];
  }
  private toWorld(px: number, py: number): [number, number] {
    return [(px - this.view.x) / this.view.s, (py - this.view.y) / this.view.s];
  }

  draw() {
    const r = this.host.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
    if (this.canvas.width !== W * dpr || this.canvas.height !== H * dpr) {
      this.canvas.width = W * dpr;
      this.canvas.height = H * dpr;
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#f7f9fc';
    g.fillRect(0, 0, W, H);
    const im = this.im();
    if (this.img && im) {
      const [ix, iy] = this.toScreen(-im.ox * im.mPerPx, -im.oz * im.mPerPx);
      g.globalAlpha = this.overlay ? 0.55 : 1;
      g.drawImage(this.img, ix, iy, im.w * im.mPerPx * this.view.s, im.h * im.mPerPx * this.view.s);
      g.globalAlpha = 1;
    }
    const p = this.plan;
    if (!p || !this.overlay) return;
    const S = this.view.s;
    for (const e of p.elements) {
      if (e.type !== 'room') continue;
      g.beginPath();
      e.points.forEach(([x, z], i) => {
        const [sx, sy] = this.toScreen(x, z);
        if (i) g.lineTo(sx, sy);
        else g.moveTo(sx, sy);
      });
      g.closePath();
      g.fillStyle = (e.color ?? '#f1e3cc') + 'a0';
      g.fill();
      if (e.id === this.selected) {
        g.strokeStyle = '#2f7de0';
        g.lineWidth = 3;
        g.stroke();
      }
      const [cx, cz] = centroid(e.points);
      const [sx, sy] = this.toScreen(cx, cz);
      g.font = `600 ${Math.max(11, Math.min(18, S * 0.35))}px "Microsoft JhengHei", "PingFang TC", sans-serif`;
      g.fillStyle = '#1c2738';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(e.name, sx, sy);
    }
    for (const e of p.elements) {
      const on = e.id === this.selected;
      if (e.type === 'wall') {
        const [ax, ay] = this.toScreen(e.x1, e.z1), [bx, by] = this.toScreen(e.x2, e.z2);
        g.strokeStyle = on ? '#2f7de0' : '#d23a3a';
        g.lineWidth = Math.max(3, e.thickness * S);
        g.lineCap = 'square';
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      } else if (e.type === 'column') {
        const [sx, sy] = this.toScreen(e.x, e.z);
        g.fillStyle = on ? '#2f7de0' : '#9b3fd0';
        if (e.shape === 'round') {
          g.beginPath();
          g.arc(sx, sy, Math.max(4, (e.w * S) / 2), 0, Math.PI * 2);
          g.fill();
        } else g.fillRect(sx - Math.max(4, (e.w * S) / 2), sy - Math.max(4, (e.d * S) / 2), Math.max(8, e.w * S), Math.max(8, e.d * S));
      }
    }
    for (const e of p.elements) {
      if (e.type !== 'door' && e.type !== 'window') continue;
      const on = e.id === this.selected;
      const [sx, sy] = this.toScreen(e.x, e.z);
      const dx = Math.cos(e.angle) * (e.width / 2) * S, dy = Math.sin(e.angle) * (e.width / 2) * S;
      g.strokeStyle = on ? '#2f7de0' : e.type === 'door' ? '#f08a1c' : '#1fb5e0';
      g.lineWidth = Math.max(6, 0.22 * S);
      g.lineCap = 'butt';
      g.beginPath();
      g.moveTo(sx - dx, sy - dy);
      g.lineTo(sx + dx, sy + dy);
      g.stroke();
    }
    // 正在畫的牆
    if (this.drag?.a && this.drag.b) {
      const [ax, ay] = this.toScreen(...this.drag.a), [bx, by] = this.toScreen(...this.drag.b);
      g.strokeStyle = '#16a873';
      g.lineWidth = Math.max(3, 0.12 * S);
      g.setLineDash([8, 6]);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke();
      g.setLineDash([]);
      const L = Math.hypot(this.drag.b[0] - this.drag.a[0], this.drag.b[1] - this.drag.a[1]);
      g.fillStyle = '#16a873';
      g.font = '600 13px sans-serif';
      g.fillText(`${L.toFixed(2)} m`, (ax + bx) / 2, (ay + by) / 2 - 12);
    }
  }

  /** 找出點擊位置的元素（門窗柱優先，再來牆，最後房間） */
  hit(x: number, z: number): El | null {
    const p = this.plan;
    if (!p) return null;
    const tol = 10 / this.view.s;
    let best: El | null = null, bd = Infinity;
    for (const e of p.elements) {
      let d = Infinity;
      if (e.type === 'door' || e.type === 'window') {
        d = distToSeg(x, z, { x1: e.x - (Math.cos(e.angle) * e.width) / 2, z1: e.z - (Math.sin(e.angle) * e.width) / 2, x2: e.x + (Math.cos(e.angle) * e.width) / 2, z2: e.z + (Math.sin(e.angle) * e.width) / 2 }).d - 0.05;
      } else if (e.type === 'column') d = Math.max(0, Math.abs(x - e.x) - e.w / 2, Math.abs(z - e.z) - e.d / 2) - 0.04;
      else if (e.type === 'wall') d = distToSeg(x, z, e).d - e.thickness / 2;
      if (d < tol && d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best) return best;
    for (const e of p.elements) if (e.type === 'room' && inPoly(x, z, e.points)) return e;
    return null;
  }

  /** 對齊：靠近既有牆端點就吸附，並自動水平／垂直 */
  private snap(a: [number, number] | undefined, x: number, z: number): [number, number] {
    const tol = 12 / this.view.s;
    for (const e of this.plan?.elements ?? []) {
      if (e.type !== 'wall') continue;
      for (const [px, pz] of [[e.x1, e.z1], [e.x2, e.z2]]) if (Math.hypot(px - x, pz - z) < tol) return [px, pz];
    }
    if (a) {
      if (Math.abs(x - a[0]) < Math.abs(z - a[1]) * 0.15) x = a[0];
      else if (Math.abs(z - a[1]) < Math.abs(x - a[0]) * 0.15) z = a[1];
    }
    return [+x.toFixed(3), +z.toFixed(3)];
  }

  private bind() {
    const c = this.canvas;
    const pos = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as [number, number];
    };
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [px, py] = pos(e);
      const k = Math.exp(-e.deltaY * 0.0015);
      const s = Math.max(4, Math.min(600, this.view.s * k));
      const [wx, wz] = this.toWorld(px, py);
      this.userView = true;
      this.view.s = s;
      this.view.x = px - wx * s;
      this.view.y = py - wz * s;
      this.draw();
    }, { passive: false });
    // 兩指縮放／平移（手機、平板）
    const touches = new Map<number, [number, number]>();
    let pinch: { d: number; mx: number; my: number; s: number; vx: number; vy: number } | null = null;
    const pinchState = () => {
      const [a, b] = [...touches.values()];
      return { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
    };
    c.addEventListener('pointerdown', (e) => {
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        // 合成事件沒有真的指標
      }
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, pos(e));
        if (touches.size === 2) {
          // 第二根手指放下：取消正在畫的牆，改成縮放
          this.drag = null;
          pinch = { ...pinchState(), s: this.view.s, vx: this.view.x, vy: this.view.y };
          this.draw();
          return;
        }
        if (touches.size > 2) return;
      }
      const [px, py] = pos(e);
      const [wx, wz] = this.toWorld(px, py);
      const pan = e.button === 1 || e.button === 2 || (this.tool === 'select' && !this.hit(wx, wz));
      this.drag = { sx: px, sy: py, vx: this.view.x, vy: this.view.y, pan };
      if (this.tool === 'wall' && e.button === 0) {
        this.drag.pan = false;
        this.drag.a = this.snap(undefined, wx, wz);
        this.drag.b = this.drag.a;
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (touches.has(e.pointerId)) touches.set(e.pointerId, pos(e));
      if (pinch && touches.size >= 2) {
        const now = pinchState();
        const s = Math.max(4, Math.min(600, (pinch.s * now.d) / pinch.d));
        // 兩指中點下的那一點保持不動，再加上中點的移動量
        const wx = (pinch.mx - pinch.vx) / pinch.s, wz = (pinch.my - pinch.vy) / pinch.s;
        this.userView = true;
        this.view = { s, x: now.mx - wx * s, y: now.my - wz * s };
        this.draw();
        return;
      }
      if (!this.drag) return;
      const [px, py] = pos(e);
      if (this.drag.a) {
        const [wx, wz] = this.toWorld(px, py);
        this.drag.b = this.snap(this.drag.a, wx, wz);
        this.draw();
      } else if (this.drag.pan) {
        this.userView = true;
        this.view.x = this.drag.vx + px - this.drag.sx;
        this.view.y = this.drag.vy + py - this.drag.sy;
        this.draw();
      }
    });
    const lift = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (pinch && touches.size < 2) {
        pinch = null;
        this.drag = null;
        return true;
      }
      return false;
    };
    c.addEventListener('pointercancel', (e) => {
      lift(e);
      this.drag = null;
    });
    c.addEventListener('pointerup', (e) => {
      if (lift(e)) return;
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      const [px, py] = pos(e);
      const moved = Math.hypot(px - d.sx, py - d.sy) > 4;
      const [wx, wz] = this.toWorld(px, py);
      if (d.a && d.b) {
        const L = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);
        if (L > 0.2) this.addWall(d.a, d.b);
        this.draw();
        return;
      }
      if (moved && d.pan) return;
      this.click(wx, wz);
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private change(fn: (p: Plan) => string | null) {
    if (!this.plan) return;
    const p: Plan = JSON.parse(JSON.stringify(this.plan));
    const msg = fn(p);
    if (msg === null) return;
    updateBounds(p);
    this.ev.onChange(p, msg);
  }

  addWall(a: [number, number], b: [number, number]) {
    const id = newId('wall');
    this.change((p) => {
      p.elements.push({ id, type: 'wall', x1: a[0], z1: a[1], x2: b[0], z2: b[1], thickness: 0.12, height: p.wallHeight } as Wall);
      return `已新增一道牆（${Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(2)} 公尺）`;
    });
    this.selected = id;
    this.ev.onSelect(id);
  }

  click(x: number, z: number) {
    const el = this.hit(x, z);
    if (this.tool === 'select') {
      this.selected = el?.id ?? null;
      this.ev.onSelect(this.selected);
      this.draw();
    } else if (this.tool === 'delete') {
      if (!el) return;
      this.change((p) => {
        p.elements = p.elements.filter((q) => q.id !== el.id);
        return `已刪除${{ wall: '牆', door: '門', window: '窗', column: '柱', room: '房間' }[el.type]}`;
      });
    } else if (this.tool === 'column') {
      const id = newId('column');
      this.change((p) => {
        p.elements.push({ id, type: 'column', x, z, w: 0.4, d: 0.4, height: p.wallHeight, shape: 'box' });
        return '已新增柱子';
      });
    } else if (this.tool === 'door' || this.tool === 'window') {
      // 放在最近的牆上
      const walls = (this.plan?.elements ?? []).filter((e): e is Wall => e.type === 'wall');
      let best: Wall | null = null, bd = Infinity, q = { qx: 0, qz: 0 };
      for (const w of walls) {
        const r = distToSeg(x, z, w);
        if (r.d < bd) {
          bd = r.d;
          best = w;
          q = r;
        }
      }
      if (!best || bd > 0.8) return;
      const w = best;
      const t = this.tool;
      const id = newId(t);
      this.change((p) => {
        p.elements.push({ id, type: t, x: q.qx, z: q.qz, width: t === 'door' ? 0.9 : 1.5, height: t === 'door' ? 2.1 : 1.2, sill: t === 'door' ? 0 : 0.9, angle: Math.atan2(w.z2 - w.z1, w.x2 - w.x1) } as Opening);
        return t === 'door' ? '已新增門' : '已新增窗';
      });
    }
  }

  dispose() {
    this.ro.disconnect();
  }
}

function inPoly(x: number, z: number, pts: [number, number][]) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
