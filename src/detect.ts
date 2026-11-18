// 本機平面圖辨識（不需網路、不需 AI 金鑰）：
// 1. 灰階＋Otsu 二值化，找出深色線條
// 2. 每個深色像素的「筆畫粗細」= min(水平連續長度, 垂直連續長度)；牆是圖上最粗、最常見的筆畫
// 3. 粗筆畫拆成水平牆與垂直牆（連續長度夠長），剩下的方塊是柱子
// 4. 同一直線上的兩段牆之間的缺口：缺口內有細的平行線 → 窗；空的 → 門
// 5. 牆＋門窗當隔間，從圖邊往內填滿當室外，剩下封閉區域是房間
import { type Plan, type Wall, type Opening, type Column, type Room, emptyPlan, newId, polygonArea, updateBounds } from './plan';

export interface Img {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface DetectOptions {
  /** 一般牆的實際厚度（公尺），用來換算比例；預設 0.15 */
  wallThicknessM?: number;
  /** 直接指定比例（公尺／像素），優先於其他方式 */
  mPerPx?: number;
  /** 比例依據：door＝依門寬（找到 2 扇以上門時），wall＝依牆厚。預設 door */
  scaleBy?: 'door' | 'wall';
  /** 一般門的實際寬度（公尺）；預設 0.9 */
  doorWidthM?: number;
  wallHeight?: number;
  /** 牆是空心雙線（沒有塗黑）時要填滿的寬度；undefined＝自動 */
  hollow?: boolean;
}

export interface DetectResult {
  plan: Plan;
  /** 牆粗細（像素） */
  thicknessPx: number;
  threshold: number;
  hollowFilled: boolean;
  /** 除錯用數值 */
  diag: Record<string, number>;
  /** 比例怎麼來的 */
  scaleSource: 'given' | 'wall' | 'door';
  stats: { walls: number; doors: number; windows: number; columns: number; rooms: number };
}

function otsu(gray: Uint8Array) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > best) {
      best = v;
      thr = t;
    }
  }
  return thr;
}

/** 每個像素的水平／垂直連續長度 */
function runs(mask: Uint8Array, W: number, H: number) {
  const hr = new Uint16Array(W * H);
  const vr = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!mask[y * W + x]) {
        x++;
        continue;
      }
      let e = x;
      while (e < W && mask[y * W + e]) e++;
      const L = Math.min(65535, e - x);
      for (let k = x; k < e; k++) hr[y * W + k] = L;
      x = e;
    }
  }
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!mask[y * W + x]) {
        y++;
        continue;
      }
      let e = y;
      while (e < H && mask[e * W + x]) e++;
      const L = Math.min(65535, e - y);
      for (let k = y; k < e; k++) vr[k * W + x] = L;
      y = e;
    }
  }
  return { hr, vr };
}

function estimateThickness(mask: Uint8Array, hr: Uint16Array, vr: Uint16Array, maxDim: number) {
  const cap = Math.max(8, Math.round(maxDim / 15));
  const hist = new Float64Array(cap + 2);
  let weight = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const s = Math.min(hr[i], vr[i]);
    // 只算「細長」的筆畫：牆很長；柱子、塗黑的方塊、文字不算
    if (s >= 3 && s <= cap && Math.max(hr[i], vr[i]) >= 3 * s) {
      hist[s] += s;
      weight += s;
    }
  }
  // 平滑後取最大值（筆畫加權：粗的牆比細的文字有分量）
  let best = 0, T = 0;
  for (let s = 3; s <= cap; s++) {
    const v = hist[s] + 0.5 * ((hist[s - 1] ?? 0) + (hist[s + 1] ?? 0));
    if (v > best) {
      best = v;
      T = s;
    }
  }
  return { T, weight };
}

/** 雙線空心牆兩條線之間的白色間距（像素）：取最常見的短白色間隔 */
function hollowGap(mask: Uint8Array, W: number, H: number) {
  const cap = Math.max(6, Math.round(Math.max(W, H) / 45));
  const hist = new Float64Array(cap + 1);
  const scan = (n: number, m: number, at: (i: number, j: number) => number) => {
    for (let j = 0; j < m; j++) {
      let last = -1;
      for (let i = 0; i < n; i++) {
        if (!at(i, j)) continue;
        const g = i - last - 1;
        if (last >= 0 && g >= 2 && g <= cap) hist[g] += g;
        last = i;
      }
    }
  };
  scan(W, H, (i, j) => mask[j * W + i]);
  scan(H, W, (i, j) => mask[i * W + j]);
  let best = 0, g = 0;
  for (let k = 3; k <= cap; k++) if (hist[k] > best) {
    best = hist[k];
    g = k;
  }
  return g;
}

/** 二值影像形態學閉合（先膨脹再侵蝕，方形核心，分離成水平＋垂直兩趟） */
function close(mask: Uint8Array, W: number, H: number, r: number) {
  const pass = (src: Uint8Array, horiz: boolean, dilate: boolean) => {
    const out = new Uint8Array(W * H);
    const n = horiz ? W : H, m = horiz ? H : W;
    for (let j = 0; j < m; j++) {
      // 滑動視窗計數
      let cnt = 0;
      const at = (i: number) => (horiz ? src[j * W + i] : src[i * W + j]);
      for (let i = 0; i < Math.min(n, r); i++) cnt += at(i);
      for (let i = 0; i < n; i++) {
        if (i + r < n) cnt += at(i + r);
        if (i - r - 1 >= 0) cnt -= at(i - r - 1);
        const win = Math.min(n - 1, i + r) - Math.max(0, i - r) + 1;
        const v = dilate ? cnt > 0 : cnt === win;
        if (v) out[horiz ? j * W + i : i * W + j] = 1;
      }
    }
    return out;
  };
  let a = pass(mask, true, true);
  a = pass(a, false, true);
  a = pass(a, true, false);
  return pass(a, false, false);
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  n: number;
}

/** 4 連通元件的外框 */
function components(mask: Uint8Array, W: number, H: number, label?: Int32Array) {
  const lab = label ?? new Int32Array(W * H);
  const boxes: Box[] = [];
  const stack: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || lab[i]) continue;
    const id = boxes.length + 1;
    const b: Box = { x0: W, y0: H, x1: -1, y1: -1, n: 0 };
    lab[i] = id;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p - x) / W;
      b.n++;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
      if (x > 0 && mask[p - 1] && !lab[p - 1]) (lab[p - 1] = id), stack.push(p - 1);
      if (x < W - 1 && mask[p + 1] && !lab[p + 1]) (lab[p + 1] = id), stack.push(p + 1);
      if (y > 0 && mask[p - W] && !lab[p - W]) (lab[p - W] = id), stack.push(p - W);
      if (y < H - 1 && mask[p + W] && !lab[p + W]) (lab[p + W] = id), stack.push(p + W);
    }
    boxes.push(b);
  }
  return { boxes, lab };
}

/** 像素座標的牆（水平：沿 x；垂直：沿 y） */
interface Seg {
  horiz: boolean;
  /** 沿牆方向的起訖 */
  a: number;
  b: number;
  /** 中心線位置（垂直於牆方向） */
  c: number;
  t: number;
}

function extractSegs(wall: Uint8Array, W: number, H: number, T: number) {
  const Lmin = Math.max(6, Math.round(2.2 * T));
  const hm = new Uint8Array(W * H);
  const vm = new Uint8Array(W * H);
  const { hr, vr } = runs(wall, W, H);
  for (let i = 0; i < W * H; i++) {
    if (!wall[i]) continue;
    if (hr[i] >= Lmin && vr[i] <= hr[i]) hm[i] = 1;
    if (vr[i] >= Lmin && hr[i] <= vr[i]) vm[i] = 1;
  }
  const segs: Seg[] = [];
  for (const [m, horiz] of [[hm, true], [vm, false]] as const) {
    const { boxes } = components(m, W, H);
    for (const b of boxes) {
      const len = horiz ? b.x1 - b.x0 + 1 : b.y1 - b.y0 + 1;
      if (len < Lmin) continue;
      const t = Math.max(1, b.n / len);
      if (t < 0.45 * T) continue;
      // 太寬的區塊（例如塗黑的大面積）：切成和牆一樣厚的帶狀
      const span = horiz ? b.y1 - b.y0 + 1 : b.x1 - b.x0 + 1;
      if (span > 3.5 * T && t > 2.5 * T) {
        const c0 = horiz ? b.y0 : b.x0;
        segs.push({ horiz, a: horiz ? b.x0 : b.y0, b: horiz ? b.x1 + 1 : b.y1 + 1, c: c0 + T / 2, t: T });
        segs.push({ horiz, a: horiz ? b.x0 : b.y0, b: horiz ? b.x1 + 1 : b.y1 + 1, c: c0 + span - T / 2, t: T });
        continue;
      }
      segs.push({ horiz, a: horiz ? b.x0 : b.y0, b: horiz ? b.x1 + 1 : b.y1 + 1, c: (horiz ? b.y0 + b.y1 + 1 : b.x0 + b.x1 + 1) / 2, t: Math.min(t, span) });
    }
  }
  return { segs, hm, vm };
}

/** 牆帶狀區域裡（沿牆方向 a~b、中心 c、半寬 hw）有幾成的位置有像素 */
function coverage(mask: Uint8Array, W: number, H: number, s: { horiz: boolean; c: number }, a: number, b: number, hw: number) {
  let hit = 0, tot = 0;
  for (let u = Math.round(a); u < Math.round(b); u++) {
    tot++;
    let any = false;
    for (let v = Math.floor(s.c - hw); v <= Math.ceil(s.c + hw) && !any; v++) {
      const x = s.horiz ? u : v, y = s.horiz ? v : u;
      if (x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x]) any = true;
    }
    if (any) hit++;
  }
  return tot ? hit / tot : 0;
}

/** 平行線數（窗通常畫成 2~3 條細的平行線） */
function parallelLines(mask: Uint8Array, W: number, H: number, s: { horiz: boolean; c: number }, a: number, b: number, hw: number) {
  const mid = Math.round((a + b) / 2);
  let lines = 0, prev = false;
  for (let v = Math.floor(s.c - hw); v <= Math.ceil(s.c + hw); v++) {
    let cnt = 0, tot = 0;
    for (let u = Math.round(a + (b - a) * 0.2); u <= Math.round(b - (b - a) * 0.2); u++) {
      const x = s.horiz ? u : v, y = s.horiz ? v : u;
      tot++;
      if (x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x]) cnt++;
    }
    const on = tot > 0 && cnt / tot > 0.7;
    if (on && !prev) lines++;
    prev = on;
  }
  void mid;
  return lines;
}

/** 合併同一直線上的牆段，並找出中間的門窗 */
function joinAndFindOpenings(segs: Seg[], dark: Uint8Array, wallMask: Uint8Array, W: number, H: number, T: number, mPerPx: number, hollow = false) {
  const walls: Seg[] = [];
  const openings: { horiz: boolean; a: number; b: number; c: number; t: number; kind: 'door' | 'window' }[] = [];
  const minOpen = 0.45 / mPerPx, maxOpen = 3.2 / mPerPx;
  // 空心牆：牆身橫切只會碰到 2 條線（兩側牆線），窗會有 3 條以上平行線 → 把那一段切出來當窗
  const pushWall = (s: Seg) => {
    if (!hollow) {
      walls.push(s);
      return;
    }
    const lines = (u: number) => {
      let n = 0, prev = false;
      for (let v = Math.floor(s.c - s.t / 2) - 1; v <= Math.ceil(s.c + s.t / 2) + 1; v++) {
        const x = s.horiz ? u : v, y = s.horiz ? v : u;
        const on = x >= 0 && y >= 0 && x < W && y < H && !!dark[y * W + x];
        if (on && !prev) n++;
        prev = on;
      }
      return n;
    };
    let a = s.a;
    let u = Math.ceil(s.a);
    const end = Math.floor(s.b);
    while (u < end) {
      if (lines(u) < 3) {
        u++;
        continue;
      }
      let e = u;
      while (e < end && lines(e) >= 3) e++;
      if (e - u >= minOpen) {
        if (u - a > T) walls.push({ ...s, a, b: u });
        openings.push({ horiz: s.horiz, a: u, b: e, c: s.c, t: s.t, kind: 'window' });
        a = e;
      }
      u = e + 1;
    }
    if (s.b - a > T) walls.push({ ...s, a, b: s.b });
  };
  for (const horiz of [true, false]) {
    const list = segs.filter((s) => s.horiz === horiz).sort((p, q) => p.c - q.c || p.a - q.a);
    // 依中心線分組
    const groups: Seg[][] = [];
    for (const s of list) {
      const g = groups.find((gg) => Math.abs(gg[0].c - s.c) <= Math.max(2, T * 0.5) && Math.abs(gg[0].t - s.t) <= Math.max(2, T * 0.6));
      if (g) g.push(s);
      else groups.push([s]);
    }
    for (const g of groups) {
      g.sort((p, q) => p.a - q.a);
      const c = g.reduce((acc, s) => acc + s.c * (s.b - s.a), 0) / g.reduce((acc, s) => acc + (s.b - s.a), 0);
      const t = g.reduce((acc, s) => acc + s.t * (s.b - s.a), 0) / g.reduce((acc, s) => acc + (s.b - s.a), 0);
      let cur: Seg = { ...g[0], c, t };
      for (let i = 1; i < g.length; i++) {
        const s = g[i];
        const gap = s.a - cur.b;
        if (gap <= Math.max(3, T * 1.2)) {
          cur.b = Math.max(cur.b, s.b);
          continue;
        }
        if (gap >= minOpen && gap <= maxOpen) {
          const line = { horiz, c };
          const wallIn = coverage(wallMask, W, H, line, cur.b + 1, s.a - 1, t * 0.3);
          if (wallIn < 0.35) {
            const cov = coverage(dark, W, H, line, cur.b + 1, s.a - 1, t * 0.5);
            const nl = parallelLines(dark, W, H, line, cur.b, s.a, t * 0.6);
            openings.push({ horiz, a: cur.b, b: s.a, c, t, kind: cov > 0.75 && nl >= 1 ? 'window' : 'door' });
          }
        }
        pushWall(cur);
        cur = { ...s, c, t };
      }
      pushWall(cur);
    }
  }
  return { walls, openings };
}

/** 外框追蹤（Moore 鄰域）＋ Douglas-Peucker 簡化 */
function tracePolygon(lab: Int32Array, id: number, W: number, H: number, start: number, eps: number): [number, number][] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && lab[y * W + x] === id;
  const sx = start % W, sy = (start - sx) / W;
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const pts: [number, number][] = [[sx, sy]];
  let x = sx, y = sy, d = 6;
  for (let guard = 0; guard < 200000; guard++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const nd = (d + 6 + k) % 8;
      const nx = x + dirs[nd][0], ny = y + dirs[nd][1];
      if (inside(nx, ny)) {
        x = nx;
        y = ny;
        d = nd;
        found = true;
        break;
      }
    }
    if (!found || (x === sx && y === sy)) break;
    pts.push([x, y]);
  }
  const rdp = (p: [number, number][], e: number): [number, number][] => {
    if (p.length < 3) return p;
    const [a, b] = [p[0], p[p.length - 1]];
    let md = 0, mi = 0;
    for (let i = 1; i < p.length - 1; i++) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      const dd = Math.abs(dy * p[i][0] - dx * p[i][1] + b[0] * a[1] - b[1] * a[0]) / L;
      if (dd > md) {
        md = dd;
        mi = i;
      }
    }
    if (md <= e) return [a, b];
    return [...rdp(p.slice(0, mi + 1), e).slice(0, -1), ...rdp(p.slice(mi), e)];
  };
  // 封閉多邊形：從最遠的兩點切開再簡化
  if (pts.length < 4) return pts;
  const far = pts.reduce((bi, p, i) => (Math.hypot(p[0] - sx, p[1] - sy) > Math.hypot(pts[bi][0] - sx, pts[bi][1] - sy) ? i : bi), 0);
  const A = rdp(pts.slice(0, far + 1), eps);
  const B = rdp([...pts.slice(far), pts[0]], eps);
  return [...A.slice(0, -1), ...B.slice(0, -1)];
}

export function toGray(img: Img) {
  const g = new Uint8Array(img.width * img.height);
  const d = img.data;
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    const a = d[j + 3] / 255;
    // 透明當白色
    g[i] = Math.round((0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) * a + 255 * (1 - a));
  }
  return g;
}

export function detect(img: Img, opt: DetectOptions = {}): DetectResult {
  const W = img.width, H = img.height;
  const gray = toGray(img);
  const thr = Math.min(otsu(gray), 170);
  let dark = new Uint8Array(W * H);
  for (let i = 0; i < gray.length; i++) dark[i] = gray[i] <= thr ? 1 : 0;
  const orig = dark;
  let { hr, vr } = runs(dark, W, H);
  let { T, weight } = estimateThickness(dark, hr, vr, Math.max(W, H));
  let hollowFilled = false;
  const diag: Record<string, number> = { T0: T, w0: weight };
  // 空心雙線牆：把兩條線中間填滿，如果「粗而長」的筆畫大幅增加，就採用填滿後的結果
  if (opt.hollow !== false) {
    const g = hollowGap(dark, W, H);
    if (g >= 2) {
      const closed = close(dark, W, H, Math.ceil(g / 2) + 1);
      const rr = runs(closed, W, H);
      const est = estimateThickness(closed, rr.hr, rr.vr, Math.max(W, H));
      Object.assign(diag, { gap: g, T1: est.T, w1: est.weight });
      if (opt.hollow || (est.weight > weight * 2.5 && est.T >= 4)) {
        dark = closed;
        hr = rr.hr;
        vr = rr.vr;
        T = est.T;
        weight = est.weight;
        hollowFilled = true;
      }
    }
  }
  if (T < 2) T = 3;
  const wall = new Uint8Array(W * H);
  // 內牆常比外牆薄（例如 12 公分對 20 公分），門檻放寬到最粗牆的 45%
  const minS = Math.max(3, Math.floor(T * 0.45));
  for (let i = 0; i < W * H; i++) if (dark[i] && Math.min(hr[i], vr[i]) >= minS) wall[i] = 1;

  let mPerPx = opt.mPerPx ?? (opt.wallThicknessM ?? 0.15) / T;
  let scaleSource: 'given' | 'wall' | 'door' = opt.mPerPx ? 'given' : 'wall';
  const wallH = opt.wallHeight ?? 3;
  const ex = extractSegs(wall, W, H, T);
  const { hm, vm } = ex;
  const segs: Seg[] = [];
  const blockCols: Column[] = [];
  // 又短又粗的段落是柱子（例如塗黑的方柱）
  for (const s of ex.segs) {
    if (s.b - s.a < 2.6 * s.t && s.t > 1.3 * T) {
      const w = s.b - s.a;
      blockCols.push({ id: newId('column'), type: 'column', x: s.horiz ? (s.a + s.b) / 2 : s.c, z: s.horiz ? s.c : (s.a + s.b) / 2, w: s.horiz ? w : s.t, d: s.horiz ? s.t : w, height: wallH, shape: 'box' });
    } else segs.push(s);
  }
  // 牆會彼此相接成一群；跟主建築不相連、總長又短的群組（文字、標題、圖例被誤認）去掉
  const rectOf = (s: Seg, pad: number) => (s.horiz ? [s.a - pad, s.c - s.t / 2 - pad, s.b + pad, s.c + s.t / 2 + pad] : [s.c - s.t / 2 - pad, s.a - pad, s.c + s.t / 2 + pad, s.b + pad]);
  {
    const group = segs.map((_, i) => i);
    const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
    for (let i = 0; i < segs.length; i++) {
      const r = rectOf(segs[i], T);
      for (let j = i + 1; j < segs.length; j++) {
        const q = rectOf(segs[j], 0);
        if (r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) group[find(i)] = find(j);
      }
    }
    const total = new Map<number, number>();
    segs.forEach((s, i) => total.set(find(i), (total.get(find(i)) ?? 0) + s.b - s.a));
    const biggest = Math.max(0, ...total.values());
    const keep = segs.filter((_, i) => (total.get(find(i)) ?? 0) >= biggest * 0.2);
    segs.splice(0, segs.length, ...keep);
  }
  let { walls, openings } = joinAndFindOpenings(segs, orig, wall, W, H, T, mPerPx, hollowFilled);
  // 依門寬推算比例：一般室內門約 90 公分，比牆厚可靠（牆厚各家畫法差很多）
  if (!opt.mPerPx && (opt.scaleBy ?? 'door') === 'door') {
    const doors = openings.filter((o) => o.kind === 'door').map((o) => o.b - o.a).sort((a, b) => a - b);
    if (doors.length >= 2) {
      const med = doors[Math.floor((doors.length - 1) / 2)];
      const k = (opt.doorWidthM ?? 0.9) / med;
      // 和牆厚推算差太多（3 倍以上）就不採用，避免誤判
      if (k / mPerPx < 3 && mPerPx / k < 3) {
        mPerPx = k;
        scaleSource = 'door';
        ({ walls, openings } = joinAndFindOpenings(segs, orig, wall, W, H, T, mPerPx, hollowFilled));
      }
    }
  }

  // 柱子：粗筆畫中不屬於牆的方塊
  const rest = new Uint8Array(W * H);
  const pad = Math.ceil(T * 0.5);
  const covered = new Uint8Array(W * H);
  for (const s of walls) {
    for (let u = Math.floor(s.a) - pad; u <= Math.ceil(s.b) + pad; u++)
      for (let v = Math.floor(s.c - s.t / 2) - pad; v <= Math.ceil(s.c + s.t / 2) + pad; v++) {
        const x = s.horiz ? u : v, y = s.horiz ? v : u;
        if (x >= 0 && y >= 0 && x < W && y < H) covered[y * W + x] = 1;
      }
  }
  for (let i = 0; i < W * H; i++) if (wall[i] && !covered[i] && !hm[i] && !vm[i]) rest[i] = 1;
  // 柱子在原圖上是實心的；文字（就算被閉合填過）原本的墨水比例很低
  const solid = (x0: number, y0: number, x1: number, y1: number) => {
    let n = 0, t = 0;
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y1)); y++)
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x1)); x++) {
        t++;
        n += orig[y * W + x];
      }
    return t ? n / t : 0;
  };
  // 柱子四周是空的；文字旁邊還有別的字
  const lonely = (x0: number, y0: number, x1: number, y1: number) => {
    const p = T;
    const outer = solid(x0 - p, y0 - p, x1 + p, y1 + p) * (x1 - x0 + 2 * p) * (y1 - y0 + 2 * p);
    const inner = solid(x0, y0, x1, y1) * (x1 - x0) * (y1 - y0);
    const ring = (x1 - x0 + 2 * p) * (y1 - y0 + 2 * p) - (x1 - x0) * (y1 - y0);
    return ring > 0 && (outer - inner) / ring < 0.12;
  };
  const isCol = (x0: number, y0: number, x1: number, y1: number, minSolid: number) => solid(x0, y0, x1, y1) > minSolid && lonely(x0, y0, x1, y1);
  const cols: Column[] = blockCols.filter((c) => isCol(c.x - c.w / 2, c.z - c.d / 2, c.x + c.w / 2, c.z + c.d / 2, 0.7));
  // 圓柱：和內切橢圓幾乎重合；方柱：幾乎填滿外框。文字筆畫兩者都不像
  const restLab = components(rest, W, H);
  const circleIoU = (b: Box, id: number) => {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rx = (b.x1 - b.x0 + 1) / 2, ry = (b.y1 - b.y0 + 1) / 2;
    let inter = 0, uni = 0;
    for (let y = b.y0; y <= b.y1; y++)
      for (let x = b.x0; x <= b.x1; x++) {
        const inE = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
        const inM = restLab.lab[y * W + x] === id;
        if (inE && inM) inter++;
        if (inE || inM) uni++;
      }
    return uni ? inter / uni : 0;
  };
  for (const [bi, b] of restLab.boxes.entries()) {
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
    const fill = b.n / (w * h);
    const shapeOk = fill >= 0.85 || circleIoU(b, bi + 1) > 0.85;
    if (w >= T * 0.9 && h >= T * 0.9 && w <= T * 5 && h <= T * 5 && shapeOk && Math.max(w, h) / Math.min(w, h) < 2.2 && isCol(b.x0, b.y0, b.x1 + 1, b.y1 + 1, 0.82)) {
      cols.push({ id: newId('column'), type: 'column', x: (b.x0 + b.x1 + 1) / 2, z: (b.y0 + b.y1 + 1) / 2, w, d: h, height: wallH, shape: fill < 0.85 ? 'round' : 'box' });
    }
  }

  // 房間：牆＋門窗當隔間
  const barrier = new Uint8Array(W * H);
  for (const s of [...walls, ...openings]) {
    for (let u = Math.floor(s.a) - 1; u <= Math.ceil(s.b) + 1; u++)
      for (let v = Math.floor(s.c - s.t / 2) - 1; v <= Math.ceil(s.c + s.t / 2) + 1; v++) {
        const x = s.horiz ? u : v, y = s.horiz ? v : u;
        if (x >= 0 && y >= 0 && x < W && y < H) barrier[y * W + x] = 1;
      }
  }
  for (let i = 0; i < W * H; i++) if (wall[i]) barrier[i] = 1;
  for (const c of cols) {
    for (let y = Math.floor(c.z - c.d / 2); y <= c.z + c.d / 2; y++) for (let x = Math.floor(c.x - c.w / 2); x <= c.x + c.w / 2; x++) if (x >= 0 && y >= 0 && x < W && y < H) barrier[y * W + x] = 1;
  }
  const free = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) free[i] = barrier[i] ? 0 : 1;
  const { boxes, lab } = components(free, W, H);
  const minArea = 1.2 / (mPerPx * mPerPx);
  const rooms: Room[] = [];
  const roomPx: { poly: [number, number][]; box: Box }[] = [];
  boxes.forEach((b, i) => {
    if (b.x0 === 0 || b.y0 === 0 || b.x1 === W - 1 || b.y1 === H - 1) return;
    if (b.n < minArea) return;
    // 細長的縫（例如雙線牆內部）不算房間
    if (Math.min(b.x1 - b.x0, b.y1 - b.y0) < T * 3) return;
    let start = -1;
    for (let y = b.y0; y <= b.y1 && start < 0; y++) for (let x = b.x0; x <= b.x1; x++) if (lab[y * W + x] === i + 1) {
      start = y * W + x;
      break;
    }
    const poly = tracePolygon(lab, i + 1, W, H, start, Math.max(1.5, T * 0.6));
    if (poly.length >= 3) roomPx.push({ poly, box: b });
  });

  // 換算成公尺，原點放在建築中心
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const s of walls) {
    const xa = s.horiz ? s.a : s.c - s.t / 2, xb = s.horiz ? s.b : s.c + s.t / 2;
    const ya = s.horiz ? s.c - s.t / 2 : s.a, yb = s.horiz ? s.c + s.t / 2 : s.b;
    bx0 = Math.min(bx0, xa);
    bx1 = Math.max(bx1, xb);
    by0 = Math.min(by0, ya);
    by1 = Math.max(by1, yb);
  }
  if (bx0 === Infinity) [bx0, by0, bx1, by1] = [0, 0, W, H];
  const ox = (bx0 + bx1) / 2, oz = (by0 + by1) / 2;
  const X = (px: number) => +((px - ox) * mPerPx).toFixed(3);
  const Z = (py: number) => +((py - oz) * mPerPx).toFixed(3);

  const plan = emptyPlan('辨識結果');
  plan.wallHeight = wallH;
  plan.image = { w: W, h: H, mPerPx, ox, oz };
  for (const s of walls) {
    const w: Wall = s.horiz
      ? { id: newId('wall'), type: 'wall', x1: X(s.a), z1: Z(s.c), x2: X(s.b), z2: Z(s.c), thickness: +(s.t * mPerPx).toFixed(3), height: wallH }
      : { id: newId('wall'), type: 'wall', x1: X(s.c), z1: Z(s.a), x2: X(s.c), z2: Z(s.b), thickness: +(s.t * mPerPx).toFixed(3), height: wallH };
    plan.elements.push(w);
  }
  for (const o of openings) {
    const len = (o.b - o.a) * mPerPx;
    const door = o.kind === 'door';
    const el: Opening = {
      id: newId(o.kind),
      type: o.kind,
      x: o.horiz ? X((o.a + o.b) / 2) : X(o.c),
      z: o.horiz ? Z(o.c) : Z((o.a + o.b) / 2),
      width: +len.toFixed(3),
      height: door ? Math.min(2.1, wallH - 0.2) : Math.min(1.2, wallH - 1.2),
      sill: door ? 0 : 0.9,
      angle: o.horiz ? 0 : Math.PI / 2,
    };
    // 很寬的門洞（> 1.6 m）多半是落地窗或拉門開口：當作落地窗
    if (door && len > 1.6) {
      el.type = 'window';
      el.sill = 0.05;
      el.height = Math.min(2.2, wallH - 0.2);
    }
    plan.elements.push(el);
  }
  for (const c of cols) plan.elements.push({ ...c, x: X(c.x), z: Z(c.z), w: +(c.w * mPerPx).toFixed(3), d: +(c.d * mPerPx).toFixed(3) });
  const palette = ['#f6d7a7', '#cfe6c9', '#cfe0f5', '#f3cfd8', '#e2d6f3', '#f7ecb5', '#d5efe9', '#f1dcc8'];
  roomPx
    .sort((a, b) => b.box.n - a.box.n)
    .forEach((r, i) => {
      const pts = r.poly.map(([x, y]) => [X(x), Z(y)] as [number, number]);
      rooms.push({ id: newId('room'), type: 'room', name: `空間 ${String.fromCharCode(65 + (i % 26))}`, points: pts, color: palette[i % palette.length] });
    });
  plan.elements.push(...rooms);
  updateBounds(plan);
  const count = (t: string) => plan.elements.filter((e) => e.type === t).length;
  return {
    plan,
    thicknessPx: T,
    threshold: thr,
    hollowFilled,
    diag,
    scaleSource,
    stats: { walls: count('wall'), doors: count('door'), windows: count('window'), columns: count('column'), rooms: count('room') },
  };
}

/** 房間面積（平方公尺）與坪數 */
export function roomArea(r: Room) {
  const m2 = polygonArea(r.points);
  return { m2, ping: m2 / 3.3058 };
}

/** 整張圖等比例放大縮小（校正比例用）：factor = 新 / 舊 */
export function rescalePlan(plan: Plan, factor: number) {
  for (const e of plan.elements) {
    if (e.type === 'wall') {
      e.x1 *= factor;
      e.z1 *= factor;
      e.x2 *= factor;
      e.z2 *= factor;
      e.thickness *= factor;
    } else if (e.type === 'room') e.points = e.points.map(([x, z]) => [x * factor, z * factor]);
    else {
      e.x *= factor;
      e.z *= factor;
      if (e.type === 'column') {
        e.w *= factor;
        e.d *= factor;
      } else e.width *= factor;
    }
  }
  if (plan.image) plan.image.mPerPx *= factor;
  updateBounds(plan);
}
