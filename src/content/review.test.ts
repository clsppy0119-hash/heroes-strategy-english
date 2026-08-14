import { describe, expect, it } from 'vitest';

import { EMPTY_REVIEW_BOOK, recordAttempt, weakItems } from './review';

const attempt = (itemId: string, correct: boolean, at: number) => ({
  itemId,
  correct,
  elapsedMs: 1200,
  at,
  context: 'battle-1',
});

describe('recordAttempt', () => {
  it('第一次作答就建立記錄', () => {
    const book = recordAttempt(EMPTY_REVIEW_BOOK, attempt('v001', true, 100));
    expect(book.v001.seen).toBe(1);
    expect(book.v001.lapses).toBe(0);
    expect(book.v001.lastSeenAt).toBe(100);
  });

  it('答錯累加 lapses，答對不加', () => {
    let book = recordAttempt(EMPTY_REVIEW_BOOK, attempt('v001', false, 100));
    book = recordAttempt(book, attempt('v001', false, 200));
    book = recordAttempt(book, attempt('v001', true, 300));
    expect(book.v001.seen).toBe(3);
    expect(book.v001.lapses).toBe(2);
    expect(book.v001.lastSeenAt).toBe(300);
  });

  /** v0.1 這裡驗的是「三個欄位保持 null」。v0.2 把它們填起來了。 */
  it('作答之後 SRS 欄位就有值了', () => {
    const book = recordAttempt(EMPTY_REVIEW_BOOK, attempt('v001', true, 100));
    expect(book.v001.stability).toBeGreaterThan(0);
    expect(book.v001.difficulty).toBeGreaterThanOrEqual(0);
    expect(book.v001.dueAt).toBeGreaterThan(100);
  });

  it('答錯的字排得比答對的早', () => {
    const wrong = recordAttempt(EMPTY_REVIEW_BOOK, attempt('v001', false, 100));
    const right = recordAttempt(EMPTY_REVIEW_BOOK, attempt('v002', true, 100));
    expect(wrong.v001.dueAt!).toBeLessThan(right.v002.dueAt!);
  });

  it('不改動輸入', () => {
    const book = recordAttempt(EMPTY_REVIEW_BOOK, attempt('v001', true, 100));
    recordAttempt(book, attempt('v001', false, 200));
    expect(book.v001.lapses).toBe(0);
  });
});

describe('weakItems', () => {
  it('只回傳答錯過的，錯最多次的排前面', () => {
    let book = recordAttempt(EMPTY_REVIEW_BOOK, attempt('v001', true, 100));
    book = recordAttempt(book, attempt('v002', false, 110));
    book = recordAttempt(book, attempt('v003', false, 120));
    book = recordAttempt(book, attempt('v003', false, 130));

    expect(weakItems(book).map((state) => state.itemId)).toEqual(['v003', 'v002']);
  });

  it('沒有錯題時回傳空陣列', () => {
    const book = recordAttempt(EMPTY_REVIEW_BOOK, attempt('v001', true, 100));
    expect(weakItems(book)).toEqual([]);
  });
});
