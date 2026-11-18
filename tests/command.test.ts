import { describe, expect, it } from 'vitest';
import { cnToNumber, runCommand } from '../src/command';
import { normalizePlan, type Wall, type Column, type Room } from '../src/plan';

const base = () =>
  normalizePlan({
    elements: [
      { id: 'w1', type: 'wall', x1: -5, z1: -4, x2: 5, z2: -4, thickness: 0.2, height: 3 },
      { id: 'w2', type: 'wall', x1: -5, z1: 4, x2: 5, z2: 4, thickness: 0.2, height: 3 },
      { id: 'c1', type: 'column', x: 0, z: 0, w: 0.4, d: 0.4, height: 3, shape: 'box' },
      { id: 'r1', type: 'room', name: '空間 A', points: [[-5, -4], [5, -4], [5, 4], [-5, 4]] },
    ],
  });
const ctx = { selected: null };

describe('自然語言指令', () => {
  it('中文數字', () => {
    expect(cnToNumber('三點五公尺')).toBe('3.5公尺');
    expect(cnToNumber('加一扇門')).toBe('加一扇門');
    expect(cnToNumber('五十公分')).toBe('50公分');
  });
  it('牆高改成 3.5 公尺', () => {
    const r = runCommand('把所有牆壁的高度增加到 3.5 米', base(), ctx);
    expect(r.ok).toBe(true);
    expect((r.plan!.elements[0] as Wall).height).toBe(3.5);
  });
  it('牆高增加 50 公分', () => {
    const r = runCommand('牆壁高度增加五十公分', base(), ctx);
    expect((r.plan!.elements[0] as Wall).height).toBeCloseTo(3.5);
  });
  it('英文：increase wall height by 0.5m', () => {
    const r = runCommand('increase wall height by 0.5m', base(), ctx);
    expect((r.plan!.elements[1] as Wall).height).toBeCloseTo(3.5);
  });
  it('柱子往左移 1 米', () => {
    const r = runCommand('將柱子往左移動1米', base(), ctx);
    expect((r.plan!.elements.find((e) => e.id === 'c1') as Column).x).toBe(-1);
  });
  it('刪除所有柱子', () => {
    const r = runCommand('刪除所有柱子', base(), ctx);
    expect(r.plan!.elements.some((e) => e.type === 'column')).toBe(false);
  });
  it('房間改名', () => {
    const r = runCommand('把空間 A 改名為客廳', base(), ctx);
    expect((r.plan!.elements.find((e) => e.id === 'r1') as Room).name).toBe('客廳');
  });
  it('選取的物件', () => {
    const r = runCommand('刪除這個', base(), { selected: 'w2' });
    expect(r.plan!.elements.some((e) => e.id === 'w2')).toBe(false);
  });
  it('牆漆成淺藍色', () => {
    const r = runCommand('把牆漆成淺藍色', base(), ctx);
    expect(r.plan!.wallColor).toBe('#a9d4f5');
  });
  it('視角指令', () => {
    expect(runCommand('進入漫遊模式', base(), ctx).view).toBe('walk');
    expect(runCommand('晚上開燈', base(), ctx).view).toBe('night');
    expect(runCommand('上一步', base(), ctx).view).toBe('undo');
    expect(runCommand('用 VR 眼鏡看', base(), ctx).view).toBe('vr');
  });
  it('看不懂的指令交給 AI', () => {
    expect(runCommand('幫我設計一個現代風格的客廳', base(), ctx).ok).toBe(false);
  });
});
