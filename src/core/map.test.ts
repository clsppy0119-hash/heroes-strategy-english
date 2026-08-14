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
  marchHeadIndex,
  marchPath,
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
 * 行軍路線只給眼睛看，不影響任何規則。但它是行軍時間那條規則的解釋——
 * 遠的地方久，是因為路真的長。所以路線的長度必須跟距離對得上，
 * 否則畫面會在無聲地說謊。
 */
describe('行軍路線', () => {
  it('從主城出發，走到目標', () => {
    const path = marchPath(5, 5);
    expect(path[0]).toBe(tileId(CITY_X, CITY_Y));
    expect(path[path.length - 1]).toBe(tileId(5, 5));
  });

  it('走的格數就是行軍時間用的那個距離', () => {
    for (const tile of tiles) {
      expect(marchPath(tile.x, tile.y).length - 1).toBe(distanceFromCity(tile.x, tile.y));
    }
  });

  it('每一步都只走一格，不會斜著飛過去', () => {
    const path = marchPath(0, 5).map((id) => findTile(tiles, id)!);
    for (let i = 1; i < path.length; i += 1) {
      expect(Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y)).toBe(1);
    }
  });

  it('打主城旁邊就只有兩格', () => {
    expect(marchPath(CITY_X + 1, CITY_Y)).toHaveLength(2);
  });

  it('同一個目標永遠走同一條路——不然畫面每次重畫都會跳', () => {
    expect(marchPath(4, 1)).toEqual(marchPath(4, 1));
  });

  it('隊伍的位置從頭走到尾', () => {
    const path = marchPath(5, 5);
    expect(marchHeadIndex(path, 0.5)).toBeGreaterThan(1);
    expect(marchHeadIndex(path, 1)).toBe(path.length - 1);
  });

  /** 下令之後畫面上要馬上有東西動，不然玩家會以為沒按到。 */
  it('一下令隊伍就離開主城，不會停在原地', () => {
    expect(marchHeadIndex(marchPath(5, 5), 0)).toBe(1);
  });

  it('進度超出範圍也不會走到路線外面', () => {
    const path = marchPath(3, 2);
    expect(marchHeadIndex(path, -5)).toBe(1);
    expect(marchHeadIndex(path, 99)).toBe(path.length - 1);
  });

  it('隊伍一格一格前進，不會跳格', () => {
    const path = marchPath(5, 5);
    let previous = marchHeadIndex(path, 0);
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const head = marchHeadIndex(path, p);
      expect(head - previous).toBeLessThanOrEqual(1);
      expect(head).toBeGreaterThanOrEqual(previous);
      previous = head;
    }
    expect(previous).toBe(path.length - 1);
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
