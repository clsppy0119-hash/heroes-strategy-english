/**
 * 間隔複習 v1。
 *
 * ## 為什麼間隔這麼短
 *
 * 真正的 SRS 以「天」為單位。照搬過來的話，這個機制在遊戲裡會完全看不見：
 * 玩家第一次玩的四十分鐘內沒有任何一個字會到期，而下一次打開可能是明天，
 * 那時他也分不出「這個字重現是因為我上次答錯」還是「隨機抽到的」。
 *
 * 所以第一個間隔壓到三分鐘：一場戰鬥幾分鐘，答錯的字會在同一場遊玩裡
 * 回來找你，那一刻玩家才建立得起「錯的會再來」的預期。之後翻倍成長，
 * 到第八次就超過一天，長期行為仍然是間隔複習該有的樣子。
 *
 * 這是刻意用可玩性換學習理論的正確性。要調的話調這裡，不要改結構。
 *
 * ## 為什麼答錯不是歸零
 *
 * 歸零等於整段記憶白費。答錯只把穩定度打回去一截（乘上 LAPSE_PENALTY），
 * 錯第二次才真的掉到底。這跟戰鬥裡連對不歸零、只退一階是同一個判斷
 * ——懲罰要看得見，但不能把人推到「反正都毀了」。
 */

/** 第一次答對之後多久再問。 */
export const FIRST_INTERVAL_MS = 3 * 60_000;

/** 答錯之後多久再問。刻意很短——錯的字要在同一場遊玩裡回來。 */
export const LAPSE_INTERVAL_MS = 60_000;

/** 答對時穩定度的成長倍率上限（difficulty 0 時）。 */
export const MAX_GROWTH = 2.5;

/** difficulty 1 時的成長倍率。仍然大於 1，不然難字永遠不會畢業。 */
export const MIN_GROWTH = 1.4;

/** 答錯時穩定度乘上這個。不是歸零——歸零等於整段記憶白費。 */
export const LAPSE_PENALTY = 0.4;

/** 間隔上限。再長就等於這輩子不會再問了。 */
export const MAX_INTERVAL_MS = 30 * 24 * 60 * 60_000;

export const INITIAL_DIFFICULTY = 0.3;

/** 答錯時難度往上跳多少，答對時往下走多少。上下不對稱：錯一次的資訊比對一次多。 */
export const DIFFICULTY_UP = 0.15;
export const DIFFICULTY_DOWN = 0.05;

export interface Scheduled {
  readonly stability: number;
  readonly difficulty: number;
  readonly dueAt: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * 算出下一次該問的時間。
 *
 * `previous` 是上一次的排程，第一次作答時傳 null。
 * 時間由參數注入——這個檔案跟 core 一樣要能在伺服器上算出同樣結果。
 */
export function schedule(previous: Scheduled | null, correct: boolean, at: number): Scheduled {
  const difficulty = clamp(
    (previous?.difficulty ?? INITIAL_DIFFICULTY) + (correct ? -DIFFICULTY_DOWN : DIFFICULTY_UP),
    0,
    1,
  );

  // 難的字成長慢，簡單的字很快就不用再問——difficulty 要真的影響排程，
  // 否則它只是一個記在旁邊沒人看的數字。
  const growth = MAX_GROWTH - (MAX_GROWTH - MIN_GROWTH) * difficulty;

  const stability = correct
    ? clamp((previous?.stability ?? FIRST_INTERVAL_MS / growth) * growth, FIRST_INTERVAL_MS, MAX_INTERVAL_MS)
    : clamp((previous?.stability ?? FIRST_INTERVAL_MS) * LAPSE_PENALTY, LAPSE_INTERVAL_MS, MAX_INTERVAL_MS);

  return {
    stability,
    difficulty,
    // 答錯的字不管穩定度多高都要很快回來——那是複習池存在的理由。
    dueAt: at + (correct ? stability : LAPSE_INTERVAL_MS),
  };
}

export function isDue(dueAt: number | null, now: number): boolean {
  return dueAt !== null && dueAt <= now;
}

/** 過期多久。沒排程或還沒到期是 0。給排序用：越晚到期的排越後面。 */
export function overdueBy(dueAt: number | null, now: number): number {
  return dueAt === null ? 0 : Math.max(0, now - dueAt);
}
