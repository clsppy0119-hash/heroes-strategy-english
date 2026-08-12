import { describe, expect, it } from 'vitest';

import { GRAIN_PER_TILE_PER_HOUR, HOUR_MS, MARCH_COST, MAX_OFFLINE_MS } from './config';
import { createGame, ownedCount, settleTime, type GameState } from './game';
import { accrueGrain, msPerGrain } from './time';

const T0 = 1_700_000_000_000;

describe('accrueGrain', () => {
  it('一小時一塊地產出設定的量', () => {
    expect(accrueGrain(1, T0, T0 + HOUR_MS).grain).toBe(GRAIN_PER_TILE_PER_HOUR);
  });

  it('地越多產得越快', () => {
    expect(accrueGrain(3, T0, T0 + HOUR_MS).grain).toBe(GRAIN_PER_TILE_PER_HOUR * 3);
  });

  it('沒過時間就沒有產出', () => {
    expect(accrueGrain(1, T0, T0).grain).toBe(0);
  });

  it('時鐘倒退不會倒扣，也不會爆掉', () => {
    const accrual = accrueGrain(1, T0, T0 - HOUR_MS);
    expect(accrual.grain).toBe(0);
    expect(accrual.settledAt).toBe(T0);
  });

  it('沒有地就丟錯——主城永遠在，所以那代表狀態壞了', () => {
    expect(() => accrueGrain(0, T0, T0 + HOUR_MS)).toThrow(RangeError);
  });
});

/**
 * 這一組是懶計算最容易寫壞的地方：先乘再取整的話，被頻繁呼叫時
 * 每次都會把不足一顆的零頭捨掉，玩家的產出會憑空蒸發。
 */
describe('零頭不會被吃掉', () => {
  it('連續補算很多次，總量跟一次補算相同', () => {
    const step = msPerGrain(1) / 7; // 刻意不整除
    let settledAt = T0;
    let total = 0;
    for (let i = 1; i <= 700; i += 1) {
      const accrual = accrueGrain(1, settledAt, T0 + step * i);
      total += accrual.grain;
      settledAt = accrual.settledAt;
    }
    const once = accrueGrain(1, T0, T0 + step * 700);
    expect(total).toBe(once.grain);
  });

  it('不足一顆糧時時間戳不動，零頭留在帳上', () => {
    const almost = msPerGrain(1) - 1;
    const accrual = accrueGrain(1, T0, T0 + almost);
    expect(accrual.grain).toBe(0);
    expect(accrual.settledAt).toBe(T0);
  });
});

describe('離線上限', () => {
  it('補算到上限為止', () => {
    const capped = accrueGrain(1, T0, T0 + MAX_OFFLINE_MS * 10);
    const atCap = accrueGrain(1, T0, T0 + MAX_OFFLINE_MS);
    expect(capped.grain).toBe(atCap.grain);
  });

  it('超出的時間是丟掉的，不會留在帳上', () => {
    const now = T0 + MAX_OFFLINE_MS * 3;
    const accrual = accrueGrain(1, T0, now);
    // 時間戳直接推到現在，不然多出來的那段會在下次被領走，上限就形同虛設。
    expect(accrual.settledAt).toBe(now);
    expect(accrual.forfeitedMs).toBe(MAX_OFFLINE_MS * 2);
  });

  it('沒超過上限就不算丟掉', () => {
    expect(accrueGrain(1, T0, T0 + HOUR_MS).forfeitedMs).toBe(0);
  });
});

describe('settleTime', () => {
  const fresh = () => createGame('time', T0);

  it('離線一小時後有糧進來', () => {
    const before = fresh();
    const after = settleTime(before, T0 + HOUR_MS);
    expect(after.grain).toBe(before.grain + GRAIN_PER_TILE_PER_HOUR * ownedCount(before));
  });

  it('沒過時間就回傳原本的物件，不製造無謂的新狀態', () => {
    const state = fresh();
    expect(settleTime(state, T0)).toBe(state);
  });

  it('重複補算不會重複計算', () => {
    const once = settleTime(fresh(), T0 + HOUR_MS);
    expect(settleTime(once, T0 + HOUR_MS)).toBe(once);
  });

  it('補算到有糧就解除卡住', () => {
    const stuck: GameState = { ...fresh(), grain: 0, status: 'stuck' };
    const after = settleTime(stuck, T0 + HOUR_MS * 8);
    expect(after.grain).toBeGreaterThanOrEqual(MARCH_COST);
    expect(after.status).toBe('playing');
  });

  it('補算不會把已經通關的局面改回進行中', () => {
    const cleared: GameState = { ...fresh(), status: 'cleared' };
    expect(settleTime(cleared, T0 + HOUR_MS).status).toBe('cleared');
  });

  it('離線太久會記下被丟掉的時間', () => {
    const after = settleTime(fresh(), T0 + MAX_OFFLINE_MS * 2);
    expect(after.forfeitedMs).toBe(MAX_OFFLINE_MS);
  });
});

/**
 * 補算必須在改變局面之前。反過來的話，新佔領的地會回頭替過去的時間產糧——
 * 這是懶計算最常見的錯法，而且很難從畫面上看出來。
 */
describe('補算的順序', () => {
  it('先補算再佔領，跟先佔領再補算，結果不一樣', () => {
    const base = createGame('order', T0);
    const now = T0 + HOUR_MS;

    const settledFirst = settleTime(base, now);
    const capturedFirst: GameState = {
      ...base,
      tiles: base.tiles.map((tile, i) => (i === 0 ? { ...tile, owned: true } : tile)),
    };
    const settledAfter = settleTime(capturedFirst, now);

    expect(settledAfter.grain).toBeGreaterThan(settledFirst.grain);
  });
});
