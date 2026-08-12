import { GRAIN_PER_TILE_PER_HOUR, HOUR_MS, MAX_OFFLINE_MS } from './config';

/**
 * 時間軸。
 *
 * ## 為什麼不用 tick
 *
 * 沒有常駐進程可以每秒跑一次（路線圖的架構決策：Serverless 撐不住 tick）。
 * 改成存一個 `settledAt` 時間戳，玩家讀取時再一次補算。同一份邏輯在客戶端
 * 與伺服器算出同樣結果，v0.2 後半把結算搬到伺服器時不用重寫。
 *
 * ## 為什麼時間產出跟戰鬥產出並存
 *
 * 時間產出要慢——夠慢才會有「離線一夜回來有一堆東西」的感覺，那是 v0.2
 * 要驗的假設。但一場戰鬥只有幾分鐘，慢產出在一次遊玩裡等於沒有，
 * 玩家會卡在等待而不是玩。
 *
 * 所以兩條都留：戰鬥結束的即時產出撐住單次遊玩的流動，時間產出是回來的理由。
 *
 * ## 為什麼有離線上限
 *
 * 沒有上限的話，放置一個月回來就能直接通關，那不是「回來看看」是「跳過遊戲」。
 */

export interface Accrual {
  /** 這次補算拿到多少糧。 */
  readonly grain: number;
  /** 補算之後的時間戳。 */
  readonly settledAt: number;
  /** 因為超過離線上限而被丟掉的時間。UI 可以拿它提醒玩家。 */
  readonly forfeitedMs: number;
}

/**
 * 從 `settledAt` 到 `now` 累積了多少糧。
 *
 * 刻意以「產出一顆糧要多少毫秒」為單位推進，而不是先乘再取整：
 * 後者在被頻繁呼叫時會一直把不足一顆的零頭無條件捨去，玩家的產出會憑空蒸發。
 * 這裡只把「真的換成糧的那段時間」推掉，剩下的留到下次。
 */
export function accrueGrain(ownedTiles: number, settledAt: number, now: number): Accrual {
  if (ownedTiles <= 0) {
    throw new RangeError(`ownedTiles must be positive, got ${ownedTiles}`);
  }
  // 時鐘倒退（換裝置、校時）不該倒扣，也不該爆掉。
  const elapsed = Math.max(0, now - settledAt);
  const capped = Math.min(elapsed, MAX_OFFLINE_MS);

  const msPerGrain = HOUR_MS / (GRAIN_PER_TILE_PER_HOUR * ownedTiles);
  const grain = Math.floor(capped / msPerGrain);

  // 超過上限時把時間戳直接推到現在，多出來的那段就是丟掉了——
  // 不然它會留在帳上，等於上限沒有作用。
  const settled = elapsed > MAX_OFFLINE_MS ? now : settledAt + grain * msPerGrain;

  return {
    grain,
    settledAt: settled,
    forfeitedMs: Math.max(0, elapsed - MAX_OFFLINE_MS),
  };
}

/** 產出一顆糧要多少毫秒。UI 用它顯示速率。 */
export function msPerGrain(ownedTiles: number): number {
  if (ownedTiles <= 0) {
    throw new RangeError(`ownedTiles must be positive, got ${ownedTiles}`);
  }
  return HOUR_MS / (GRAIN_PER_TILE_PER_HOUR * ownedTiles);
}
