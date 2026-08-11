import { describe, expect, it } from 'vitest';

import {
  abandonBattle,
  currentQuestion,
  multiplierFor,
  previewDamage,
  previewMultiplier,
  resolveRound,
  startBattle,
  type BattleState,
  type RoundQuestion,
} from './battle';
import { CRIT_BASE, CRIT_MAX, CRIT_STEP, MAX_ROUNDS, START_TROOPS } from './config';
import { counterFor } from './map';

const questions: RoundQuestion[] = Array.from({ length: MAX_ROUNDS }, (_, i) => ({
  id: `q${i}`,
  answerIndex: 1,
  choiceCount: 4,
}));

const battleAt = (tileLevel: number): BattleState =>
  startBattle({ battleId: 'b1', tileId: '1,0', tileLevel, seed: 42, questions });

/** answers[i] 是第 i 回合的作答：數字＝選項，null＝跳過。 */
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

const allCorrect = Array.from({ length: MAX_ROUNDS }, () => 1);
const allSkipped = Array.from({ length: MAX_ROUNDS }, () => null);
const alternating = Array.from({ length: MAX_ROUNDS }, (_, i) => (i % 2 === 0 ? 1 : 0));

/**
 * 這三個測試是設計本身，不是實作細節。
 * 任何一個掛掉都代表數值改壞了，不要調測試去遷就數值。
 */
describe('設計梯度', () => {
  it('跳過打得動：完全不作答仍能拿下 LV.1', () => {
    // 作答如果是打贏的必要條件，它就變回強制門票。
    expect(play(1, allSkipped).outcome).toBe('won');
  });

  it('跳過打得很差：完全不作答絕對拿不下 LV.2', () => {
    // 作答如果只是可有可無的小加成，理性玩法就是無視它。
    expect(play(2, allSkipped).outcome).toBe('lost');
  });

  it('全跳過也拿不下 LV.3', () => {
    expect(play(3, allSkipped).outcome).toBe('lost');
  });

  it('答對三題就拿得下 LV.3', () => {
    // 2026-08-11 lionw 指定的門檻。原本要五題，太嚴。
    expect(play(3, alternating).outcome).toBe('won');
  });

  it('只答對一題拿不下 LV.3——擋得住亂點', () => {
    expect(play(3, [1, 0, null, 0, null, 0]).outcome).toBe('lost');
  });

  it('全答對拿得下 LV.3', () => {
    expect(play(3, allCorrect).outcome).toBe('won');
  });
});

describe('答錯不受罰', () => {
  it('反擊每回合固定，跟作答無關', () => {
    const skipped = resolveRound(battleAt(2), null);
    const correct = resolveRound(battleAt(2), 1);
    // 答對那回合沒打贏，所以兩邊都吃了一次反擊，損失應該一樣。
    expect(skipped.troops).toBe(START_TROOPS - counterFor(2));
    expect(correct.troops).toBe(START_TROOPS - counterFor(2));
  });

  it('答錯跟跳過的傷害一樣——答錯是普通命中，不是懲罰', () => {
    const skipped = resolveRound(battleAt(2), null);
    const wrong = resolveRound(battleAt(2), 0);
    expect(wrong.log[0].damage).toBe(skipped.log[0].damage);
    expect(wrong.log[0].multiplier).toBe(1);
  });

  it('答對的傷害嚴格大於跳過', () => {
    const skipped = resolveRound(battleAt(2), null);
    const correct = resolveRound(battleAt(2), 1);
    expect(correct.log[0].damage).toBeGreaterThan(skipped.log[0].damage);
  });
});

/** #14 的修正：一次失誤不該等於整場報銷。 */
describe('連對退一階而不是歸零', () => {
  it('答錯只退一階', () => {
    let battle = battleAt(3);
    battle = resolveRound(battle, 1);
    battle = resolveRound(battle, 1);
    expect(battle.streak).toBe(2);
    battle = resolveRound(battle, 0);
    expect(battle.streak).toBe(1);
  });

  it('連對 0 時答錯不會變成負數', () => {
    expect(resolveRound(battleAt(3), 0).streak).toBe(0);
  });

  it('LV.3 中途錯一題仍有機會翻盤', () => {
    // 對、對、錯、對、對、對——第一版這樣會因為歸零而輸掉。
    expect(play(3, [1, 1, 0, 1, 1, 1]).outcome).toBe('won');
  });
});

describe('打不贏就早點收攤', () => {
  it('剩餘回合全暴擊也打不穿時直接結束，不再出題', () => {
    // LV.3 全跳過：連對永遠是 0，撐不到六回合就該判定沒救。
    const battle = play(3, allSkipped);
    expect(battle.outcome).toBe('lost');
    expect(battle.lossReason).toBe('hopeless');
    expect(battle.log.length).toBeLessThan(MAX_ROUNDS);
  });

  it('還有機會時不會提早結束', () => {
    const battle = resolveRound(battleAt(3), 1);
    expect(battle.outcome).toBe('ongoing');
  });

  it('撐到第六回合才差一點的標成 out-of-rounds', () => {
    // 一直差那麼一點：全程還有理論上的翻盤空間，所以不會被提早判定沒救。
    const battle = play(2, [0, 0, 0, 0, 1, 0]);
    expect(battle.lossReason).toBe('out-of-rounds');
    expect(battle.log).toHaveLength(MAX_ROUNDS);
  });

  it('撤退標成 retreated', () => {
    expect(abandonBattle(battleAt(1)).lossReason).toBe('retreated');
  });

  it('贏了就沒有 lossReason', () => {
    expect(play(1, allSkipped).lossReason).toBeNull();
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

  it('maxStreak 記得住最高點', () => {
    let battle = battleAt(3);
    battle = resolveRound(battle, 1);
    battle = resolveRound(battle, 1);
    battle = resolveRound(battle, 0);
    expect(battle.maxStreak).toBe(2);
    expect(battle.streak).toBe(1);
  });
});

describe('回合結算', () => {
  it('打贏那回合不吃反擊', () => {
    const battle = play(1, allSkipped);
    expect(battle.outcome).toBe('won');
    const lastRound = battle.log[battle.log.length - 1];
    const previous = battle.log[battle.log.length - 2];
    expect(lastRound.troopsAfter).toBe(previous.troopsAfter);
  });

  it('LV.3 全跳過會提早判定沒救，不會硬撐滿六回合', () => {
    const battle = play(3, allSkipped);
    expect(battle.outcome).toBe('lost');
    expect(battle.lossReason).toBe('hopeless');
    expect(battle.log.length).toBeLessThan(MAX_ROUNDS);
  });

  it('戰鬥結束後再結算不會改變狀態', () => {
    const battle = play(1, allSkipped);
    expect(resolveRound(battle, 1)).toBe(battle);
  });

  it('選項超出範圍會丟錯', () => {
    expect(() => resolveRound(battleAt(1), 9)).toThrow(RangeError);
    expect(() => resolveRound(battleAt(1), -1)).toThrow(RangeError);
  });

  it('題目不夠六題就不給開打', () => {
    expect(() =>
      startBattle({ battleId: 'b', tileId: '0,0', tileLevel: 1, seed: 1, questions: questions.slice(0, 3) }),
    ).toThrow(RangeError);
  });
});

/** 預覽如果跟實際打出來的不一樣，比不給預覽更糟——那是在騙玩家。 */
describe('傷害預覽跟實際結果一致', () => {
  it('答對的預覽等於答對後的實際傷害', () => {
    for (const lv of [1, 2, 3]) {
      let battle = battleAt(lv);
      for (let r = 0; r < 3 && battle.outcome === 'ongoing'; r += 1) {
        const predicted = previewDamage(battle, true);
        const next = resolveRound(battle, 1);
        expect(next.log[next.log.length - 1].damage, `LV.${lv} 第 ${r + 1} 回合`).toBe(predicted);
        battle = next;
      }
    }
  });

  it('沒答對的預覽等於跳過與答錯的實際傷害', () => {
    let battle = battleAt(3);
    battle = resolveRound(battle, 1);
    const predicted = previewDamage(battle, false);
    expect(resolveRound(battle, null).log.at(-1)?.damage).toBe(predicted);
    expect(resolveRound(battle, 0).log.at(-1)?.damage).toBe(predicted);
  });

  it('答對的預覽永遠嚴格大於沒答對的', () => {
    let battle = battleAt(3);
    for (let r = 0; r < 3 && battle.outcome === 'ongoing'; r += 1) {
      expect(previewDamage(battle, true)).toBeGreaterThan(previewDamage(battle, false));
      battle = resolveRound(battle, 1);
    }
  });

  it('預覽的倍率就是答對後會拿到的倍率', () => {
    const battle = resolveRound(battleAt(3), 1);
    const predicted = previewMultiplier(battle);
    expect(resolveRound(battle, 1).log.at(-1)?.multiplier).toBe(predicted);
  });
});

describe('可重播', () => {
  it('同樣的作答序列給同樣的結果', () => {
    const answers = [1, 0, 1, 1, null, 1];
    expect(play(3, answers)).toEqual(play(3, answers));
  });

  it('戰報記下每一回合，重播得出來', () => {
    const battle = play(2, [1, 1, 1, 1, 1, 1]);
    expect(battle.log.map((r) => r.choiceIndex)).toEqual(battle.log.map(() => 1));
    expect(battle.rulesVersion).toBeDefined();
    expect(battle.seed).toBe(42);
  });
});

describe('currentQuestion', () => {
  it('進行中回傳這回合的題', () => {
    expect(currentQuestion(battleAt(1))?.id).toBe('q0');
    expect(currentQuestion(resolveRound(battleAt(1), null))?.id).toBe('q1');
  });

  it('結束後回傳 undefined', () => {
    expect(currentQuestion(play(1, allSkipped))).toBeUndefined();
  });
});

describe('abandonBattle', () => {
  it('進行中的戰鬥算成敗仗', () => {
    expect(abandonBattle(battleAt(1)).outcome).toBe('lost');
  });

  it('已結束的不動', () => {
    const won = play(1, allSkipped);
    expect(abandonBattle(won)).toBe(won);
  });
});
