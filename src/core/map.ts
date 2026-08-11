import { TILE_STATS } from './config';

/**
 * v0.1 的地圖：3×3，中心是主城。
 *
 * 為什麼這麼小：#3 的 v0.1 只驗一件事——作答有沒有戰鬥表達。
 * 地圖大小跟那個問題無關，大地圖只會讓測試者花時間在走路上。
 */

export const GRID_SIZE = 3;

export type TileId = string;

export interface Tile {
  readonly id: TileId;
  readonly x: number;
  readonly y: number;
  /** 0 是主城，不能出兵攻打。 */
  readonly level: number;
  readonly owned: boolean;
}

export function tileId(x: number, y: number): TileId {
  return `${x},${y}`;
}

/**
 * 等級配置：1,1,1,2,2,2,3,3。
 *
 * 第一版是 1,1,2,2,3,3,3,3——四塊 LV.3 佔了實測 60% 的出題量，
 * 難度梯度後重前輕，玩家幾乎都在打贏不了的仗（#14）。
 * 現在兩塊 LV.3 當作要連對才拿得下的目標，其餘鋪成漸進的坡。
 */
const LEVELS: readonly (readonly number[])[] = [
  [2, 1, 3],
  [1, 0, 2],
  [3, 2, 1],
];

export function createMap(): readonly Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const level = LEVELS[y][x];
      tiles.push({ id: tileId(x, y), x, y, level, owned: level === 0 });
    }
  }
  return tiles;
}

export function findTile(tiles: readonly Tile[], id: TileId): Tile | undefined {
  return tiles.find((tile) => tile.id === id);
}

export function isAdjacent(a: Tile, b: Tile): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

/** 只能打「跟已佔領地格正交相鄰」的地格。 */
export function canMarchTo(tiles: readonly Tile[], target: Tile): boolean {
  if (target.owned || target.level === 0) {
    return false;
  }
  return tiles.some((tile) => tile.owned && isAdjacent(tile, target));
}

export function marchableTiles(tiles: readonly Tile[]): readonly Tile[] {
  return tiles.filter((tile) => canMarchTo(tiles, tile));
}

export function defenderHpFor(level: number): number {
  const stats = TILE_STATS[level];
  if (stats === undefined) {
    throw new RangeError(`no stats for tile level ${level}`);
  }
  return stats.defenderHp;
}

export function counterFor(level: number): number {
  const stats = TILE_STATS[level];
  if (stats === undefined) {
    throw new RangeError(`no stats for tile level ${level}`);
  }
  return stats.counter;
}
