import { packSave, readSave, type GameState, type LoadResult } from '@/core';

/**
 * 存檔的去處。
 *
 * ## 為什麼是介面
 *
 * v0.2 前半存在瀏覽器，後半（#30）存進 Postgres。換的時候只動這個資料夾——
 * `src/core` 不知道 repository 存在（它只吃狀態、吐狀態），UI 只認得介面。
 *
 * 這跟埋點的 sink 是同一個模式，v0.1 已經驗證過那個模式可行。
 *
 * ## 為什麼是 async
 *
 * localStorage 是同步的，包成 Promise 看起來多餘。但後端版本一定是 async，
 * 現在不包，之後換實作時每一個呼叫端都要改成 await——那正是這個介面
 * 存在的目的要避免的事。
 *
 * ## 為什麼 core 不放實作
 *
 * `scripts/check-core-purity.mjs` 擋著 `localStorage`。那不是形式主義：
 * core 要能整塊搬到伺服器跑，碰到瀏覽器 API 就搬不動了。
 * 驗證邏輯（`readSave`）留在 core，因為伺服器一樣需要它——不可信的輸入
 * 在哪一端都要驗。
 */
export interface GameRepository {
  readonly name: string;
  load(playerId: string): Promise<LoadResult>;
  save(playerId: string, state: GameState, now: number): Promise<void>;
  clear(playerId: string): Promise<void>;
}

export const SAVE_KEY_PREFIX = 'hse.save';

export function saveKey(playerId: string): string {
  return `${SAVE_KEY_PREFIX}.${playerId}`;
}

/** v0.2 只有一個本機玩家。#30 接上帳號之後這裡換成真的 id。 */
export const LOCAL_PLAYER_ID = 'local';

export function createLocalStorageRepository(storage: Storage): GameRepository {
  return {
    name: 'localStorage',

    async load(playerId) {
      try {
        return readSave(storage.getItem(saveKey(playerId)));
      } catch {
        // Safari 無痕模式讀 localStorage 會丟例外。讀不到就當作新玩家，
        // 不該讓整個遊戲開不起來。
        return { ok: false, reason: 'unreadable' };
      }
    },

    async save(playerId, state, now) {
      try {
        storage.setItem(saveKey(playerId), JSON.stringify(packSave(state, now)));
      } catch {
        // 配額滿或無痕模式。存檔失敗不該打斷正在玩的人——
        // 下一次自動存檔還會再試一次。
      }
    },

    async clear(playerId) {
      try {
        storage.removeItem(saveKey(playerId));
      } catch {
        /* 同上 */
      }
    },
  };
}

/** 測試與伺服器端 render 用。 */
export function createMemoryRepository(): GameRepository {
  const saves = new Map<string, string>();
  return {
    name: 'memory',
    async load(playerId) {
      return readSave(saves.get(playerId) ?? null);
    },
    async save(playerId, state, now) {
      saves.set(playerId, JSON.stringify(packSave(state, now)));
    },
    async clear(playerId) {
      saves.delete(playerId);
    },
  };
}

let repository: GameRepository | null = null;

/** 預設的 repository。伺服器端 render 沒有 localStorage，用記憶體版頂著。 */
export function gameRepository(): GameRepository {
  if (repository === null) {
    repository =
      typeof window === 'undefined'
        ? createMemoryRepository()
        : createLocalStorageRepository(window.localStorage);
  }
  return repository;
}

/** 測試用：換掉預設實作。 */
export function configureRepository(next: GameRepository | null): void {
  repository = next;
}
