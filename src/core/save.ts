import { BUILDING_IDS, createBuildings, maxLevelOf, type Building, type Buildings } from './buildings';
import type { GameState, GameStatus } from './game';
import { createMap, type Tile } from './map';
import type { March } from './march';
import { RULES_VERSION, type RulesVersion } from './rules';

/**
 * 存檔的打包與驗證。
 *
 * ## 為什麼驗證要寫得這麼囉嗦
 *
 * localStorage 的內容不是我們寫的——它是使用者的磁碟。它可能被手動改過、
 * 被別的分頁半途寫壞、被瀏覽器截斷、或是上一版程式留下的舊形狀。
 *
 * 只檢查版本號不夠：版本號對但 `tiles` 是 undefined 的存檔會讓遊戲白畫面，
 * 而且是在玩家「回來繼續玩」的那一刻壞掉——最不能壞的那一刻。
 *
 * 所以這裡把每個欄位都當成不可信的輸入檢查一遍，任何一項不對就整份作廢。
 * 作廢比硬救好：v0.2 沒有真正的玩家資料要保護，而用錯的形狀跑下去
 * 會在很遠的地方以看不懂的方式壞掉。
 *
 * ## 為什麼地格與建築是「重建再覆蓋」
 *
 * 存檔裡只有「哪幾塊是我的」值得信任；等級、地形、費用表都該以目前的規則為準。
 * 所以讀檔時先 createMap() 生一張新地圖，再把存檔的 owned 蓋上去。
 *
 * 這擋掉一整類 bug：存檔沒辦法塞進一個 derive.ts 算不出血量的地格等級，
 * 也沒辦法塞進一個超過上限的建築等級。就算哪天改地圖忘了遞增 rulesVersion，
 * 壞掉的也只是「哪幾塊是我的」，不會是「遊戲跑不動」。
 */

/** 存檔外殼的形狀版本。改變 SaveEnvelope 的結構時遞增。 */
export const SAVE_VERSION = 1;

export interface SaveEnvelope {
  readonly saveVersion: number;
  readonly rulesVersion: RulesVersion;
  readonly savedAt: number;
  readonly state: GameState;
}

export type LoadFailure =
  /** 沒有存檔。第一次玩就是這個。 */
  | 'empty'
  /** JSON 解不開。 */
  | 'unreadable'
  /** 存檔外殼的形狀變了。 */
  | 'wrong-save-version'
  /** 規則改了，舊存檔的數值不再對應現在的規則。 */
  | 'wrong-rules-version'
  /** 版本都對，但內容不是一個合法的局面。 */
  | 'corrupt';

export type LoadResult =
  | { readonly ok: true; readonly state: GameState; readonly savedAt: number }
  | { readonly ok: false; readonly reason: LoadFailure };

export function packSave(state: GameState, now: number): SaveEnvelope {
  return {
    saveVersion: SAVE_VERSION,
    rulesVersion: RULES_VERSION,
    savedAt: now,
    state,
  };
}

/* ------------------------------ 不可信輸入 ------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 有限的數字。NaN 與 Infinity 會一路傳染到每一個算式，要在門口擋掉。 */
function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegative(value: unknown): value is number {
  return finiteNumber(value) && value >= 0;
}

const STATUSES: readonly GameStatus[] = ['playing', 'cleared', 'stuck'];

function readTiles(value: unknown): readonly Tile[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const ownedIds = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.owned !== 'boolean') {
      return null;
    }
    if (entry.owned) {
      ownedIds.add(entry.id);
    }
  }
  // 以目前的地圖為準，只把「哪幾塊是我的」蓋回去。主城永遠是自己的。
  return createMap().map((tile) =>
    tile.level === 0 || ownedIds.has(tile.id) ? { ...tile, owned: true } : tile,
  );
}

function readBuildings(value: unknown): Buildings | null {
  if (!isRecord(value)) {
    return null;
  }
  const rebuilt: Record<string, Building> = { ...createBuildings() };
  for (const id of BUILDING_IDS) {
    const entry = value[id];
    if (!isRecord(entry)) {
      return null;
    }
    const { level, completesAt } = entry;
    if (!nonNegative(level) || !Number.isInteger(level) || level > maxLevelOf(id)) {
      return null;
    }
    if (completesAt !== null && !nonNegative(completesAt)) {
      return null;
    }
    // 滿級了卻還在施工，代表存檔自相矛盾——把工程丟掉比讓等級溢出好。
    const stillBuilding = completesAt !== null && level < maxLevelOf(id);
    rebuilt[id] = { level, completesAt: stillBuilding ? (completesAt as number) : null };
  }
  return rebuilt as Buildings;
}

function readMarch(value: unknown, tiles: readonly Tile[]): March | null | 'invalid' {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return 'invalid';
  }
  const { tileId, departedAt, arrivesAt } = value;
  if (typeof tileId !== 'string' || !nonNegative(departedAt) || !nonNegative(arrivesAt)) {
    return 'invalid';
  }
  const target = tiles.find((tile) => tile.id === tileId);
  // 打的地不存在或已經是自己的，那支軍隊沒有意義。
  if (target === undefined || target.owned || arrivesAt < departedAt) {
    return 'invalid';
  }
  return { tileId, departedAt, arrivesAt };
}

/**
 * 把不可信的字串讀成局面。
 *
 * 進行中的戰鬥一律不還原（`battle` 永遠是 null）。題目是 UI 層抽的、不在
 * GameState 裡，還原一場沒有題目的戰鬥會在玩家按下第一個選項時炸掉。
 * 關掉分頁等同於鳴金收兵——那是玩家本來就懂的規則，不是新的例外。
 */
export function readSave(raw: string | null): LoadResult {
  if (raw === null || raw === '') {
    return { ok: false, reason: 'empty' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  if (!isRecord(parsed)) {
    return { ok: false, reason: 'unreadable' };
  }
  if (parsed.saveVersion !== SAVE_VERSION) {
    return { ok: false, reason: 'wrong-save-version' };
  }
  if (parsed.rulesVersion !== RULES_VERSION) {
    return { ok: false, reason: 'wrong-rules-version' };
  }
  if (!nonNegative(parsed.savedAt) || !isRecord(parsed.state)) {
    return { ok: false, reason: 'corrupt' };
  }

  const state = parsed.state;
  const tiles = readTiles(state.tiles);
  const buildings = readBuildings(state.buildings);
  if (tiles === null || buildings === null) {
    return { ok: false, reason: 'corrupt' };
  }

  const march = readMarch(state.march, tiles);
  if (march === 'invalid') {
    return { ok: false, reason: 'corrupt' };
  }

  if (
    !finiteNumber(state.seed) ||
    !nonNegative(state.grain) ||
    !nonNegative(state.settledAt) ||
    !nonNegative(state.forfeitedMs) ||
    !nonNegative(state.battlesStarted) ||
    !nonNegative(state.battlesWon) ||
    typeof state.status !== 'string' ||
    !STATUSES.includes(state.status as GameStatus)
  ) {
    return { ok: false, reason: 'corrupt' };
  }

  return {
    ok: true,
    savedAt: parsed.savedAt,
    state: {
      rulesVersion: RULES_VERSION,
      seed: state.seed,
      tiles,
      grain: state.grain,
      buildings,
      march,
      battle: null,
      battlesStarted: state.battlesStarted,
      battlesWon: state.battlesWon,
      status: state.status as GameStatus,
      settledAt: state.settledAt,
      forfeitedMs: state.forfeitedMs,
    },
  };
}
