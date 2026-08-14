import { overdueBy, schedule, type Scheduled } from './srs';

/**
 * 錯題記錄與複習排程。
 *
 * v0.1 只做「記下來」，不做排程。v0.2 把當時留 null 的三個欄位填起來——
 * 資料結構沒有重做一遍，這就是當初對齊 docs/DATA_MODEL.md 的回報。
 *
 * 排程演算法本身在 srs.ts，可替換（docs/LINGOQUEST_MIGRATION.md 說排程
 * 不是相容契約）。這個檔案只負責「把一次作答記進簿子」。
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
  /** 以下三個由 srs.ts 排程。只有從沒作答過的字才會是 null。 */
  readonly stability: number | null;
  readonly difficulty: number | null;
  readonly dueAt: number | null;
}

export type ReviewBook = Readonly<Record<string, ReviewState>>;

export const EMPTY_REVIEW_BOOK: ReviewBook = {};

/** 上一次的排程，沒排過就是 null。 */
function scheduledOf(state: ReviewState | undefined): Scheduled | null {
  if (state === undefined || state.stability === null || state.difficulty === null || state.dueAt === null) {
    return null;
  }
  return { stability: state.stability, difficulty: state.difficulty, dueAt: state.dueAt };
}

/** 純函式：吃舊的複習簿與一次作答，回傳新的複習簿。 */
export function recordAttempt(book: ReviewBook, attempt: Attempt): ReviewBook {
  const previous = book[attempt.itemId];
  const next: ReviewState = {
    itemId: attempt.itemId,
    seen: (previous?.seen ?? 0) + 1,
    lapses: (previous?.lapses ?? 0) + (attempt.correct ? 0 : 1),
    lastSeenAt: attempt.at,
    ...schedule(scheduledOf(previous), attempt.correct, attempt.at),
  };
  return { ...book, [attempt.itemId]: next };
}

/** 答錯過的題目，錯最多次的排前面。 */
export function weakItems(book: ReviewBook): readonly ReviewState[] {
  return Object.values(book)
    .filter((state) => state.lapses > 0)
    .sort((a, b) => b.lapses - a.lapses || a.lastSeenAt - b.lastSeenAt);
}

/**
 * 該複習的字，過期最久的排前面。
 *
 * 「過期最久」而不是「到期時間最早」：兩者在只看到期的字時等價，
 * 但前者對「還沒到期」的字回傳 0，混進來也不會排到前面去。
 */
export function dueItems(book: ReviewBook, now: number): readonly ReviewState[] {
  return Object.values(book)
    .filter((state) => state.dueAt !== null && state.dueAt <= now)
    .sort((a, b) => overdueBy(b.dueAt, now) - overdueBy(a.dueAt, now));
}
