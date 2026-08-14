import { describe, expect, it } from 'vitest';

import { seedFrom } from '@/core';

import { EMPTY_REVIEW_BOOK, recordAttempt, type ReviewBook } from './review';
import { orderCandidates } from './select';
import { LAPSE_INTERVAL_MS } from './srs';
import type { VocabEntry } from './static-provider';

const T0 = 1_700_000_000_000;
const SEED = seedFrom('select');

const bank: VocabEntry[] = Array.from({ length: 12 }, (_, i) => ({
  id: `v${String(i).padStart(3, '0')}`,
  en: `word${i}`,
  zh: `字${i}`,
  level: 1,
  source: 'test',
}));

const answer = (book: ReviewBook, itemId: string, correct: boolean, at: number) =>
  recordAttempt(book, { itemId, correct, elapsedMs: 900, at, context: 'b1' });

const ids = (entries: readonly VocabEntry[]) => entries.map((entry) => entry.id);

describe('沒有複習簿時就是純隨機', () => {
  it('全部都在，只是順序被洗過', () => {
    const ordered = orderCandidates(bank, { count: 3, seed: SEED });
    expect(ordered).toHaveLength(bank.length);
    expect([...ids(ordered)].sort()).toEqual([...ids(bank)].sort());
  });

  it('同樣的種子給同樣的順序', () => {
    expect(ids(orderCandidates(bank, { count: 3, seed: SEED }))).toEqual(
      ids(orderCandidates(bank, { count: 3, seed: SEED })),
    );
  });
});

/** #28 的驗收條件：錯過的字會比沒錯過的更早重現。 */
describe('到期的字排最前面', () => {
  it('答錯的字在一分鐘後排到最前面', () => {
    const book = answer(EMPTY_REVIEW_BOOK, 'v007', false, T0);
    const later = T0 + LAPSE_INTERVAL_MS;

    const ordered = orderCandidates(bank, { count: 3, seed: SEED, book, now: later });
    expect(ordered[0].id).toBe('v007');
  });

  it('還沒到期就不會被拉到前面', () => {
    const book = answer(EMPTY_REVIEW_BOOK, 'v007', false, T0);
    // 才過一秒，還沒到期。
    const ordered = orderCandidates(bank, { count: 3, seed: SEED, book, now: T0 + 1_000 });
    expect(ordered[0].id).not.toBe('v007');
  });

  it('過期最久的排在過期比較短的前面', () => {
    let book = answer(EMPTY_REVIEW_BOOK, 'v001', false, T0);
    book = answer(book, 'v002', false, T0 + 30_000);
    const later = T0 + LAPSE_INTERVAL_MS + 60_000;

    const ordered = orderCandidates(bank, { count: 4, seed: SEED, book, now: later });
    expect(ids(ordered).slice(0, 2)).toEqual(['v001', 'v002']);
  });

  it('答對的字排到後面，答錯的排前面', () => {
    let book = answer(EMPTY_REVIEW_BOOK, 'v003', true, T0);
    book = answer(book, 'v004', false, T0);
    const later = T0 + LAPSE_INTERVAL_MS;

    const ordered = ids(orderCandidates(bank, { count: 5, seed: SEED, book, now: later }));
    expect(ordered.indexOf('v004')).toBeLessThan(ordered.indexOf('v003'));
  });
});

/**
 * 「只出到期的」會在題庫小的時候抽不到東西，戰鬥直接開不起來。
 * 後面兩層是保底，不是備案。
 */
describe('沒有到期的字時照樣出得了題', () => {
  it('每個字都排到很久以後，還是抽得到題目', () => {
    let book: ReviewBook = EMPTY_REVIEW_BOOK;
    for (const entry of bank) {
      for (let i = 0; i < 8; i += 1) {
        book = answer(book, entry.id, true, T0);
      }
    }
    const ordered = orderCandidates(bank, { count: 3, seed: SEED, book, now: T0 + 1_000 });
    expect(ordered.length).toBeGreaterThanOrEqual(3);
  });

  it('沒出過的字排在已經背熟的字前面', () => {
    const book = answer(EMPTY_REVIEW_BOOK, 'v005', true, T0);
    const ordered = ids(orderCandidates(bank, { count: 12, seed: SEED, book, now: T0 + 1_000 }));
    // v005 剛答對、還沒到期，應該墊底。
    expect(ordered[ordered.length - 1]).toBe('v005');
  });

  it('都沒到期的話，最久沒看到的排前面', () => {
    let book = answer(EMPTY_REVIEW_BOOK, 'v001', true, T0);
    book = answer(book, 'v002', true, T0 + 10_000);
    const rest = bank.filter((entry) => entry.id !== 'v001' && entry.id !== 'v002');

    const ordered = ids(orderCandidates(rest.concat(bank[1], bank[2]), {
      count: 12,
      seed: SEED,
      book,
      now: T0 + 20_000,
    }));
    expect(ordered.indexOf('v001')).toBeLessThan(ordered.indexOf('v002'));
  });
});

describe('過濾', () => {
  it('排除掉的字不會出現', () => {
    const ordered = orderCandidates(bank, { count: 5, seed: SEED, excludeIds: ['v000', 'v001'] });
    expect(ids(ordered)).not.toContain('v000');
    expect(ids(ordered)).not.toContain('v001');
  });

  it('只出指定難度的字', () => {
    const mixed = [...bank, { id: 'x1', en: 'hard', zh: '難', level: 2, source: 'test' }];
    const ordered = orderCandidates(mixed, { count: 5, seed: SEED, level: 2 });
    expect(ids(ordered)).toEqual(['x1']);
  });
});
