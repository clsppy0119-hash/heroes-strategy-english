import { describe, expect, it } from 'vitest';

import {
  abandonBattle,
  currentQuestion,
  maxRemainingDamage,
  minRemainingDamage,
  previewDamage,
  previewMultiplier,
  resolveRound,
  startBattle,
  type BattleState,
  type RoundQuestion,
} from './battle';
import {
  CRIT_BASE,
  CRIT_MAX,
  CRIT_STEP,
  MORALE_FLOOR,
  MORALE_FULL,
  START_TROOPS,
  requiredCorrect,
  roundsFor,
} from './config';
import { counterFor, multiplierFor } from './derive';

const MAX_LEVEL_FOR_TEST = 3;

const questions: RoundQuestion[] = Array.from({ length: 6 }, (_, i) => ({
  id: `q${i}`,
  answerIndex: 1,
  choiceCount: 4,
}));

const battleAt = (tileLevel: number, morale = MORALE_FULL): BattleState =>
  startBattle({ battleId: 'b1', tileId: '1,0', tileLevel, seed: 42, questions, morale });

/** answers[i] 是第 i 回合的作答：1＝答對，0＝答錯，null＝跳過。 */
function play(tileLevel: number, answers: readonly (number | null)[]): BattleState {
  let battle = battleAt(tileLevel);
  for (const answer of answers) {
    if (battle.outcome !== 'ongoing') {
      break;
    }
    battle = resolveRound(battle, answer);
  }
  return battle;
}

const skips = (n: number) => Array.from({ length: n }, () => null);

/**
 * 通關規則（2026-08-12 lionw 指定）：LV.N 出 N 題，答對六成四捨五入才拿得下，
 * LV.1 特例為 0。這一組測試就是規則本身，不是實作細節——
 * 掛掉代表規則被改壞了，不要調測試去遷就數值。
 */
describe('通關規則', () => {
  it('出題數等於地格等級', () => {
    expect(roundsFor(1)).toBe(1);
    expect(roundsFor(2)).toBe(2);
    expect(roundsFor(3)).toBe(3);
  });

  it('需答對的題數是 0 / 1 / 2', () => {
    expect(requiredCorrect(1)).toBe(0);
    expect(requiredCorrect(2)).toBe(1);
    expect(requiredCorrect(3)).toBe(2);
  });

  it('以此類推：LV.4 出四題需對二，LV.5 出五題需對三', () => {
    expect([roundsFor(4), requiredCorrect(4)]).toEqual([4, 2]);
    expect([roundsFor(5), requiredCorrect(5)]).toEqual([5, 3]);
  });

  it('LV.1 完全不作答仍拿得下——那條入門坡要留著', () => {
    // 作答如果是打贏的必要條件，它就從「表達」變回「門票」。
    expect(play(1, skips(1)).outcome).toBe('won');
  });

  it('LV.2 完全不作答拿不下，答對一題拿得下', () => {
    expect(play(2, skips(2)).outcome).toBe('lost');
    expect(play(2, [1, null]).outcome).toBe('won');
    expect(play(2, [null, 1]).outcome).toBe('won');
  });

  it('LV.3 答對一題拿不下，答對兩題拿得下', () => {
    expect(play(3, skips(3)).outcome).toBe('lost');
    expect(play(3, [1, null, null]).outcome).toBe('lost');
    expect(play(3, [null, null, 1]).outcome).toBe('lost');
    expect(play(3, [1, null, 1]).outcome).toBe('won');
    expect(play(3, [null, 1, 1]).outcome).toBe('won');
    expect(play(3, [1, 1, 1]).outcome).toBe('won');
  });
});

describe('答錯不受罰', () => {
  it('反擊每回合固定，跟作答無關', () => {
    const skipped = resolveRound(battleAt(3), null);
    const correct = resolveRound(battleAt(3), 1);
    expect(skipped.troops).toBe(START_TROOPS - counterFor(3));
    expect(correct.troops).toBe(START_TROOPS - counterFor(3));
  });

  it('答錯跟跳過的傷害一樣——答錯是普通命中，不是懲罰', () => {
    const skipped = resolveRound(battleAt(3), null);
    const wrong = resolveRound(battleAt(3), 0);
    expect(wrong.log[0].damage).toBe(skipped.log[0].damage);
    expect(wrong.log[0].multiplier).toBe(1);
  });

  it('答對的傷害嚴格大於跳過', () => {
    const skipped = resolveRound(battleAt(3), null);
    const correct = resolveRound(battleAt(3), 1);
    expect(correct.log[0].damage).toBeGreaterThan(skipped.log[0].damage);
  });
});

/**
 * #14 的修正：一次失誤不該等於整場報銷。
 *
 * v0.1 的地格最多三回合，所以這條在實際戰鬥裡幾乎觀察不到——
 * 但「以此類推」允許更高等級，那時它就重要了。直接對狀態機測。
 */
describe('連對退一階而不是歸零', () => {
  const longBattle: BattleState = { ...battleAt(3), rounds: 5, streak: 2, maxStreak: 2, defenderHp: 99_999 };

  it('答錯只退一階', () => {
    expect(resolveRound(longBattle, 0).streak).toBe(1);
  });

  it('跳過也只退一階', () => {
    expect(resolveRound(longBattle, null).streak).toBe(1);
  });

  it('連對 0 時答錯不會變成負數', () => {
    expect(resolveRound({ ...longBattle, streak: 0 }, 0).streak).toBe(0);
  });

  it('maxStreak 記得住最高點', () => {
    const next = resolveRound(longBattle, 0);
    expect(next.maxStreak).toBe(2);
    expect(next.streak).toBe(1);
  });
});

/** #24：遊戲自己知道結果不會變的題目，問了只是逼玩家亂點。 */
describe('結果已定就不再出題', () => {
  it('打不贏就提早收攤', () => {
    const battle = play(3, [null, null, null]);
    expect(battle.outcome).toBe('lost');
    expect(battle.lossReason).toBe('hopeless');
    expect(battle.log.length).toBeLessThan(roundsFor(3));
  });

  it('贏定了也提早收兵——LV.2 答對第一題就不必再問第二題', () => {
    const battle = play(2, [1, 1]);
    expect(battle.outcome).toBe('won');
    expect(battle.log).toHaveLength(1);
  });

  it('LV.3 前兩題都對就不必再問第三題', () => {
    const battle = play(3, [1, 1, 1]);
    expect(battle.outcome).toBe('won');
    expect(battle.log.length).toBeLessThan(roundsFor(3));
  });

  it('還有機會時不會提早結束', () => {
    expect(resolveRound(battleAt(3), null).outcome).toBe('ongoing');
  });

  it('撤退標成 retreated', () => {
    expect(abandonBattle(battleAt(3)).lossReason).toBe('retreated');
  });

  it('贏了就沒有 lossReason', () => {
    expect(play(1, skips(1)).lossReason).toBeNull();
  });

  it('minRemainingDamage 不會大於 maxRemainingDamage', () => {
    const battle = resolveRound(battleAt(3), null);
    expect(minRemainingDamage(battle)).toBeLessThanOrEqual(maxRemainingDamage(battle));
  });
});

describe('連對倍率', () => {
  it('沒連對是 1 倍', () => {
    expect(multiplierFor(0)).toBe(1);
  });

  it('第一次答對是 CRIT_BASE，之後每次加 CRIT_STEP', () => {
    expect(multiplierFor(1)).toBe(CRIT_BASE);
    expect(multiplierFor(2)).toBeCloseTo(CRIT_BASE + CRIT_STEP);
    expect(multiplierFor(3)).toBeCloseTo(CRIT_BASE + CRIT_STEP * 2);
  });

  it('有上限，連對再長也不會一擊清場', () => {
    expect(multiplierFor(100)).toBe(CRIT_MAX);
  });
});

describe('回合結算', () => {
  it('真的把守軍打倒的那一回合不吃反擊', () => {
    const battle = play(2, [null, 1]);
    expect(battle.outcome).toBe('won');
    const last = battle.log[battle.log.length - 1];
    const previous = battle.log[battle.log.length - 2];
    expect(last.defenderHpAfter).toBe(0);
    expect(last.troopsAfter).toBe(previous.troopsAfter);
  });

  it('「贏定了」提早收兵的那一回合仍然吃反擊——那一回合是真的打過的', () => {
    // 跟上面不同：守軍還沒倒，只是剩下的回合已經不可能翻盤。
    const battle = play(3, [1, 1, 1]);
    expect(battle.outcome).toBe('won');
    const last = battle.log[battle.log.length - 1];
    const previous = battle.log[battle.log.length - 2];
    expect(last.defenderHpAfter).toBeGreaterThan(0);
    expect(last.troopsAfter).toBeLessThan(previous.troopsAfter);
  });

  it('戰鬥結束後再結算不會改變狀態', () => {
    const battle = play(1, skips(1));
    expect(resolveRound(battle, 1)).toBe(battle);
  });

  it('選項超出範圍會丟錯', () => {
    expect(() => resolveRound(battleAt(3), 9)).toThrow(RangeError);
    expect(() => resolveRound(battleAt(3), -1)).toThrow(RangeError);
  });

  it('題目不夠這個等級的回合數就不給開打', () => {
    expect(() =>
      startBattle({
        battleId: 'b',
        tileId: '0,0',
        tileLevel: 3,
        seed: 1,
        questions: questions.slice(0, 2),
        morale: MORALE_FULL,
      }),
    ).toThrow(RangeError);
  });
});

/** 預覽如果跟實際打出來的不一樣，比不給預覽更糟——那是在騙玩家。 */
describe('傷害預覽跟實際結果一致', () => {
  it('答對的預覽等於答對後的實際傷害', () => {
    for (const lv of [1, 2, 3]) {
      let battle = battleAt(lv);
      while (battle.outcome === 'ongoing') {
        const predicted = previewDamage(battle, true);
        const next = resolveRound(battle, 1);
        expect(next.log[next.log.length - 1].damage, `LV.${lv}`).toBe(predicted);
        battle = next;
      }
    }
  });

  it('沒答對的預覽等於跳過與答錯的實際傷害', () => {
    const battle = battleAt(3);
    const predicted = previewDamage(battle, false);
    expect(resolveRound(battle, null).log.at(-1)?.damage).toBe(predicted);
    expect(resolveRound(battle, 0).log.at(-1)?.damage).toBe(predicted);
  });

  it('答對的預覽永遠嚴格大於沒答對的', () => {
    let battle = battleAt(3);
    while (battle.outcome === 'ongoing') {
      expect(previewDamage(battle, true)).toBeGreaterThan(previewDamage(battle, false));
      battle = resolveRound(battle, null);
    }
  });

  it('預覽的倍率就是答對後會拿到的倍率', () => {
    const battle = battleAt(3);
    expect(resolveRound(battle, 1).log.at(-1)?.multiplier).toBe(previewMultiplier(battle));
  });
});

describe('可重播', () => {
  it('同樣的作答序列給同樣的結果', () => {
    const answers = [1, 0, 1];
    expect(play(3, answers)).toEqual(play(3, answers));
  });
});

describe('currentQuestion', () => {
  it('進行中回傳這回合的題', () => {
    expect(currentQuestion(battleAt(3))?.id).toBe('q0');
    expect(currentQuestion(resolveRound(battleAt(3), null))?.id).toBe('q1');
  });

  it('結束後回傳 undefined', () => {
    expect(currentQuestion(play(1, skips(1)))).toBeUndefined();
  });
});

/**
 * 士氣。傷害等比降低，但通關規則不能因此變成「打不贏」——
 * derive.ts 在載入時就驗過最低士氣下全對仍然打得贏。
 */
describe('士氣', () => {
  it('士氣低，同一擊打得比較少', () => {
    const full = battleAt(3, MORALE_FULL);
    const low = battleAt(3, MORALE_FLOOR);
    expect(previewDamage(low, true)).toBeLessThan(previewDamage(full, true));
  });

  it('預覽跟實際結算是同一個數字——不然畫面在騙人', () => {
    const battle = battleAt(3, MORALE_FLOOR);
    const preview = previewDamage(battle, true);
    expect(resolveRound(battle, 1).log[0].damage).toBe(preview);
  });

  it('最低士氣下全部答對還是拿得下——任何等級都不能有贏不了的仗', () => {
    for (let level = 1; level <= MAX_LEVEL_FOR_TEST; level += 1) {
      const answers = Array.from({ length: level }, () => 1);
      let battle = battleAt(level, MORALE_FLOOR);
      for (const answer of answers) {
        if (battle.outcome !== 'ongoing') {
          break;
        }
        battle = resolveRound(battle, answer);
      }
      expect(battle.outcome, `LV.${level}`).toBe('won');
    }
  });

  it('士氣壞掉就丟錯，而不是安靜地打出 0 傷害', () => {
    const bad = { battleId: 'b', tileId: 'x', tileLevel: 1, seed: 1, questions };
    expect(() => startBattle({ ...bad, morale: Number.NaN })).toThrow(RangeError);
    expect(() => startBattle({ ...bad, morale: 0 })).toThrow(RangeError);
    expect(() => startBattle({ ...bad, morale: 2 })).toThrow(RangeError);
  });
});
