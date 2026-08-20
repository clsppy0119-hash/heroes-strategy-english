import { describe, expect, it } from 'vitest';

import { MAX_LEVEL } from './config';
import { defenderHpFor } from './derive';
import {
  CITY_X,
  CITY_Y,
  GRID_SIZE,
  createMap,
  distanceFromCity,
  findTile,
  levelForDistance,
  marchOrigin,
  marchableTiles,
  tileId,
  type Tile,
} from './map';

const tiles = createMap();
const attackable = tiles.filter((tile) => tile.level > 0);

describe('地圖形狀', () => {
  it('六乘六，三十六塊', () => {
    expect(tiles).toHaveLength(GRID_SIZE * GRID_SIZE);
  });

  it('只有一座主城，而且一開始就在手上', () => {
    const cities = tiles.filter((tile) => tile.level === 0);
    expect(cities).toHaveLength(1);
    expect(cities[0].id).toBe(tileId(CITY_X, CITY_Y));
    expect(cities[0].owned).toBe(true);
  });

  it('主城以外一塊都沒有', () => {
    expect(attackable.every((tile) => !tile.owned)).toBe(true);
  });

  it('地形跟等級對齊——主城那一格的地形也是主城', () => {
    expect(findTile(tiles, tileId(CITY_X, CITY_Y))?.terrain).toBe('city');
    expect(tiles.filter((tile) => tile.terrain === 'city')).toHaveLength(1);
  });
});

/**
 * 這一組是 #27 的驗收條件：6×6 出現的每個等級都要推導得出合法血量。
 * 沒有它的話，改地圖大小可能悄悄生出一個 derive.ts 算不出血量的等級，
 * 而那要等玩家點下去才會炸。
 */
describe('等級配置站得住', () => {
  it('出現的每個等級都推導得出守軍血量', () => {
    for (const level of new Set(attackable.map((tile) => tile.level))) {
      expect(() => defenderHpFor(level)).not.toThrow();
    }
  });

  it('沒有超出設定範圍的等級', () => {
    for (const tile of attackable) {
      expect(tile.level).toBeGreaterThanOrEqual(1);
      expect(tile.level).toBeLessThanOrEqual(MAX_LEVEL);
    }
  });

  it('越遠越難，不會在半路變簡單', () => {
    for (let d = 1; d < GRID_SIZE * 2; d += 1) {
      expect(levelForDistance(d)).toBeGreaterThanOrEqual(levelForDistance(d - 1));
    }
  });

  it('同一圈的地等級一樣——難度由距離決定，不是隨機的', () => {
    const byDistance = new Map<number, Set<number>>();
    for (const tile of tiles) {
      const d = distanceFromCity(tile.x, tile.y);
      byDistance.set(d, (byDistance.get(d) ?? new Set()).add(tile.level));
    }
    for (const levels of byDistance.values()) {
      expect(levels.size).toBe(1);
    }
  });

  it('入門坡比終點寬——LV.1 的地比 LV.3 多', () => {
    const count = (level: number) => attackable.filter((tile) => tile.level === level).length;
    expect(count(1)).toBeGreaterThan(count(3));
  });
});

/**
 * 從哪裡出發。行軍時間是用「出發地到目標」算的，所以挑錯出發地
 * 會讓時間也錯——而那不會報錯，只會讓等待變長或變短。
 */
describe('出兵的出發地', () => {
  it('一開始只能從主城出發', () => {
    const target = findTile(tiles, tileId(CITY_X + 1, CITY_Y))!;
    expect(marchOrigin(tiles, target)?.id).toBe(tileId(CITY_X, CITY_Y));
  });

  it('出發地一定跟目標相鄰', () => {
    for (const tile of tiles) {
      const from = marchOrigin(tiles, tile);
      if (from !== undefined) {
        expect(Math.abs(from.x - tile.x) + Math.abs(from.y - tile.y)).toBe(1);
      }
    }
  });

  it('出發地一定是自己的地', () => {
    for (const tile of tiles) {
      expect(marchOrigin(tiles, tile)?.owned ?? true).toBe(true);
    }
  });

  it('沒有相鄰的己方領地就沒有出發地', () => {
    const corner = findTile(tiles, tileId(0, 0))!;
    expect(marchOrigin(tiles, corner)).toBeUndefined();
  });

  /** 有好幾塊可以出發時挑離主城最近的，畫面上才像從內地往外推。 */
  it('相鄰的己方領地不只一塊時，挑離主城最近的', () => {
    const near = tileId(CITY_X + 1, CITY_Y); // (3,2) 離主城 1 步
    const far = tileId(CITY_X + 2, CITY_Y - 1); // (4,1) 離主城 3 步
    const owned = tiles.map((tile) => ([near, far].includes(tile.id) ? { ...tile, owned: true } : tile));

    // (4,2) 跟兩者都相鄰。
    const target = findTile(owned, tileId(CITY_X + 2, CITY_Y))!;
    expect(distanceFromCity(target.x, target.y)).toBe(2);
    expect(marchOrigin(owned, target)?.id).toBe(near);
  });

  it('同一個局面永遠挑同一塊，隊伍不會在重畫時瞬移', () => {
    const target = findTile(tiles, tileId(CITY_X, CITY_Y - 1))!;
    expect(marchOrigin(tiles, target)?.id).toBe(marchOrigin(tiles, target)?.id);
  });
});

/**
 * 大地圖最容易出的錯是「有一塊地誰都打不到」。3×3 用看的就知道，
 * 35 塊地要用走的才知道。
 */
describe('每一塊地都到得了', () => {
  it('從主城沿著相鄰一路推得到全境', () => {
    const reached = new Set<string>([tileId(CITY_X, CITY_Y)]);
    const queue: Tile[] = [findTile(tiles, tileId(CITY_X, CITY_Y))!];
    while (queue.length > 0) {
      const here = queue.pop()!;
      for (const next of tiles) {
        if (!reached.has(next.id) && Math.abs(here.x - next.x) + Math.abs(here.y - next.y) === 1) {
          reached.add(next.id);
          queue.push(next);
        }
      }
    }
    expect(reached.size).toBe(tiles.length);
  });

  it('一開始只打得到主城的四個鄰居', () => {
    const ids = marchableTiles(tiles)
      .map((tile) => tile.id)
      .sort();
    expect(ids).toEqual(
      [
        tileId(CITY_X - 1, CITY_Y),
        tileId(CITY_X + 1, CITY_Y),
        tileId(CITY_X, CITY_Y - 1),
        tileId(CITY_X, CITY_Y + 1),
      ].sort(),
    );
  });
});
