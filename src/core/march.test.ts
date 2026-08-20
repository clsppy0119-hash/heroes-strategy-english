import { describe, expect, it } from 'vitest';

import { maxLevelOf } from './buildings';
import { MARCH_BASE_MS, MARCH_MS_PER_STEP } from './config';
import { CITY_X, CITY_Y, createMap, tileId } from './map';
import {
  RETURN_RATIO,
  hasArrived,
  marchDurationMs,
  marchProgress,
  remainingMs,
  returnDurationMs,
  startMarch,
} from './march';

const T0 = 1_700_000_000_000;

describe('marchDurationMs', () => {
  it('一格就是底數加一步', () => {
    expect(marchDurationMs(1, 0)).toBe(MARCH_BASE_MS + MARCH_MS_PER_STEP);
  });

  /**
   * 這是這次改動的重點：合法出兵永遠是一格，所以行軍時間跟目標在哪無關。
   * 舊規則是「離主城多遠」，越往外推越久——實測一場 232 秒的遊玩裡
   * 161 秒在走路，而且會越來越糟。
   */
  it('打哪一塊地都一樣久，不會隨版圖擴張變長', () => {
    const durations = new Set(createMap().map(() => marchDurationMs(1, 0)));
    expect(durations.size).toBe(1);
  });

  it('步數多的話還是會比較久——公式留著吃參數', () => {
    expect(marchDurationMs(3, 0)).toBeGreaterThan(marchDurationMs(1, 0));
  });

  it('零步或負步當成一步，不會算出比零短的行軍', () => {
    expect(marchDurationMs(0, 0)).toBe(marchDurationMs(1, 0));
    expect(marchDurationMs(-5, 0)).toBe(marchDurationMs(1, 0));
  });

  it('一趟在一分鐘以內——等待不是內容', () => {
    expect(marchDurationMs(1, 0)).toBeLessThan(60_000);
  });

  it('驛站越高走得越快，但不會快到沒有行軍這件事', () => {
    let previous = marchDurationMs(1, 0);
    for (let level = 1; level <= maxLevelOf('relay'); level += 1) {
      const duration = marchDurationMs(1, level);
      expect(duration).toBeLessThan(previous);
      previous = duration;
    }
    expect(previous).toBeGreaterThan(0);
  });

  it('班師是去程的一半', () => {
    expect(returnDurationMs(1, 0)).toBe(Math.round(marchDurationMs(1, 0) * RETURN_RATIO));
  });
});

describe('抵達', () => {
  const march = startMarch('3,2', tileId(CITY_X, CITY_Y), 1, 0, T0);

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
  const march = startMarch('3,2', tileId(CITY_X, CITY_Y), 1, 0, T0);

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
