/**
 * 決定性亂數。
 *
 * 刻意寫成「狀態進、狀態出」而不是回傳一個有內部狀態的函式：
 * RngState 是一個 number，可以直接序列化存進資料庫，
 * v0.2 把戰鬥搬到伺服器時，同一份實作在兩邊跑出同樣的結果。
 *
 * core 模組禁止使用 Math.random，由 CI 檢查（scripts/check-core-purity.mjs）。
 */

export type RngState = number;

/** 由任意字串產生種子（例如 battleId），避免呼叫端自己想辦法湊 number。 */
export function seedFrom(text: string): RngState {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32：回傳 [0,1) 的浮點數與下一個狀態。 */
export function nextFloat(state: RngState): readonly [value: number, next: RngState] {
  let t = (state + 0x6d2b79f5) >>> 0;
  const nextState = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, nextState] as const;
}

/** 回傳 [0, maxExclusive) 的整數。 */
export function nextInt(state: RngState, maxExclusive: number): readonly [value: number, next: RngState] {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError(`maxExclusive must be a positive integer, got ${maxExclusive}`);
  }
  const [value, next] = nextFloat(state);
  return [Math.floor(value * maxExclusive), next] as const;
}

/** Fisher-Yates。不改動輸入陣列。 */
export function shuffle<T>(items: readonly T[], state: RngState): readonly [shuffled: T[], next: RngState] {
  const out = [...items];
  let s = state;
  for (let i = out.length - 1; i > 0; i -= 1) {
    const [j, next] = nextInt(s, i + 1);
    s = next;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s] as const;
}
