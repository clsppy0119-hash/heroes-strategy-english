import { describe, expect, it } from 'vitest';

import {
  FIRST_INTERVAL_MS,
  LAPSE_INTERVAL_MS,
  MAX_INTERVAL_MS,
  isDue,
  overdueBy,
  schedule,
  type Scheduled,
} from './srs';

const T0 = 1_700_000_000_000;

/** 一路答對 n 次，回傳最後的排程。 */
function correctRun(times: number, at = T0): Scheduled {
  let state: Scheduled | null = null;
  for (let i = 0; i < times; i += 1) {
    state = schedule(state, true, at + i);
  }
  return state!;
}

describe('答對', () => {
  it('第一次答對之後，間隔是設定的第一段', () => {
    const first = schedule(null, true, T0);
    expect(first.dueAt - T0).toBe(FIRST_INTERVAL_MS);
  });

  it('每答對一次間隔就變長', () => {
    let previous = 0;
    let state: Scheduled | null = null;
    for (let i = 0; i < 6; i += 1) {
      state = schedule(state, true, T0);
      const interval = state.dueAt - T0;
      expect(interval).toBeGreaterThan(previous);
      previous = interval;
    }
  });

  it('答對讓難度往下走', () => {
    const once = schedule(null, true, T0);
    expect(schedule(once, true, T0).difficulty).toBeLessThan(once.difficulty);
  });

  /** 長期行為要像間隔複習：背熟的字最後會排到幾天以外，而不是還在幾分鐘。 */
  it('連續答對幾次之後就排到一天以外了', () => {
    expect(correctRun(8).stability).toBeGreaterThan(24 * 60 * 60_000);
  });

  it('間隔有上限，不會排到這輩子都不會再問', () => {
    expect(correctRun(60).stability).toBeLessThanOrEqual(MAX_INTERVAL_MS);
  });
});

describe('答錯', () => {
  it('答錯的字很快就回來——那是複習池存在的理由', () => {
    const wrong = schedule(correctRun(6), false, T0);
    expect(wrong.dueAt - T0).toBe(LAPSE_INTERVAL_MS);
  });

  it('答錯讓難度往上跳', () => {
    const once = schedule(null, true, T0);
    expect(schedule(once, false, T0).difficulty).toBeGreaterThan(once.difficulty);
  });

  /**
   * 答錯不歸零。歸零等於整段記憶白費，跟戰鬥裡連對只退一階是同一個判斷：
   * 懲罰要看得見，但不能把人推到「反正都毀了」。
   */
  it('答錯把穩定度打回去一截，但不是歸零', () => {
    const strong = correctRun(6);
    const after = schedule(strong, false, T0);
    expect(after.stability).toBeLessThan(strong.stability);
    expect(after.stability).toBeGreaterThan(0);
  });

  it('錯兩次比錯一次更不穩', () => {
    const once = schedule(correctRun(6), false, T0);
    expect(schedule(once, false, T0).stability).toBeLessThanOrEqual(once.stability);
  });
});

/** difficulty 要真的影響排程，否則它只是一個記在旁邊沒人看的數字。 */
describe('難度會影響排程', () => {
  /**
   * 直接拿兩個「穩定度一樣、難度不同」的字比，而不是靠一連串作答養出差異——
   * 後者會撞到穩定度的上下限，比出來的是夾擠的結果不是難度的效果。
   */
  it('穩定度相同時，難的字答對之後長得比較慢', () => {
    const same = 10 * 60_000;
    const easy: Scheduled = { stability: same, difficulty: 0.1, dueAt: T0 };
    const hard: Scheduled = { stability: same, difficulty: 0.9, dueAt: T0 };

    expect(schedule(hard, true, T0).stability).toBeLessThan(schedule(easy, true, T0).stability);
  });

  it('再難的字答對也還是會變長，不會原地踏步', () => {
    const stuck: Scheduled = { stability: 10 * 60_000, difficulty: 1, dueAt: T0 };
    expect(schedule(stuck, true, T0).stability).toBeGreaterThan(stuck.stability);
  });

  it('一直答錯就會變成難字', () => {
    let hard: Scheduled | null = null;
    for (let i = 0; i < 4; i += 1) {
      hard = schedule(hard, false, T0);
    }
    expect(hard!.difficulty).toBeGreaterThan(schedule(null, true, T0).difficulty);
  });

  it('難度夾在 0 到 1 之間', () => {
    let state: Scheduled | null = null;
    for (let i = 0; i < 40; i += 1) {
      state = schedule(state, false, T0);
    }
    expect(state!.difficulty).toBeLessThanOrEqual(1);

    for (let i = 0; i < 80; i += 1) {
      state = schedule(state, true, T0);
    }
    expect(state!.difficulty).toBeGreaterThanOrEqual(0);
  });
});

describe('到期判斷', () => {
  it('沒排程過就不算到期', () => {
    expect(isDue(null, T0)).toBe(false);
    expect(overdueBy(null, T0)).toBe(0);
  });

  it('時間到就是到期', () => {
    expect(isDue(T0, T0)).toBe(true);
    expect(isDue(T0 + 1, T0)).toBe(false);
  });

  it('過期越久數字越大，還沒到期一律 0', () => {
    expect(overdueBy(T0 - 5_000, T0)).toBe(5_000);
    expect(overdueBy(T0 + 5_000, T0)).toBe(0);
  });
});
