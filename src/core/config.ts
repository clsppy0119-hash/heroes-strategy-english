/**
 * v0.1 的規則與數值。
 *
 * ## 通關規則（2026-08-12 lionw 指定）
 *
 * 地格等級 N 出 N 題，需答對「六成、四捨五入」才拿得下：
 *
 *   LV.1  出 1 題，需對 0
 *   LV.2  出 2 題，需對 1
 *   LV.3  出 3 題，需對 2
 *
 * LV.1 是特例，維持「不作答也能完成核心循環」（docs/MASTER_PLAN.md）。
 * 它是入門坡：出一題讓玩家看到答對＝暴擊，但答不出來照樣拿得下。
 *
 * ## 數值不是手調的
 *
 * 守軍血量由上面的規則**推導**出來（見 map.ts 的 defenderHpFor），
 * 不是我挑一組數字然後祈禱它符合。改動傷害公式時門檻會自動維持正確，
 * 推導不出合法血量時會在載入時就炸掉。
 *
 * 這比第一版好：第一版是我手算血量去湊門檻，每次改都要重算一遍，
 * 而且沒有東西保證我算對。
 */

/** 每場戰鬥的起始兵力。v0.1 每場都補滿，糧草才是限制資源。 */
export const START_TROOPS = 1000;

/** 基準傷害＝兵力 × 這個比率。不作答時就是這個值。 */
export const BASE_DAMAGE_RATE = 0.12;

/** 第一次答對的倍率。 */
export const CRIT_BASE = 2.2;

/** 每多連對一次再加多少。 */
export const CRIT_STEP = 0.4;

/** 倍率上限，避免連對太長之後一擊清場。 */
export const CRIT_MAX = 4.0;

/** 出題數＝地格等級。「以此類推」：LV.4 就是四題。 */
export function roundsFor(level: number): number {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError(`level must be a positive integer, got ${level}`);
  }
  return level;
}

/**
 * 需要答對幾題才拿得下。
 *
 * 六成四捨五入，但 LV.1 特例為 0——那條「跳過也能贏」的入門坡要留著，
 * 否則答題就從「表達」變回「門票」。
 */
export function requiredCorrect(level: number): number {
  return level <= 1 ? 0 : Math.round(0.6 * roundsFor(level));
}

/** 任何等級的出題數上限，給埋點與 UI 配置陣列用。 */
export const MAX_LEVEL = 3;
export const MAX_ROUNDS = roundsFor(MAX_LEVEL);

/** 守軍每回合的反擊。血量是推導的，反擊是手調的——它只影響節奏不影響門檻。 */
export const COUNTER_BY_LEVEL: Readonly<Record<number, number>> = {
  1: 40,
  2: 70,
  3: 110,
};

export const HOUR_MS = 3_600_000;

/**
 * 每塊已佔領地格每小時產糧。
 *
 * 刻意慢：一塊地一小時 100，五塊地一小時 500——單次遊玩裡幾乎沒感覺，
 * 但離線八小時回來是四千，夠打二十場。那正是 v0.2 要驗的假設
 * （隔天有東西在等你）。單次遊玩的流動靠戰鬥產出撐，見 time.ts 的說明。
 */
export const GRAIN_PER_TILE_PER_HOUR = 100;

/** 離線再久也只補算到這裡。沒有上限的話，放置一個月回來就是跳過遊戲。 */
export const MAX_OFFLINE_MS = 8 * HOUR_MS;

export const START_GRAIN = 600;

/** 出兵消耗。 */
export const MARCH_COST = 200;

/**
 * 每場戰鬥結束的戰場繳獲。不分勝敗——產糧不是打贏的獎勵。
 *
 * **v0.2 從「每塊已佔領地格 50」改成固定值。** 舊算法在 3×3 就已經是遞增的
 * （八塊地時一場 400，出兵只要 200），只是被地圖大小蓋住了；6×6 有 36 塊地，
 * 一場就繳獲 1800，糧草會在第五塊地之後徹底失去意義，連帶讓城池建築不用花錢。
 *
 * 固定值比出兵成本低，所以打仗本身是淨支出，糧草只能從時間來——
 * 那正是 v0.2 要驗的假設。地多的回報改由時間產出承擔（見 time.ts）。
 */
export const GRAIN_PER_BATTLE = 120;

/** 地格等級對到題目難度。v0.1 的題庫只有兩級。 */
export function vocabLevelForTile(tileLevel: number): number {
  return tileLevel <= 1 ? 1 : 2;
}
