// 平面圖資料格式（公尺）：x 往右、z 往下（對應圖片），y 往上；原點在建築中心。
// 牆用線段表示（可斜牆），門窗掛在牆上（依位置自動挖洞），房間是多邊形地板。

export type ElType = 'wall' | 'door' | 'window' | 'column' | 'room';

export interface Wall {
  id: string;
  type: 'wall';
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  thickness: number;
  height: number;
  color?: string;
}

export interface Opening {
  id: string;
  type: 'door' | 'window';
  /** 中心位置 */
  x: number;
  z: number;
  width: number;
  height: number;
  /** 窗台高度（門為 0） */
  sill: number;
  /** 沿牆方向的角度（弧度） */
  angle: number;
  color?: string;
}

export interface Column {
  id: string;
  type: 'column';
  x: number;
  z: number;
  /** 方柱寬深；圓柱用 w 當直徑 */
  w: number;
  d: number;
  height: number;
  shape: 'box' | 'round';
  color?: string;
}

export interface Room {
  id: string;
  type: 'room';
  name: string;
  points: [number, number][];
  color?: string;
}

export type El = Wall | Opening | Column | Room;

export interface Plan {
  version: 1;
  name: string;
  /** 預設牆高 */
  wallHeight: number;
  /** 建築外框（公尺） */
  width: number;
  depth: number;
  floorColor: string;
  wallColor: string;
  showRoof: boolean;
  elements: El[];
  /** 原圖對應：像素 → 公尺 */
  image?: { w: number; h: number; mPerPx: number; ox: number; oz: number };
}

export const TYPE_NAME: Record<ElType, string> = { wall: '牆', door: '門', window: '窗', column: '柱', room: '房間' };

let seq = 0;
export const newId = (t: string) => `${t[0]}${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}`;

export function emptyPlan(name = '新的平面圖'): Plan {
  return { version: 1, name, wallHeight: 3, width: 10, depth: 8, floorColor: '#c8a27a', wallColor: '#f2efe9', showRoof: false, elements: [] };
}

export const wallLen = (w: Wall) => Math.hypot(w.x2 - w.x1, w.z2 - w.z1);

export function polygonArea(p: [number, number][]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, z1] = p[i];
    const [x2, z2] = p[(i + 1) % p.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}

export function centroid(p: [number, number][]): [number, number] {
  let x = 0, z = 0;
  for (const q of p) {
    x += q[0];
    z += q[1];
  }
  return [x / Math.max(1, p.length), z / Math.max(1, p.length)];
}

/** 點到線段的距離與投影位置 t（0~1） */
export function distToSeg(px: number, pz: number, w: { x1: number; z1: number; x2: number; z2: number }) {
  const dx = w.x2 - w.x1, dz = w.z2 - w.z1;
  const L2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - w.x1) * dx + (pz - w.z1) * dz) / L2;
  t = Math.max(0, Math.min(1, t));
  const qx = w.x1 + t * dx, qz = w.z1 + t * dz;
  return { d: Math.hypot(px - qx, pz - qz), t, qx, qz };
}

/** 找門窗所在的牆 */
export function hostWall(o: Opening, walls: Wall[]): Wall | null {
  let best: Wall | null = null;
  let bd = Infinity;
  for (const w of walls) {
    const { d } = distToSeg(o.x, o.z, w);
    const ang = Math.atan2(w.z2 - w.z1, w.x2 - w.x1);
    let da = Math.abs(((ang - o.angle) % Math.PI + Math.PI) % Math.PI);
    da = Math.min(da, Math.PI - da);
    if (d < Math.max(0.35, w.thickness) && da < 0.3 && d < bd) {
      bd = d;
      best = w;
    }
  }
  return best;
}

/** 重新計算外框尺寸 */
export function updateBounds(plan: Plan) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const add = (x: number, z: number) => {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  };
  for (const e of plan.elements) {
    if (e.type === 'wall') {
      add(e.x1, e.z1);
      add(e.x2, e.z2);
    } else if (e.type === 'room') e.points.forEach((p) => add(p[0], p[1]));
    else add(e.x, e.z);
  }
  if (x0 === Infinity) return;
  plan.width = +(x1 - x0).toFixed(2);
  plan.depth = +(z1 - z0).toFixed(2);
}

// ---- AI 輸出修復與驗證（AI 回傳的 JSON 常有 ```、尾逗號、截斷） ----

export function repairJson(text: string): unknown {
  let s = String(text ?? '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = s.search(/[[{]/);
  if (start > 0) s = s.slice(start);
  const tryParse = (t: string) => {
    try {
      return { ok: true, v: JSON.parse(t) };
    } catch {
      return { ok: false, v: null };
    }
  };
  let r = tryParse(s);
  if (r.ok) return r.v;
  s = s.replace(/,\s*([}\]])/g, '$1').replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/'/g, '"');
  r = tryParse(s);
  if (r.ok) return r.v;
  // 截斷：補齊括號
  const stack: string[] = [];
  let inStr = false;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      stack.pop();
      last = i;
    }
  }
  let cut = s.slice(0, last + 1).replace(/,\s*$/, '');
  const st2: string[] = [];
  inStr = false;
  for (let i = 0; i < cut.length; i++) {
    const c = cut[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') st2.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') st2.pop();
  }
  cut += st2.reverse().join('');
  r = tryParse(cut.replace(/,\s*([}\]])/g, '$1'));
  if (r.ok) return r.v;
  throw new Error('AI 回傳的資料無法解析');
}

const num = (v: unknown, def: number, min = -1e4, max = 1e4) => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};
const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined);

/** 把任何來源（AI、檔案）的資料整理成正確的 Plan */
export function normalizePlan(raw: unknown, base?: Plan): Plan {
  const src = (raw ?? {}) as Record<string, unknown>;
  const arr = Array.isArray(raw) ? raw : Array.isArray(src.elements) ? (src.elements as unknown[]) : [];
  const p = emptyPlan(typeof src.name === 'string' ? src.name : base?.name);
  p.wallHeight = num(src.wallHeight, base?.wallHeight ?? 3, 1.8, 12);
  p.floorColor = color(src.floorColor) ?? base?.floorColor ?? p.floorColor;
  p.wallColor = color(src.wallColor) ?? base?.wallColor ?? p.wallColor;
  p.showRoof = typeof src.showRoof === 'boolean' ? src.showRoof : base?.showRoof ?? false;
  p.image = (src.image as Plan['image']) ?? base?.image;
  const ids = new Set<string>();
  const id = (v: unknown, t: string) => {
    let s = typeof v === 'string' && v ? v : newId(t);
    while (ids.has(s)) s = newId(t);
    ids.add(s);
    return s;
  };
  for (const it of arr as Record<string, unknown>[]) {
    if (!it || typeof it !== 'object') continue;
    const t = String(it.type ?? '').toLowerCase();
    if (t === 'wall') {
      // 也接受參考專案的方塊格式（x,z,width,depth）
      let { x1, z1, x2, z2 } = it as Record<string, number>;
      if (![x1, z1, x2, z2].every((v) => Number.isFinite(+v))) {
        const x = num(it.x, 0), z = num(it.z, 0), w = num(it.width, 1, 0.01), d = num(it.depth, 0.2, 0.01);
        if (w >= d) [x1, z1, x2, z2] = [x - w / 2, z, x + w / 2, z];
        else [x1, z1, x2, z2] = [x, z - d / 2, x, z + d / 2];
        it.thickness ??= Math.min(w, d);
      }
      const wall: Wall = { id: id(it.id, 'wall'), type: 'wall', x1: +x1, z1: +z1, x2: +x2, z2: +z2, thickness: num(it.thickness, 0.2, 0.03, 2), height: num(it.height, p.wallHeight, 0.1, 30), color: color(it.color) };
      if (wallLen(wall) > 0.02) p.elements.push(wall);
    } else if (t === 'door' || t === 'window') {
      const isDoor = t === 'door';
      let angle = num(it.angle, NaN);
      if (!Number.isFinite(angle)) angle = num(it.depth, 0.1) > num(it.width, 1) ? Math.PI / 2 : 0;
      const w = Math.max(num(it.width, 0.9, 0.2, 20), Number.isFinite(+(it.depth as number)) && +(it.depth as number) > num(it.width, 0.9) ? +(it.depth as number) : 0);
      p.elements.push({
        id: id(it.id, t),
        type: t,
        x: num(it.x, 0),
        z: num(it.z, 0),
        width: w,
        height: num(it.height, isDoor ? 2.1 : 1.2, 0.2, 10),
        sill: num(it.sill, isDoor ? 0 : 0.9, 0, 10),
        angle,
        color: color(it.color),
      });
    } else if (t === 'column') {
      const round = it.shape === 'round' || it.shape === 'circle' || (it.radius !== undefined && it.shape !== 'box' && it.shape !== 'square');
      const w = it.radius !== undefined ? num(it.radius, 0.2, 0.02) * 2 : num(it.w ?? it.width, 0.4, 0.05, 5);
      p.elements.push({ id: id(it.id, 'column'), type: 'column', x: num(it.x, 0), z: num(it.z, 0), w, d: num(it.d ?? it.depth, w, 0.05, 5), height: num(it.height, p.wallHeight, 0.2, 30), shape: round ? 'round' : 'box', color: color(it.color) });
    } else if (t === 'room') {
      const pts = Array.isArray(it.points) ? (it.points as unknown[]).map((q) => (Array.isArray(q) ? [num(q[0], 0), num(q[1], 0)] : [num((q as Record<string, unknown>)?.x, 0), num((q as Record<string, unknown>)?.z, 0)])) : [];
      if (pts.length >= 3) p.elements.push({ id: id(it.id, 'room'), type: 'room', name: String(it.name ?? '房間').slice(0, 20), points: pts as [number, number][], color: color(it.color) });
    } else if (t === 'floor') {
      p.width = num(it.width, p.width, 0.5);
      p.depth = num(it.height ?? it.depth, p.depth, 0.5);
    }
  }
  updateBounds(p);
  return p;
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
