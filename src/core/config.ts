/**
 * v0.1 的數值。
 *
 * 這組數字要同時滿足兩件事，缺一個設計就失敗：
 *
 *   1. **跳過打得動** —— 完全不作答仍能拿下 LV.1 地格。
 *      作答如果是打贏的必要條件，它就變回強制門票，
 *      違反 docs/MASTER_PLAN.md 的「不作答也能完成核心循環」。
 *
 *   2. **跳過打得很差** —— 完全不作答絕對拿不下 LV.2 以上。
 *      作答如果只是可有可無的小加成，理性玩法就是無視它，
 *      英文退化成介面裝飾。
 *
 * core/battle.test.ts 有三個測試直接驗這條梯度。改動任何一個數字都會動到它們，
 * 這是刻意的——這些不是「參數」，是設計本身。
 *
 * 實際倍率要在 #7 用真人資料校準。
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

/** 超過就算戰敗撤退。六回合是刻意的短——一場仗不該讓人答到膩。 */
export const MAX_ROUNDS = 6;

export const START_GRAIN = 600;

/** 出兵消耗。輸三場就會卡住，這是 v0.1 唯一的失敗狀態。 */
export const MARCH_COST = 200;

/** 每場戰鬥結束後，每塊已佔領的地格產出。不分勝敗——產糧不是打贏的獎勵。 */
export const GRAIN_PER_OWNED_TILE = 50;

/**
 * 守軍兵力與每回合反擊，依地格等級。
 *
 * 六回合裡答對幾題就拿得下：
 *
 *   LV.1  0 題（跳過也打得動）
 *   LV.2  2 題
 *   LV.3  3 題
 *
 * LV.3 原本要 5 題，2026-08-11 lionw 指定改成「對三題就讓他拿下」。
 * 800 是符合這條要求的值：三題對 95%、兩題對 20%、一題以下 0%——
 * 也就是仍然擋得住亂點，但只要真的認得三個字就過得去。
 *
 * 順帶記錄一個上限：往上調的話 1650 以上連六題全對都打不穿，
 * 因為六回合的總傷害有天花板。那不是變難，是變成不可能。
 *
 * 全部數值的驗收在 battle.test.ts 的「設計梯度」那組測試。
 */
export const TILE_STATS: Readonly<Record<number, { readonly defenderHp: number; readonly counter: number }>> = {
  1: { defenderHp: 300, counter: 40 },
  2: { defenderHp: 700, counter: 70 },
  3: { defenderHp: 800, counter: 110 },
};

/** 地格等級對到題目難度。v0.1 的題庫只有兩級。 */
export function vocabLevelForTile(tileLevel: number): number {
  return tileLevel <= 1 ? 1 : 2;
}
