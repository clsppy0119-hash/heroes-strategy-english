import { describe, expect, it } from 'vitest';

import { MAX_LEVEL, MAX_ROUNDS, vocabLevelForTile } from '@/core';

import { VOCAB, vocabProvider } from './index';
import { CHOICE_COUNT } from './static-provider';

/** 針對真的題庫（content/vocab.v1.csv 產生的那份）跑，不是 fixture。 */

describe('vocab.v1', () => {
  /**
   * 不釘死題庫大小——那個數字每次換題庫都會變，釘住只會讓人習慣性改測試。
   * 要釘的是「夠不夠用」。
   */
  it('題庫大到複習池排得出順序', () => {
    expect(VOCAB.length).toBeGreaterThanOrEqual(100);
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

  /**
   * 地圖上每一種地格都要問得出題。
   *
   * v0.1 的 vocabLevelForTile 是 `tileLevel <= 1 ? 1 : 2`，題庫變成三級之後
   * level 3 的字整批躺著永遠不會出現，而且不會有任何錯誤訊息——
   * 那種漏不會炸，只會安靜地少掉三分之一的內容。
   */
  it('地圖問得到的每一級都有題目', () => {
    for (let tileLevel = 1; tileLevel <= MAX_LEVEL; tileLevel += 1) {
      const level = vocabLevelForTile(tileLevel);
      const questions = vocabProvider.getQuestions({ count: MAX_ROUNDS, seed: 1, level });
      expect(questions, `地格 LV.${tileLevel} → 題庫 level ${level}`).toHaveLength(MAX_ROUNDS);
    }
  });

  it('題庫每一級都有地格用得到——沒有孤兒等級', () => {
    const asked = new Set(
      Array.from({ length: MAX_LEVEL }, (_, i) => vocabLevelForTile(i + 1)),
    );
    for (const level of new Set(VOCAB.map((entry) => entry.level))) {
      expect(asked.has(level), `題庫 level ${level} 沒有任何地格會問到`).toBe(true);
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
