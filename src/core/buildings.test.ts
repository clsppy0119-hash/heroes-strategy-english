import { describe, expect, it } from 'vitest';

import {
  BUILDING_IDS,
  BUILDING_SPECS,
  GRANARY_BONUS_MS,
  RELAY_FLOOR,
  createBuildings,
  grainPerHour,
  marchSpeedFactor,
  maxLevelOf,
  offlineCapMs,
  upgradeCost,
  upgradeMs,
} from './buildings';
import { GRAIN_PER_TILE_PER_HOUR, MAX_OFFLINE_MS } from './config';

describe('建築規格', () => {
  it('一開始三座都是零級，也沒在蓋', () => {
    const buildings = createBuildings();
    for (const id of BUILDING_IDS) {
      expect(buildings[id]).toEqual({ level: 0, completesAt: null });
    }
  });

  it('每一座的費用與工期長度一致——少一筆就會在滿級前丟錯', () => {
    for (const id of BUILDING_IDS) {
      expect(BUILDING_SPECS[id].costs).toHaveLength(BUILDING_SPECS[id].buildMs.length);
      expect(maxLevelOf(id)).toBe(BUILDING_SPECS[id].costs.length);
    }
  });

  it('越蓋越貴、越蓋越久', () => {
    for (const id of BUILDING_IDS) {
      for (let level = 1; level < maxLevelOf(id); level += 1) {
        expect(upgradeCost(id, level)).toBeGreaterThan(upgradeCost(id, level - 1));
        expect(upgradeMs(id, level)).toBeGreaterThan(upgradeMs(id, level - 1));
      }
    }
  });

  /**
   * 第一級要在一次遊玩裡蓋得完。看不到完工的話，這個機制對玩家等於不存在——
   * #21 的教訓就是機制沒被看見等於沒做。
   */
  it('第一級都在五分鐘內完工', () => {
    for (const id of BUILDING_IDS) {
      expect(upgradeMs(id, 0)).toBeLessThanOrEqual(5 * 60_000);
    }
  });

  it('滿級之後問費用會丟錯，而不是安靜地回 undefined', () => {
    for (const id of BUILDING_IDS) {
      expect(() => upgradeCost(id, maxLevelOf(id))).toThrow(RangeError);
      expect(() => upgradeMs(id, maxLevelOf(id))).toThrow(RangeError);
    }
  });
});

describe('屯田', () => {
  it('零級就是原本的產速', () => {
    expect(grainPerHour(4, 0)).toBe(GRAIN_PER_TILE_PER_HOUR * 4);
  });

  it('每一級都加得更多', () => {
    let previous = grainPerHour(4, 0);
    for (let level = 1; level <= maxLevelOf('farm'); level += 1) {
      const rate = grainPerHour(4, level);
      expect(rate).toBeGreaterThan(previous);
      previous = rate;
    }
  });

  it('地越多，同一級屯田加得越多——建築跟領土是相乘的', () => {
    const oneTile = grainPerHour(1, 1) - grainPerHour(1, 0);
    const fiveTiles = grainPerHour(5, 1) - grainPerHour(5, 0);
    expect(fiveTiles).toBeCloseTo(oneTile * 5);
  });
});

describe('驛站', () => {
  it('零級不影響行軍', () => {
    expect(marchSpeedFactor(0)).toBe(1);
  });

  it('每一級都更快', () => {
    let previous = 1;
    for (let level = 1; level <= maxLevelOf('relay'); level += 1) {
      const factor = marchSpeedFactor(level);
      expect(factor).toBeLessThan(previous);
      previous = factor;
    }
  });

  it('再快也有下限——不然滿級之後行軍等於不存在', () => {
    expect(marchSpeedFactor(99)).toBe(RELAY_FLOOR);
    expect(RELAY_FLOOR).toBeGreaterThan(0);
  });
});

describe('糧倉', () => {
  it('零級就是原本的離線上限', () => {
    expect(offlineCapMs(0)).toBe(MAX_OFFLINE_MS);
  });

  it('每一級多存固定的時間', () => {
    expect(offlineCapMs(2) - offlineCapMs(1)).toBe(GRANARY_BONUS_MS);
  });
});
