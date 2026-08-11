import { describe, expect, it } from 'vitest';

import { VOCAB, vocabProvider } from './index';
import { CHOICE_COUNT } from './static-provider';

/** 針對真的題庫（content/vocab.v1.csv 產生的那份）跑，不是 fixture。 */

describe('vocab.v1', () => {
  it('有 20 個詞', () => {
    expect(VOCAB).toHaveLength(20);
  });

  it('每個 level 都湊得出四個選項', () => {
    const byLevel = new Map<number, number>();
    for (const entry of VOCAB) {
      byLevel.set(entry.level, (byLevel.get(entry.level) ?? 0) + 1);
    }
    for (const [level, count] of byLevel) {
      expect(count, `level ${level}`).toBeGreaterThanOrEqual(CHOICE_COUNT);
    }
  });

  it('中文不重複——重複會讓同一題出現兩個看起來一樣的選項', () => {
    expect(new Set(VOCAB.map((e) => e.zh)).size).toBe(VOCAB.length);
  });

  it('學習素材保持英文，prompt 不含中文', () => {
    const cjk = /[㐀-䶿一-鿿]/;
    for (const question of vocabProvider.getQuestions({ count: VOCAB.length, seed: 1 })) {
      expect(cjk.test(question.prompt), question.id).toBe(false);
    }
  });
});

describe('一場戰鬥的出題', () => {
  it('六回合不會出現重複題目', () => {
    const asked: string[] = [];
    let seed = 4242;
    for (let round = 0; round < 6; round += 1) {
      const [question] = vocabProvider.getQuestions({ count: 1, seed, excludeIds: asked });
      expect(question, `round ${round}`).toBeDefined();
      asked.push(question.id);
      seed += 1;
    }
    expect(new Set(asked).size).toBe(6);
  });

  it('同 seed 與同排除清單給同一題', () => {
    const first = vocabProvider.getQuestions({ count: 1, seed: 77, excludeIds: ['v001'] });
    const second = vocabProvider.getQuestions({ count: 1, seed: 77, excludeIds: ['v001'] });
    expect(first).toEqual(second);
  });

  it('限定 level 時只出該 level 的題', () => {
    for (const question of vocabProvider.getQuestions({ count: 5, seed: 9, level: 2 })) {
      expect(VOCAB.find((e) => e.id === question.id)?.level).toBe(2);
    }
  });
});
