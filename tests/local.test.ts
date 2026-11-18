// 使用者提供的真實平面圖（不進 git，放在 tests/local/）：有檔案才測
import { existsSync, readFileSync } from 'node:fs';
import UPNG from 'upng-js';
import { describe, expect, it } from 'vitest';
import { detect } from '../src/detect';

const file = new URL('./local/user-plan-1.png', import.meta.url);
describe.skipIf(!existsSync(file))('使用者平面圖 1（黑色實心牆、門開在牆角）', () => {
  it('整張都辨識到', () => {
    const buf = readFileSync(file);
    const png = UPNG.decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const r = detect({ width: png.width, height: png.height, data: new Uint8Array(UPNG.toRGBA8(png)[0]) });
    expect(r.stats.walls).toBeGreaterThanOrEqual(16);
    expect(r.stats.doors).toBeGreaterThanOrEqual(5);
    expect(r.stats.windows).toBeGreaterThanOrEqual(3);
    expect(r.stats.rooms).toBeGreaterThanOrEqual(5);
    expect(r.scaleSource).toBe('door');
    // 建築約 840 像素寬、門約 65 像素 → 約 11～12 公尺
    expect(r.plan.width).toBeGreaterThan(9);
    expect(r.plan.width).toBeLessThan(14);
  });
});
