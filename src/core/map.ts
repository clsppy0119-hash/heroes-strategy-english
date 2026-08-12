/**
 * 地圖：6×6，(2,2) 是主城。
 *
 * ## 為什麼從 3×3 變成 6×6
 *
 * v0.1 只驗「作答有沒有戰鬥表達」，地圖大小跟那個問題無關，所以刻意做小。
 * v0.2 要驗的是「隔天有東西在等你」——那需要一個一次玩不完的戰場，
 * 否則玩家在第一次遊玩裡就打完全境，沒有「明天回來」這件事。
 *
 * ## 為什麼等級是算出來的，不是排出來的
 *
 * v0.1 的八塊地是手排的（1,1,1,2,2,2,3,3）。35 塊地手排會變成一張
 * 沒有人看得懂為什麼的表，而且改一次就要重排一次。
 *
 * 現在等級由「離主城多遠」決定：越往外越難。這同時給了地圖一個玩家看得懂的
 * 結構——你是從中心往外推的，不是在一堆隨機難度裡挑。
 */

export const GRID_SIZE = 6;

/** 主城座標。不置中是因為 6×6 沒有正中心，(2,2) 是靠中心的那一格。 */
export const CITY_X = 2;
export const CITY_Y = 2;

export type TileId = string;

/**
 * 地形。純粹是身分，不影響任何規則——但沒有它，地圖就只是一堆寫著等級的方塊，
 * 玩家看到的是測驗軟體而不是戰場（#21）。
 *
 * 用英文識別碼而不是直接寫中文：core 不得出現介面文案，顯示名稱走 i18n key。
 */
export type Terrain = 'city' | 'pass' | 'forest' | 'field' | 'mine' | 'waste';

export interface Tile {
  readonly id: TileId;
  readonly x: number;
  readonly y: number;
  /** 0 是主城，不能出兵攻打。 */
  readonly level: number;
  readonly terrain: Terrain;
  readonly owned: boolean;
}

export function tileId(x: number, y: number): TileId {
  return `${x},${y}`;
}

/** 離主城幾步（正交）。也是行軍距離。 */
export function distanceFromCity(x: number, y: number): number {
  return Math.abs(x - CITY_X) + Math.abs(y - CITY_Y);
}

/**
 * 距離對到等級。
 *
 * 邊界刻意讓 LV.1 佔兩圈：那是入門坡，玩家要先在跳過也打得動的地上
 * 看懂「答對＝暴擊」，才有本錢去碰需要連對的地。
 *
 * 6×6 的實際分佈：LV.1 十二塊、LV.2 十八塊、LV.3 五塊。
 * LV.3 只有四個角落跟最遠的一塊——v0.1 實測證明 LV.3 鋪太多會讓玩家
 * 一直待在打不贏的仗裡（#14）。
 */
export function levelForDistance(distance: number): number {
  if (distance <= 0) {
    return 0;
  }
  if (distance <= 2) {
    return 1;
  }
  return distance <= 4 ? 2 : 3;
}

/**
 * 地形擺放。跟等級無關，但刻意跟距離同方向：近處農田密林，遠處關隘荒原。
 * 玩家不必讀說明也會覺得「越外面越荒」，那是等級梯度的視覺回音。
 */
const TERRAIN: readonly (readonly Terrain[])[] = [
  ['waste', 'pass', 'mine', 'waste', 'pass', 'waste'],
  ['pass', 'forest', 'field', 'field', 'mine', 'pass'],
  ['mine', 'field', 'city', 'field', 'forest', 'waste'],
  ['waste', 'field', 'field', 'forest', 'field', 'mine'],
  ['pass', 'mine', 'forest', 'field', 'mine', 'pass'],
  ['waste', 'pass', 'waste', 'mine', 'pass', 'waste'],
];

export function createMap(): readonly Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const level = levelForDistance(distanceFromCity(x, y));
      tiles.push({ id: tileId(x, y), x, y, level, terrain: TERRAIN[y][x], owned: level === 0 });
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
