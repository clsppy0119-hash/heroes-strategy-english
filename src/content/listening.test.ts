import { describe, expect, it } from 'vitest';

import { LISTEN_AFTER_SEEN, modeFor, resolveMode } from './listening';
import { EMPTY_REVIEW_BOOK, recordAttempt, type ReviewBook } from './review';
import { createStaticProvider, type VocabEntry } from './static-provider';
import { seedFrom } from '@/core';

const T0 = 1_700_000_000_000;

const bank: VocabEntry[] = Array.from({ length: 8 }, (_, i) => ({
  id: `v${i}`,
  en: `word${i}`,
  zh: `字${i}`,
  level: 1,
  source: 'test',
}));

const answer = (book: ReviewBook, itemId: string, correct: boolean) =>
  recordAttempt(book, { itemId, correct, elapsedMs: 900, at: T0, context: 'b1' });

/** 一句話講得完的規則：第一次看字，之後聽音。 */
describe('第一次看字，之後聽音', () => {
  it('沒背過的字出文字題', () => {
    expect(modeFor(undefined)).toBe('read');
  });

  it('看過一次之後就改成聽力題', () => {
    const book = answer(EMPTY_REVIEW_BOOK, 'v0', true);
    expect(modeFor(book.v0)).toBe('listen');
  });

  it('答錯也算看過——重點是他見過這個字的樣子', () => {
    const book = answer(EMPTY_REVIEW_BOOK, 'v0', false);
    expect(modeFor(book.v0)).toBe('listen');
  });

  it('門檻就是設定的次數，不多不少', () => {
    let book = EMPTY_REVIEW_BOOK;
    for (let seen = 1; seen <= LISTEN_AFTER_SEEN + 2; seen += 1) {
      book = answer(book, 'v0', true);
      expect(modeFor(book.v0)).toBe(seen >= LISTEN_AFTER_SEEN ? 'listen' : 'read');
    }
  });
});

/**
 * 沒有 speechSynthesis 的環境裡，聽力題等於一題沒有題目的選擇題。
 * 與其讓玩家亂猜，不如給他字看——這是必須的，不是體貼。
 */
describe('放不出聲音就降級成文字題', () => {
  it('不能發音時聽力題變文字題', () => {
    expect(resolveMode('listen', false)).toBe('read');
  });

  it('能發音時維持聽力題', () => {
    expect(resolveMode('listen', true)).toBe('listen');
  });

  it('文字題不會因為能發音就變成聽力題', () => {
    expect(resolveMode('read', true)).toBe('read');
    expect(resolveMode('read', false)).toBe('read');
  });
});

describe('出題時就帶著題型', () => {
  const provider = createStaticProvider(bank);
  const seed = seedFrom('listen');

  it('沒有複習簿時一律文字題——不知道玩家看過沒有就別刁難他', () => {
    const questions = provider.getQuestions({ count: 4, seed });
    expect(questions.every((question) => question.mode === 'read')).toBe(true);
  });

  it('背過的字出聽力題，沒背過的出文字題', () => {
    let book = EMPTY_REVIEW_BOOK;
    for (const entry of bank.slice(0, 4)) {
      book = answer(book, entry.id, true);
    }
    const questions = provider.getQuestions({
      count: bank.length,
      seed,
      review: { book, now: T0 },
    });

    for (const question of questions) {
      expect(question.mode).toBe(book[question.id] === undefined ? 'read' : 'listen');
    }
  });

  it('題型不影響答案——聽力題一樣有正確選項', () => {
    const book = answer(EMPTY_REVIEW_BOOK, 'v0', true);
    const questions = provider.getQuestions({ count: 4, seed, review: { book, now: T0 } });
    for (const question of questions) {
      expect(question.answerIndex).toBeGreaterThanOrEqual(0);
      expect(question.choices[question.answerIndex]).toBeDefined();
    }
  });
});
