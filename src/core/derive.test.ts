import { describe, expect, it } from 'vitest';

import { resolveRound, startBattle, type RoundQuestion } from './battle';
import { MAX_LEVEL, requiredCorrect, roundsFor } from './config';
import { defenderHpFor } from './derive';

const questions: RoundQuestion[] = Array.from({ length: 8 }, (_, i) => ({
  id: `q${i}`,
  answerIndex: 1,
  choiceCount: 4,
}));

/** 把布林序列轉成 resolveRound 吃的作答：true＝答對，false＝跳過。 */
function runAll(level: number, answers: readonly boolean[]): boolean {
  let battle = startBattle({ battleId: 'b', tileId: 'x', tileLevel: level, seed: 1, questions });
  for (const correct of answers) {
    if (battle.outcome !== 'ongoing') {
      break;
    }
    battle = resolveRound(battle, correct ? 1 : null);
  }
  return battle.outcome === 'won';
}

function allSequences(rounds: number): boolean[][] {
  return Array.from({ length: 2 ** rounds }, (_, mask) =>
    Array.from({ length: rounds }, (_, i) => ((mask >> i) & 1) === 1),
  );
}

/**
 * 這是整個數值系統最重要的一個測試。
 *
 * 它不抽樣，而是把每個等級的**所有**作答序列都跑一遍，驗證
 * 「答對 requiredCorrect 題以上就贏，少一題就輸」對每一條路徑都成立。
 *
 * 守軍血量是從規則推導出來的（derive.ts），這個測試證明推導是對的。
 * 之前是我手算血量去湊門檻，改一次傷害公式就要重算，而且沒有東西保證我算對。
 */
describe('守軍血量符合通關規則', () => {
  for (let level = 1; level <= MAX_LEVEL; level += 1) {
    const rounds = roundsFor(level);
    const need = requiredCorrect(level);

    it(`LV.${level}：${rounds} 題裡答對 ${need} 題以上就拿得下，全部 ${2 ** rounds} 種作答序列都成立`, () => {
      for (const answers of allSequences(rounds)) {
        const correct = answers.filter(Boolean).length;
        const won = runAll(level, answers);
        const label = answers.map((a) => (a ? '對' : '跳')).join('');
        expect(won, `LV.${level} ${label}（答對 ${correct}）`).toBe(correct >= need);
      }
    });
  }

  it('血量隨等級遞增', () => {
    for (let level = 2; level <= MAX_LEVEL; level += 1) {
      expect(defenderHpFor(level)).toBeGreaterThan(defenderHpFor(level - 1));
    }
  });

  it('沒有設定反擊的等級會丟錯，而不是安靜地用錯的數字', () => {
    expect(() => defenderHpFor(9)).toThrow(RangeError);
  });
});
