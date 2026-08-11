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

  it('SRS 欄位保持 null，等 v0.2 填', () => {
    const book = recordAttempt(EMPTY_REVIEW_BOOK, attempt('v001', true, 100));
    expect(book.v001.stability).toBeNull();
    expect(book.v001.difficulty).toBeNull();
    expect(book.v001.dueAt).toBeNull();
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
