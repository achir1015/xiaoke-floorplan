// 除錯（DEBUG_IMG=圖1;圖2 node node_modules/vitest/vitest.mjs run tests/debug）：把辨識結果畫回原圖，輸出 e2e/out/<name>-debug.png
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import UPNG from 'upng-js';
import { it } from 'vitest';
import { detect } from '../src/detect';
for (const file of (process.env.DEBUG_IMG ?? '').split(';').filter(Boolean)) it(file, () => run(file));
function run(file: string) {
const buf = readFileSync(file);
const png = UPNG.decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const data = new Uint8Array(UPNG.toRGBA8(png)[0]);
const W = png.width, H = png.height;
const r = detect({ width: W, height: H, data: data.slice() });
const log: string[] = [JSON.stringify(r.stats) + ` T=${r.thicknessPx} hollow=${r.hollowFilled} thr=${r.threshold} ${JSON.stringify(r.diag)}`];
  for (const e of r.plan.elements) log.push(JSON.stringify(e));
const im = r.plan.image!;
const P = (x: number, z: number) => [Math.round(x / im.mPerPx + im.ox), Math.round(z / im.mPerPx + im.oz)];
const put = (x: number, y: number, c: number[]) => {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  for (let k = 0; k < 3; k++) data[i + k] = Math.round(data[i + k] * 0.4 + c[k] * 0.6);
};
const rect = (x0: number, y0: number, x1: number, y1: number, c: number[]) => {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) put(x, y, c);
};
for (const e of r.plan.elements) {
  if (e.type === 'room') {
    for (let i = 0; i < e.points.length; i++) {
      const [ax, ay] = P(...e.points[i]);
      const [bx, by] = P(...e.points[(i + 1) % e.points.length]);
      const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
      for (let k = 0; k <= n; k++) rect(Math.round(ax + ((bx - ax) * k) / n) - 1, Math.round(ay + ((by - ay) * k) / n) - 1, Math.round(ax + ((bx - ax) * k) / n) + 1, Math.round(ay + ((by - ay) * k) / n) + 1, [0, 160, 0]);
    }
  }
}
for (const e of r.plan.elements) {
  if (e.type === 'wall') {
    const [ax, ay] = P(e.x1, e.z1), [bx, by] = P(e.x2, e.z2);
    const h = e.thickness / im.mPerPx / 2;
    if (ay === by) rect(ax, ay - h, bx, ay + h, [255, 0, 0]);
    else rect(ax - h, ay, ax + h, by, [0, 0, 255]);
  } else if (e.type === 'door' || e.type === 'window') {
    const [cx, cy] = P(e.x, e.z);
    const L = e.width / im.mPerPx / 2;
    const c = e.type === 'door' ? [255, 140, 0] : [0, 200, 255];
    if (e.angle === 0) rect(cx - L, cy - 4, cx + L, cy + 4, c);
    else rect(cx - 4, cy - L, cx + 4, cy + L, c);
  } else if (e.type === 'column') {
    const [cx, cy] = P(e.x, e.z);
    rect(cx - 6, cy - 6, cx + 6, cy + 6, [255, 0, 255]);
  }
}
mkdirSync('e2e/out', { recursive: true });
const out = `e2e/out/${file.replace(/^.*[\/]/, '').replace(/\.\w+$/, '')}-debug.png`;
writeFileSync(out, Buffer.from(UPNG.encode([data.buffer], W, H, 0)));
writeFileSync(out.replace('.png', '.txt'), log.join('\n'));
}
it.skipIf(!!process.env.DEBUG_IMG)('（設定 DEBUG_IMG 才會畫除錯圖）', () => {});
