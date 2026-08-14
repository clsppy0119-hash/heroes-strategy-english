import { GRAIN_PER_TILE_PER_HOUR, HOUR_MS, MAX_OFFLINE_MS } from './config';

/**
 * 城池建築。
 *
 * ## 為什麼沒有「提高兵力」
 *
 * #27 原本寫的是「至少兩種：提高產出、提高兵力」。提高產出做了，提高兵力做不了——
 * 它跟同一張 issue 上面那條「通關規則不動」互斥。
 *
 * 守軍血量是從「LV.N 出 N 題、答對 requiredCorrect(N) 題才拿得下」推導出來的
 * （derive.ts）。兵力一漲，同樣的作答序列就打得動更硬的守軍，等於答對更少題
 * 也能過關——通關規則就不成立了。
 *
 * 這其實是那條規則的好處而不是限制：它把勝負釘死在答對幾題上，
 * 所以這個遊戲不會變成「英文不好但練久了也能贏」。任何提升戰鬥力的建築
 * 都會把那個性質拆掉，所以第二、三種建築改成動搖不了勝負的東西：
 * 路走得快一點、離線存得久一點。
 *
 * ## 為什麼升級要花時間
 *
 * 那是「回來看」的第二個理由，也是 v0.2 唯一一個「你不在的時候世界還在動」
 * 的具體證據。第一級刻意短（一兩分鐘），玩家要在第一次遊玩裡就看到一次完工，
 * 否則這個機制對他來說等於不存在（#21 的教訓）。
 *
 * ## 為什麼一次只能蓋一座
 *
 * 主城只有一支工隊。可以同時蓋三座的話，玩家會在開場把糧一次花光然後無事可做；
 * 排隊才讓「先蓋哪一座」變成一個選擇。
 */

export type BuildingId = 'farm' | 'relay' | 'granary';

export const BUILDING_IDS: readonly BuildingId[] = ['farm', 'relay', 'granary'];

export interface BuildingSpec {
  /** costs[n] 是從 n 級升到 n+1 級要的糧。長度就是最高等級。 */
  readonly costs: readonly number[];
  readonly buildMs: readonly number[];
}

const MINUTE_MS = 60_000;

export const BUILDING_SPECS: Readonly<Record<BuildingId, BuildingSpec>> = {
  /** 屯田：每一級讓所有領地多產四分之一。 */
  farm: {
    costs: [400, 900, 1800],
    buildMs: [2 * MINUTE_MS, 12 * MINUTE_MS, 45 * MINUTE_MS],
  },
  /** 驛站：每一級讓行軍快兩成。 */
  relay: {
    costs: [300, 700, 1400],
    buildMs: [90_000, 8 * MINUTE_MS, 30 * MINUTE_MS],
  },
  /** 糧倉：每一級多存四小時的離線產出。 */
  granary: {
    costs: [500, 1200],
    buildMs: [3 * MINUTE_MS, 20 * MINUTE_MS],
  },
};

export interface Building {
  readonly level: number;
  /** 正在施工時是完工的時間戳；沒在蓋是 null。 */
  readonly completesAt: number | null;
}

export type Buildings = Readonly<Record<BuildingId, Building>>;

export function createBuildings(): Buildings {
  return {
    farm: { level: 0, completesAt: null },
    relay: { level: 0, completesAt: null },
    granary: { level: 0, completesAt: null },
  };
}

export function maxLevelOf(id: BuildingId): number {
  return BUILDING_SPECS[id].costs.length;
}

/** 從現在的等級再升一級要多少糧。已經滿級就丟錯。 */
export function upgradeCost(id: BuildingId, level: number): number {
  const cost = BUILDING_SPECS[id].costs[level];
  if (cost === undefined) {
    throw new RangeError(`${id} has no upgrade from level ${level}`);
  }
  return cost;
}

export function upgradeMs(id: BuildingId, level: number): number {
  const ms = BUILDING_SPECS[id].buildMs[level];
  if (ms === undefined) {
    throw new RangeError(`${id} has no upgrade from level ${level}`);
  }
  return ms;
}

/* --------------------------------- 效果 --------------------------------- */

/** 屯田每一級的加成。 */
export const FARM_BONUS_PER_LEVEL = 0.25;

/** 驛站每一級縮短的行軍時間比例。 */
export const RELAY_BONUS_PER_LEVEL = 0.2;

/** 行軍時間再快也不會低於原本的這個比例——不然滿級之後行軍等於不存在。 */
export const RELAY_FLOOR = 0.4;

/** 糧倉每一級多存多久的離線產出。 */
export const GRANARY_BONUS_MS = 4 * HOUR_MS;

/** 每小時產多少糧。地越多、屯田越高越快。 */
export function grainPerHour(ownedTiles: number, farmLevel: number): number {
  return GRAIN_PER_TILE_PER_HOUR * ownedTiles * (1 + FARM_BONUS_PER_LEVEL * farmLevel);
}

/** 離線最多補算多久。 */
export function offlineCapMs(granaryLevel: number): number {
  return MAX_OFFLINE_MS + GRANARY_BONUS_MS * granaryLevel;
}

/** 驛站給的行軍時間倍率。 */
export function marchSpeedFactor(relayLevel: number): number {
  return Math.max(RELAY_FLOOR, 1 - RELAY_BONUS_PER_LEVEL * relayLevel);
}
