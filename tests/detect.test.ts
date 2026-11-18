import { readFileSync } from 'node:fs';
import UPNG from 'upng-js';
import { describe, expect, it } from 'vitest';
import { detect } from '../src/detect';
import { normalizePlan, repairJson, type Wall } from '../src/plan';

function load(name: string) {
  const buf = readFileSync(new URL(`../public/samples/${name}.png`, import.meta.url));
  const png = UPNG.decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const rgba = new Uint8Array(UPNG.toRGBA8(png)[0]);
  return { width: png.width, height: png.height, data: rgba };
}
const truth = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

for (const name of ['sample-2room', 'sample-3room']) {
  describe(name, () => {
    const t = truth(name);
    const r = detect(load(name), { mPerPx: 1 / t.pxPerM });
    const p = r.plan;
    it('辨識出牆、門、窗、房間', () => {
      console.log(name, r.stats, 'T=', r.thicknessPx, 'hollow=', r.hollowFilled, 'size', p.width, p.depth);
      expect(r.stats.walls).toBeGreaterThanOrEqual(t.walls.length);
      expect(r.stats.doors).toBe(t.openings.filter((o: { type: string }) => o.type === 'door').length);
      expect(r.stats.windows).toBe(t.openings.filter((o: { type: string }) => o.type === 'window').length);
      expect(r.stats.rooms).toBe(t.rooms.filter((x: { open?: boolean }) => !x.open).length);
      expect(r.stats.columns).toBe((t.columns ?? []).length);
    });
    it('外框尺寸正確（誤差 3%）', () => {
      const outer = t.walls[0].t;
      expect(Math.abs(p.width - (t.w + outer)) / t.w).toBeLessThan(0.03);
      expect(Math.abs(p.depth - (t.d + outer)) / t.d).toBeLessThan(0.03);
    });
    it('每一道真實的牆都有對應', () => {
      const walls = p.elements.filter((e): e is Wall => e.type === 'wall');
      const ox = t.w / 2, oz = t.d / 2;
      for (const w of t.walls) {
        const [x1, z1] = [w.a[0] - ox, w.a[1] - oz];
        const [x2, z2] = [w.b[0] - ox, w.b[1] - oz];
        const horiz = z1 === z2;
        const hit = walls.some((d) => (horiz ? Math.abs(d.z1 - z1) < 0.15 && d.z1 === d.z2 && Math.min(d.x1, d.x2) < Math.max(x1, x2) && Math.max(d.x1, d.x2) > Math.min(x1, x2) : Math.abs(d.x1 - x1) < 0.15 && d.x1 === d.x2 && Math.min(d.z1, d.z2) < Math.max(z1, z2) && Math.max(d.z1, d.z2) > Math.min(z1, z2)));
        expect(hit, JSON.stringify(w)).toBe(true);
      }
    });
  });
}

describe('自動比例', () => {
  for (const name of ['sample-2room', 'sample-3room']) {
    it(`${name} 依門寬推算尺寸（誤差 12%）`, () => {
      const t = truth(name);
      const r = detect(load(name));
      expect(r.scaleSource).toBe('door');
      expect(Math.abs(r.plan.width - t.w) / t.w).toBeLessThan(0.12);
    });
  }
});

describe('AI JSON 修復', () => {
  it('去掉 ``` 與尾逗號', () => {
    expect(repairJson('```json\n[{"type":"wall",},]\n```')).toEqual([{ type: 'wall' }]);
  });
  it('補齊被截斷的資料', () => {
    const v = repairJson('{"elements":[{"type":"wall","x1":0},{"type":"door","x":1') as { elements: unknown[] };
    expect(v.elements.length).toBeGreaterThanOrEqual(1);
  });
  it('接受參考專案的方塊牆格式', () => {
    const p = normalizePlan([{ type: 'floor', width: 12, height: 8 }, { type: 'wall', x: -6, y: 1.5, z: 0, width: 0.2, height: 3, depth: 8 }, { type: 'column', x: 1, z: 1, radius: 0.3, height: 3 }]);
    const w = p.elements[0] as Wall;
    expect(w.x1).toBeCloseTo(-6);
    expect(Math.abs(w.z2 - w.z1)).toBeCloseTo(8);
    expect(p.elements[1]).toMatchObject({ type: 'column', shape: 'round', w: 0.6 });
  });
});
