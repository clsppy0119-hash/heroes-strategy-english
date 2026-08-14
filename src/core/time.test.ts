import { describe, expect, it } from 'vitest';

import { createBuildings, grainPerHour, offlineCapMs } from './buildings';
import { GRAIN_PER_TILE_PER_HOUR, HOUR_MS, MARCH_COST, MAX_OFFLINE_MS } from './config';
import { createGame, ownedCount, settleTime, startUpgrade, type GameState } from './game';
import { accrueGrain, msPerGrain } from './time';

const T0 = 1_700_000_000_000;

/** 一塊地、沒有屯田的產速。大部分測試不需要另外算。 */
const BASE = GRAIN_PER_TILE_PER_HOUR;
const CAP = MAX_OFFLINE_MS;

describe('accrueGrain', () => {
  it('一小時產出設定的量', () => {
    expect(accrueGrain(BASE, T0, T0 + HOUR_MS, CAP).grain).toBe(GRAIN_PER_TILE_PER_HOUR);
  });

  it('速率越高產得越快', () => {
    expect(accrueGrain(BASE * 3, T0, T0 + HOUR_MS, CAP).grain).toBe(GRAIN_PER_TILE_PER_HOUR * 3);
  });

  it('沒過時間就沒有產出', () => {
    expect(accrueGrain(BASE, T0, T0, CAP).grain).toBe(0);
  });

  it('時鐘倒退不會倒扣，也不會爆掉', () => {
    const accrual = accrueGrain(BASE, T0, T0 - HOUR_MS, CAP);
    expect(accrual.grain).toBe(0);
    expect(accrual.settledAt).toBe(T0);
  });

  it('速率是零或負數就丟錯——主城永遠在，所以那代表狀態壞了', () => {
    expect(() => accrueGrain(0, T0, T0 + HOUR_MS, CAP)).toThrow(RangeError);
    expect(() => accrueGrain(-1, T0, T0 + HOUR_MS, CAP)).toThrow(RangeError);
  });
});

/**
 * 這一組是懶計算最容易寫壞的地方：先乘再取整的話，被頻繁呼叫時
 * 每次都會把不足一顆的零頭捨掉，玩家的產出會憑空蒸發。
 */
describe('零頭不會被吃掉', () => {
  it('連續補算很多次，總量跟一次補算相同', () => {
    const step = msPerGrain(BASE) / 7; // 刻意不整除
    let settledAt = T0;
    let total = 0;
    for (let i = 1; i <= 700; i += 1) {
      const accrual = accrueGrain(BASE, settledAt, T0 + step * i, CAP);
      total += accrual.grain;
      settledAt = accrual.settledAt;
    }
    const once = accrueGrain(BASE, T0, T0 + step * 700, CAP);
    expect(total).toBe(once.grain);
  });

  it('不足一顆糧時時間戳不動，零頭留在帳上', () => {
    const almost = msPerGrain(BASE) - 1;
    const accrual = accrueGrain(BASE, T0, T0 + almost, CAP);
    expect(accrual.grain).toBe(0);
    expect(accrual.settledAt).toBe(T0);
  });
});

describe('離線上限', () => {
  it('補算到上限為止', () => {
    const capped = accrueGrain(BASE, T0, T0 + CAP * 10, CAP);
    const atCap = accrueGrain(BASE, T0, T0 + CAP, CAP);
    expect(capped.grain).toBe(atCap.grain);
  });

  it('超出的時間是丟掉的，不會留在帳上', () => {
    const now = T0 + CAP * 3;
    const accrual = accrueGrain(BASE, T0, now, CAP);
    // 時間戳直接推到現在，不然多出來的那段會在下次被領走，上限就形同虛設。
    expect(accrual.settledAt).toBe(now);
    expect(accrual.forfeitedMs).toBe(CAP * 2);
  });

  it('沒超過上限就不算丟掉', () => {
    expect(accrueGrain(BASE, T0, T0 + HOUR_MS, CAP).forfeitedMs).toBe(0);
  });

  it('糧倉把上限撐大，同樣的離線時間就存得下來', () => {
    const bigger = offlineCapMs(1);
    const now = T0 + bigger;
    expect(accrueGrain(BASE, T0, now, bigger).forfeitedMs).toBe(0);
    expect(accrueGrain(BASE, T0, now, CAP).forfeitedMs).toBeGreaterThan(0);
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

/**
 * 建築完工會把產速調上去，所以補算不能用單一速率算完一整段離線時間。
 * 這一組盯著那一刀有切在正確的地方——多發或少發都是玩家看不出來的錯帳。
 */
describe('建築完工在補算途中生效', () => {
  const rich = (): GameState => ({ ...createGame('build', T0), grain: 100_000 });

  it('完工之後才有加成，完工之前沒有', () => {
    const started = startUpgrade(rich(), 'farm', T0);
    const completesAt = started.buildings.farm.completesAt!;

    const before = settleTime(started, completesAt - 1);
    expect(before.buildings.farm.level).toBe(0);

    const after = settleTime(started, completesAt);
    expect(after.buildings.farm.level).toBe(1);
  });

  it('前半段用舊速率、後半段用新速率', () => {
    const started = startUpgrade(rich(), 'farm', T0);
    const completesAt = started.buildings.farm.completesAt!;
    const now = completesAt + HOUR_MS;
    const tiles = ownedCount(started);

    const gained = settleTime(started, now).grain - started.grain;

    const slow = (completesAt - T0) / msPerGrain(grainPerHour(tiles, 0));
    const fast = HOUR_MS / msPerGrain(grainPerHour(tiles, 1));

    // 誤差是分段交界的零頭，只可能多不到一顆糧。
    expect(gained).toBeGreaterThanOrEqual(Math.floor(slow + fast));
    expect(gained).toBeLessThanOrEqual(Math.floor(slow + fast) + 1);
  });

  it('一整段都用完工後的速率算會多發——這個測試就是在擋那件事', () => {
    const started = startUpgrade(rich(), 'farm', T0);
    const completesAt = started.buildings.farm.completesAt!;
    const now = completesAt + HOUR_MS;
    const tiles = ownedCount(started);

    const gained = settleTime(started, now).grain - started.grain;
    const allFast = Math.floor((now - T0) / msPerGrain(grainPerHour(tiles, 1)));

    expect(gained).toBeLessThan(allFast);
  });

  it('離線很久，完工的建築照樣完工——工期不受離線上限影響', () => {
    const started = startUpgrade(rich(), 'granary', T0);
    const after = settleTime(started, T0 + MAX_OFFLINE_MS * 5);
    expect(after.buildings.granary.level).toBe(1);
    expect(after.buildings.granary.completesAt).toBeNull();
  });

  it('還沒完工就重複補算，不會提早蓋好也不會重來', () => {
    const started = startUpgrade(rich(), 'farm', T0);
    const completesAt = started.buildings.farm.completesAt!;
    let state = started;
    for (let at = T0; at < completesAt; at += 1_000) {
      state = settleTime(state, at);
    }
    expect(state.buildings.farm.level).toBe(0);
    expect(state.buildings.farm.completesAt).toBe(completesAt);
    expect(settleTime(state, completesAt).buildings.farm.level).toBe(1);
  });

  it('沒有建築在蓋時，補算跟以前一樣', () => {
    const plain: GameState = { ...createGame('plain', T0), buildings: createBuildings() };
    expect(settleTime(plain, T0 + HOUR_MS).grain).toBe(
      plain.grain + GRAIN_PER_TILE_PER_HOUR * ownedCount(plain),
    );
  });
});
