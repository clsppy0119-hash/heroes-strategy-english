import { describe, expect, it } from 'vitest';

import { resolveRound, startBattle, type RoundQuestion } from './battle';
import { MAX_LEVEL, MORALE_FLOOR, MORALE_FULL, requiredCorrect, roundsFor } from './config';
import { defenderHpFor } from './derive';

const questions: RoundQuestion[] = Array.from({ length: 8 }, (_, i) => ({
  id: `q${i}`,
  answerIndex: 1,
  choiceCount: 4,
}));

/** 把布林序列轉成 resolveRound 吃的作答：true＝答對，false＝跳過。 */
function runAll(level: number, answers: readonly boolean[], morale = MORALE_FULL): boolean {
  let battle = startBattle({ battleId: 'b', tileId: 'x', tileLevel: level, seed: 1, questions, morale });
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

/**
 * 士氣改變的是「要答對幾題」，不是「能不能贏」。
 *
 * 這一組釘住那條界線：士氣低的時候規則會變嚴，但永遠留一條全對就贏的路。
 * 沒有下面這兩條，士氣就會變成 v0.1 踩過的那個坑——數學上贏不了的仗（#14）。
 */
describe('士氣與通關規則的界線', () => {
  it('最低士氣下，全部答對每一級都拿得下', () => {
    for (let level = 1; level <= MAX_LEVEL; level += 1) {
      const allCorrect = Array.from({ length: roundsFor(level) }, () => true);
      expect(runAll(level, allCorrect, MORALE_FLOOR), `LV.${level}`).toBe(true);
    }
  });

  /** LV.1 是入門坡：跳過也拿得下，這條不能因為遠征而消失。 */
  it('LV.1 跳過也拿得下——士氣再低也一樣', () => {
    for (const morale of [MORALE_FULL, MORALE_FLOOR]) {
      expect(runAll(1, [false], morale), `morale ${morale}`).toBe(true);
    }
  });

  it('士氣低的時候，剛好達標的作答序列可能就不夠了', () => {
    // LV.3 需要答對兩題。滿士氣時「對、對、錯」拿得下。
    expect(runAll(3, [true, true, false], MORALE_FULL)).toBe(true);
    // 最低士氣時同樣的表現就不夠——那正是士氣要做到的事。
    expect(runAll(3, [true, true, false], MORALE_FLOOR)).toBe(false);
  });
});
