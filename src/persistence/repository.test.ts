import { beforeEach, describe, expect, it } from 'vitest';

import { createGame, orderMarch, resumeGame, startUpgrade, type GameState } from '@/core';
import { CITY_X, CITY_Y, tileId } from '@/core';

import {
  LOCAL_PLAYER_ID,
  createLocalStorageRepository,
  createMemoryRepository,
  saveKey,
  type GameRepository,
} from './repository';

const T0 = 1_700_000_000_000;
const NEAR = tileId(CITY_X + 1, CITY_Y);

/** 夠用的 localStorage 替身。jsdom 的那個在 node 環境下不存在。 */
function fakeStorage(): Storage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  } as Storage & { readonly map: Map<string, string> };
}

/** 每一種實作都要通過同一組行為測試——介面存在的意義就是可以互換。 */
function behavesLikeARepository(name: string, make: () => GameRepository) {
  describe(name, () => {
    let repository: GameRepository;

    beforeEach(() => {
      repository = make();
    });

    it('沒存過就是沒有存檔', async () => {
      expect(await repository.load(LOCAL_PLAYER_ID)).toEqual({ ok: false, reason: 'empty' });
    });

    it('存了就讀得回來', async () => {
      const state = createGame('seed', T0);
      await repository.save(LOCAL_PLAYER_ID, state, T0);
      const result = await repository.load(LOCAL_PLAYER_ID);
      expect(result.ok && result.state).toEqual(state);
    });

    it('後存的蓋掉先存的', async () => {
      await repository.save(LOCAL_PLAYER_ID, createGame('first', T0), T0);
      const second: GameState = { ...createGame('second', T0), grain: 4_321 };
      await repository.save(LOCAL_PLAYER_ID, second, T0 + 1);
      const result = await repository.load(LOCAL_PLAYER_ID);
      expect(result.ok && result.state.grain).toBe(4_321);
    });

    it('清掉之後就沒有了', async () => {
      await repository.save(LOCAL_PLAYER_ID, createGame('s', T0), T0);
      await repository.clear(LOCAL_PLAYER_ID);
      expect(await repository.load(LOCAL_PLAYER_ID)).toEqual({ ok: false, reason: 'empty' });
    });

    it('不同玩家各存各的', async () => {
      await repository.save('a', { ...createGame('s', T0), grain: 111 }, T0);
      await repository.save('b', { ...createGame('s', T0), grain: 222 }, T0);
      const a = await repository.load('a');
      const b = await repository.load('b');
      expect(a.ok && a.state.grain).toBe(111);
      expect(b.ok && b.state.grain).toBe(222);
    });

    /** #29 的驗收條件：關掉分頁再開，局面完整回來。 */
    it('關掉再開，領地、建築、行軍、時間戳都在', async () => {
      let state = startUpgrade({ ...createGame('s', T0), grain: 5_000 }, 'farm', T0);
      state = {
        ...state,
        tiles: state.tiles.map((tile) => (tile.id === NEAR ? { ...tile, owned: true } : tile)),
      };
      state = orderMarch(state, tileId(CITY_X + 2, CITY_Y), T0);

      await repository.save(LOCAL_PLAYER_ID, state, T0);
      const result = await repository.load(LOCAL_PLAYER_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.state.tiles.filter((tile) => tile.owned)).toHaveLength(2);
      expect(result.state.buildings.farm.completesAt).toBe(state.buildings.farm.completesAt);
      expect(result.state.march).toEqual(state.march);
      expect(result.state.settledAt).toBe(state.settledAt);
      expect(result.state.grain).toBe(state.grain);
    });
  });
}

behavesLikeARepository('記憶體實作', createMemoryRepository);
behavesLikeARepository('localStorage 實作', () => createLocalStorageRepository(fakeStorage()));

describe('localStorage 實作的細節', () => {
  it('key 帶玩家 id，換帳號不會撞在一起', () => {
    expect(saveKey('a')).not.toBe(saveKey('b'));
    expect(saveKey(LOCAL_PLAYER_ID)).toContain(LOCAL_PLAYER_ID);
  });

  /**
   * Safari 無痕模式碰 localStorage 會丟例外，配額滿也會。
   * 存檔失敗不該讓遊戲開不起來或當掉——那比沒有存檔嚴重得多。
   */
  it('storage 一碰就丟例外時，讀取回報讀不到而不是往上炸', async () => {
    const hostile = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
      removeItem() {
        throw new Error('SecurityError');
      },
    } as unknown as Storage;

    const repository = createLocalStorageRepository(hostile);
    expect(await repository.load(LOCAL_PLAYER_ID)).toEqual({ ok: false, reason: 'unreadable' });
    await expect(repository.save(LOCAL_PLAYER_ID, createGame('s', T0), T0)).resolves.toBeUndefined();
    await expect(repository.clear(LOCAL_PLAYER_ID)).resolves.toBeUndefined();
  });

  it('別人寫進同一個 key 的垃圾不會讓讀取炸掉', async () => {
    const storage = fakeStorage();
    storage.setItem(saveKey(LOCAL_PLAYER_ID), 'not json at all');
    const result = await createLocalStorageRepository(storage).load(LOCAL_PLAYER_ID);
    expect(result).toEqual({ ok: false, reason: 'unreadable' });
  });
});

/** 存檔加上讀檔加上補算，就是「離線一夜再回來」那條路徑的全部。 */
describe('離線一夜再回來', () => {
  it('回來時糧多了、建築蓋好了、軍隊等在那裡', async () => {
    const repository = createMemoryRepository();
    let state = startUpgrade({ ...createGame('s', T0), grain: 5_000 }, 'farm', T0);
    state = orderMarch(state, NEAR, T0);
    await repository.save(LOCAL_PLAYER_ID, state, T0);

    const morning = T0 + 9 * 60 * 60 * 1000;
    const result = await repository.load(LOCAL_PLAYER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const resumed = resumeGame(result.state, morning);

    expect(resumed.grain).toBeGreaterThan(state.grain);
    expect(resumed.buildings.farm.level).toBe(1);
    expect(resumed.march?.tileId).toBe(NEAR);
    // 離線上限有作用，多出來的時間被丟掉了。
    expect(resumed.forfeitedMs).toBeGreaterThan(0);
  });
});
