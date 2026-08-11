/**
 * 錯題記錄。
 *
 * v0.1 只做「記下來」，不做排程——間隔複習演算法是 v0.2 的事。
 * 但欄位形狀現在就對齊 docs/DATA_MODEL.md 的 `attempts` 與 `review_states`，
 * 這樣 v0.2 接 SRS 時是把 null 填起來，而不是把資料結構重做一遍。
 */

export interface Attempt {
  readonly itemId: string;
  readonly correct: boolean;
  readonly elapsedMs: number;
  readonly at: number;
  /** 在哪裡作答的。v0.1 只會是 battleId。 */
  readonly context: string;
}

export interface ReviewState {
  readonly itemId: string;
  readonly seen: number;
  /** 答錯次數。SRS 的 lapses。 */
  readonly lapses: number;
  readonly lastSeenAt: number;
  /** 以下三個 v0.2 接 SRS 時才填。 */
  readonly stability: number | null;
  readonly difficulty: number | null;
  readonly dueAt: number | null;
}

export type ReviewBook = Readonly<Record<string, ReviewState>>;

export const EMPTY_REVIEW_BOOK: ReviewBook = {};

/** 純函式：吃舊的複習簿與一次作答，回傳新的複習簿。 */
export function recordAttempt(book: ReviewBook, attempt: Attempt): ReviewBook {
  const previous = book[attempt.itemId];
  const next: ReviewState = {
    itemId: attempt.itemId,
    seen: (previous?.seen ?? 0) + 1,
    lapses: (previous?.lapses ?? 0) + (attempt.correct ? 0 : 1),
    lastSeenAt: attempt.at,
    stability: previous?.stability ?? null,
    difficulty: previous?.difficulty ?? null,
    dueAt: previous?.dueAt ?? null,
  };
  return { ...book, [attempt.itemId]: next };
}

/** 答錯過的題目，錯最多次的排前面。v0.2 的複習池從這裡長出來。 */
export function weakItems(book: ReviewBook): readonly ReviewState[] {
  return Object.values(book)
    .filter((state) => state.lapses > 0)
    .sort((a, b) => b.lapses - a.lapses || a.lastSeenAt - b.lastSeenAt);
}
