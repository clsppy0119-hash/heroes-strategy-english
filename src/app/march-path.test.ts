import { describe, expect, it } from 'vitest';

import { placeAlong, type Point } from './march-path';

/** 主城 (100,100) 往右走兩格再往下走一格，每格 80。 */
const path: Point[] = [
  { x: 100, y: 100 },
  { x: 180, y: 100 },
  { x: 260, y: 100 },
  { x: 260, y: 180 },
];

describe('隊伍走在折線上', () => {
  it('出發時在起點', () => {
    expect(placeAlong(path, 0)).toMatchObject({ x: 100, y: 100 });
  });

  it('抵達時剛好在終點——不是差幾個像素', () => {
    expect(placeAlong(path, 1)).toMatchObject({ x: 260, y: 180 });
  });

  it('走一半在路線的中點', () => {
    // 三段路走一半＝走完一段半，也就是第二段的中間。
    expect(placeAlong(path, 0.5)).toMatchObject({ x: 220, y: 100 });
  });

  it('轉彎處剛好落在角落那一格上', () => {
    expect(placeAlong(path, 2 / 3)).toMatchObject({ x: 260, y: 100 });
  });

  /**
   * 這是「走在格線外面」那類 bug 的守門員：任何時刻隊伍都必須在某一段路上，
   * 而不是在兩段之間抄近路。
   */
  it('每一刻都待在折線上，不會斜著抄過去', () => {
    for (let i = 0; i <= 100; i += 1) {
      const at = placeAlong(path, i / 100);
      const onSegment = [0, 1, 2].some((s) => {
        const a = path[s];
        const b = path[s + 1];
        const withinX = at.x >= Math.min(a.x, b.x) - 1e-6 && at.x <= Math.max(a.x, b.x) + 1e-6;
        const withinY = at.y >= Math.min(a.y, b.y) - 1e-6 && at.y <= Math.max(a.y, b.y) + 1e-6;
        // 每一段不是水平就是垂直，所以另一軸必須完全貼齊。
        const aligned = a.x === b.x ? Math.abs(at.x - a.x) < 1e-6 : Math.abs(at.y - a.y) < 1e-6;
        return withinX && withinY && aligned;
      });
      expect(onSegment, `progress ${i / 100} 走到 (${at.x}, ${at.y})`).toBe(true);
    }
  });

  it('一路只往前走，不會倒退', () => {
    let previous = -1;
    for (let i = 0; i <= 100; i += 1) {
      const at = placeAlong(path, i / 100);
      const travelled = Math.abs(at.x - 100) + Math.abs(at.y - 100);
      expect(travelled).toBeGreaterThanOrEqual(previous);
      previous = travelled;
    }
  });
});

describe('朝向', () => {
  it('往右走臉朝右', () => {
    expect(placeAlong(path, 0.1).facing).toBe(1);
  });

  it('往左走臉朝左', () => {
    const west: Point[] = [
      { x: 260, y: 100 },
      { x: 100, y: 100 },
    ];
    expect(placeAlong(west, 0.5).facing).toBe(-1);
  });

  /** 沒有左右分量時回 0，呼叫端才能維持原本的朝向而不是原地轉圈。 */
  it('純上下走的路段不表態', () => {
    expect(placeAlong(path, 0.9).facing).toBe(0);
  });
});

describe('進度超出範圍', () => {
  it('時鐘倒退時停在起點，不會飛到沙盤外面', () => {
    expect(placeAlong(path, -3)).toMatchObject({ x: 100, y: 100 });
  });

  it('超過抵達時間停在終點', () => {
    expect(placeAlong(path, 99)).toMatchObject({ x: 260, y: 180 });
  });
});

describe('退化的路線', () => {
  it('只有一個點就待在那裡', () => {
    expect(placeAlong([{ x: 5, y: 7 }], 0.5)).toEqual({ x: 5, y: 7, facing: 0 });
  });

  it('空路線丟錯，而不是回一個 NaN 座標', () => {
    expect(() => placeAlong([], 0.5)).toThrow(RangeError);
  });
});
