import { describe, expect, it } from 'vitest';

import { maxLevelOf } from './buildings';
import { MARCH_BASE_MS, MARCH_MS_PER_STEP } from './config';
import { CITY_X, CITY_Y, createMap, distanceFromCity } from './map';
import { hasArrived, marchDurationMs, marchProgress, remainingMs, startMarch } from './march';

const T0 = 1_700_000_000_000;

describe('marchDurationMs', () => {
  it('主城旁邊最快', () => {
    expect(marchDurationMs(CITY_X + 1, CITY_Y, 0)).toBe(MARCH_BASE_MS + MARCH_MS_PER_STEP);
  });

  it('越遠越久', () => {
    let previous = 0;
    for (const tile of [...createMap()].sort(
      (a, b) => distanceFromCity(a.x, a.y) - distanceFromCity(b.x, b.y),
    )) {
      const duration = marchDurationMs(tile.x, tile.y, 0);
      expect(duration).toBeGreaterThanOrEqual(previous);
      previous = duration;
    }
  });

  it('最遠的角落也在一分鐘以內——等待不是內容', () => {
    const longest = Math.max(...createMap().map((tile) => marchDurationMs(tile.x, tile.y, 0)));
    expect(longest).toBeLessThan(60_000);
  });

  it('驛站越高走得越快，但不會快到沒有行軍這件事', () => {
    const far = createMap().reduce((a, b) =>
      distanceFromCity(a.x, a.y) >= distanceFromCity(b.x, b.y) ? a : b,
    );
    let previous = marchDurationMs(far.x, far.y, 0);
    for (let level = 1; level <= maxLevelOf('relay'); level += 1) {
      const duration = marchDurationMs(far.x, far.y, level);
      expect(duration).toBeLessThan(previous);
      previous = duration;
    }
    expect(previous).toBeGreaterThan(0);
  });
});

describe('抵達', () => {
  const march = startMarch('3,2', 3, 2, 0, T0);

  it('剛出發還沒到', () => {
    expect(hasArrived(march, T0)).toBe(false);
  });

  it('時間到就是到了', () => {
    expect(hasArrived(march, march.arrivesAt)).toBe(true);
  });

  it('離線很久回來，早就到了', () => {
    expect(hasArrived(march, T0 + 86_400_000)).toBe(true);
  });

  it('剩餘時間不會是負的', () => {
    expect(remainingMs(march, march.arrivesAt + 5_000)).toBe(0);
    expect(remainingMs(march, T0)).toBe(march.arrivesAt - T0);
  });
});

/**
 * 進度只是給進度條用的，但時鐘倒退（換裝置、校時）時算出來的負值或大於一
 * 會讓長條跑到框外或倒著長，那是玩家看得到的錯。
 */
describe('marchProgress', () => {
  const march = startMarch('3,2', 3, 2, 0, T0);

  it('出發是 0，抵達是 1', () => {
    expect(marchProgress(march, T0)).toBe(0);
    expect(marchProgress(march, march.arrivesAt)).toBe(1);
  });

  it('中間是一半', () => {
    expect(marchProgress(march, (T0 + march.arrivesAt) / 2)).toBeCloseTo(0.5);
  });

  it('時鐘倒退夾在 0', () => {
    expect(marchProgress(march, T0 - 10_000)).toBe(0);
  });

  it('超過抵達時間夾在 1', () => {
    expect(marchProgress(march, march.arrivesAt + 10_000)).toBe(1);
  });
});
