import { describe, expect, it, vi } from 'vitest';

import { createBudgetTracker, withBudgetGuard, type ContentProvider } from './provider';
import { CHOICE_COUNT, assertBankUsable, createStaticProvider, type VocabEntry } from './static-provider';

const bank: VocabEntry[] = Array.from({ length: 12 }, (_, i) => ({
  id: `w${i}`,
  en: `word${i}`,
  zh: `字${i}`,
  level: 1,
  source: 'test-fixture',
}));

describe('static provider', () => {
  it('同 seed 給同樣的題目與選項順序', () => {
    const provider = createStaticProvider(bank);
    const first = provider.getQuestions({ count: 3, seed: 99 });
    const second = provider.getQuestions({ count: 3, seed: 99 });
    expect(first).toEqual(second);
  });

  it('每題都有四個選項且正確答案在其中', () => {
    const provider = createStaticProvider(bank);
    for (const question of provider.getQuestions({ count: 5, seed: 7 })) {
      expect(question.choices).toHaveLength(CHOICE_COUNT);
      expect(question.answerIndex).toBeGreaterThanOrEqual(0);
      const entry = bank.find((e) => e.id === question.id);
      expect(question.choices[question.answerIndex]).toBe(entry?.zh);
    }
  });

  it('選項不重複', () => {
    const provider = createStaticProvider(bank);
    for (const question of provider.getQuestions({ count: 5, seed: 21 })) {
      expect(new Set(question.choices).size).toBe(CHOICE_COUNT);
    }
  });

  it('排除掉的 id 不會再出現', () => {
    const provider = createStaticProvider(bank);
    const questions = provider.getQuestions({ count: 5, seed: 3, excludeIds: ['w0', 'w1', 'w2'] });
    expect(questions.map((q) => q.id)).not.toContain('w0');
    expect(questions.map((q) => q.id)).not.toContain('w1');
    expect(questions.map((q) => q.id)).not.toContain('w2');
  });

  it('一批之內不重複出題', () => {
    const provider = createStaticProvider(bank);
    const ids = provider.getQuestions({ count: 6, seed: 55 }).map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('assertBankUsable', () => {
  it('湊不滿四個選項就丟錯', () => {
    expect(() => assertBankUsable(bank.slice(0, 3))).toThrow();
  });

  it('夠用就不吭聲', () => {
    expect(() => assertBankUsable(bank)).not.toThrow();
  });
});

describe('budget guard', () => {
  const fallback: ContentProvider = createStaticProvider(bank);

  it('預算內走 primary', () => {
    const primary: ContentProvider = { name: 'primary', getQuestions: () => [] };
    const budget = createBudgetTracker(100);
    const guarded = withBudgetGuard({ primary, fallback, budget, costPerQuestion: 1 });
    expect(guarded.getQuestions({ count: 3, seed: 1 })).toEqual([]);
    expect(budget.spent).toBe(3);
  });

  it('超出預算就降級，且不再累加花費', () => {
    const primary: ContentProvider = { name: 'primary', getQuestions: () => [] };
    const budget = createBudgetTracker(2);
    const onFallback = vi.fn();
    const guarded = withBudgetGuard({ primary, fallback, budget, costPerQuestion: 1, onFallback });
    const questions = guarded.getQuestions({ count: 3, seed: 1 });
    expect(questions.length).toBe(3);
    expect(onFallback).toHaveBeenCalledWith('budget');
    expect(budget.spent).toBe(0);
  });

  it('primary 丟錯也降級，不把例外丟給玩家', () => {
    const primary: ContentProvider = {
      name: 'primary',
      getQuestions: () => {
        throw new Error('upstream down');
      },
    };
    const budget = createBudgetTracker(100);
    const onFallback = vi.fn();
    const guarded = withBudgetGuard({ primary, fallback, budget, costPerQuestion: 1, onFallback });
    expect(() => guarded.getQuestions({ count: 2, seed: 1 })).not.toThrow();
    expect(onFallback).toHaveBeenCalledWith('error');
  });
});
