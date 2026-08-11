import { BASE_DAMAGE_RATE, CRIT_BASE, CRIT_MAX, CRIT_STEP, MAX_ROUNDS, START_TROOPS } from './config';
import { counterFor, defenderHpFor, type TileId } from './map';
import { RULES_VERSION, type RulesVersion } from './rules';
import type { RngState } from './rng';

/**
 * 一場戰鬥。
 *
 * 核心設計：**作答就是這一回合的下令**。
 *
 * 答對是暴擊，不答或答錯是普通命中——不是懲罰。基準傷害由兵力決定，
 * 作答只往上加。所以跳過仍然打得動（見 config.ts 的第一條），
 * 但暴擊倍率大到面對等級相稱的對手，一路跳過就是一路輸（第二條）。
 *
 * 反擊每回合固定，跟作答無關。這點很重要：如果答錯會被打得更慘，
 * 那作答就變成有罰則的門票，而不是可選的加成。
 *
 * ## 連對為什麼是退一階而不是歸零（#14）
 *
 * 第一版是答錯就歸零。實測發現那是一個隱形門票：LV.3 要連對五次才打得穿，
 * 所以第二回合錯一題，剩下四回合就數學上不可能贏——但遊戲不說，還要玩家
 * 繼續答四題死題。跳題率就是在那裡飆起來的（第 1 回合 25% → 第 6 回合 57%）。
 *
 * 退一階讓一次失誤付一次的代價。連對仍然是核心，但一題答錯不再等於整場報銷。
 */

/** core 只需要知道哪個選項是對的；題目文字是呈現層的事。 */
export interface RoundQuestion {
  readonly id: string;
  readonly answerIndex: number;
  readonly choiceCount: number;
}

export interface RoundResult {
  readonly round: number;
  readonly questionId: string;
  /** null 代表玩家跳過。 */
  readonly choiceIndex: number | null;
  readonly correct: boolean;
  readonly multiplier: number;
  readonly damage: number;
  readonly streakAfter: number;
  readonly defenderHpAfter: number;
  readonly troopsAfter: number;
}

export type BattleOutcome = 'ongoing' | 'won' | 'lost';

/** 為什麼輸的。UI 用它給玩家一個誠實的說法，而不是讓他自己猜。 */
export type LossReason = 'out-of-rounds' | 'out-of-troops' | 'hopeless' | 'retreated';

export interface BattleState {
  readonly battleId: string;
  readonly tileId: TileId;
  readonly tileLevel: number;
  readonly seed: RngState;
  readonly rulesVersion: RulesVersion;
  readonly round: number;
  readonly troops: number;
  readonly defenderHp: number;
  readonly streak: number;
  readonly maxStreak: number;
  readonly correctCount: number;
  readonly outcome: BattleOutcome;
  readonly lossReason: LossReason | null;
  readonly questions: readonly RoundQuestion[];
  readonly log: readonly RoundResult[];
}

export interface StartBattleInput {
  readonly battleId: string;
  readonly tileId: TileId;
  readonly tileLevel: number;
  readonly seed: RngState;
  /** 這場戰鬥可能用到的題目，最多 MAX_ROUNDS 題，由呼叫端先抽好。 */
  readonly questions: readonly RoundQuestion[];
}

export function startBattle(input: StartBattleInput): BattleState {
  if (input.questions.length < MAX_ROUNDS) {
    throw new RangeError(`need ${MAX_ROUNDS} questions, got ${input.questions.length}`);
  }
  return {
    battleId: input.battleId,
    tileId: input.tileId,
    tileLevel: input.tileLevel,
    seed: input.seed,
    rulesVersion: RULES_VERSION,
    round: 0,
    troops: START_TROOPS,
    defenderHp: defenderHpFor(input.tileLevel),
    streak: 0,
    maxStreak: 0,
    correctCount: 0,
    outcome: 'ongoing',
    lossReason: null,
    questions: input.questions.slice(0, MAX_ROUNDS),
    log: [],
  };
}

/**
 * 剩下的回合全部暴擊、連對一路往上疊，最多還能打出多少傷害。
 *
 * 用來判斷這場仗是不是已經沒救了。與其讓玩家再答四題死題，不如直接收攤——
 * 死時間正是跳題發生的地方（#14）。
 */
export function maxRemainingDamage(battle: BattleState): number {
  let troops = battle.troops;
  let streak = battle.streak;
  let total = 0;
  for (let round = battle.round; round < MAX_ROUNDS && troops > 0; round += 1) {
    streak += 1;
    total += Math.floor(troops * BASE_DAMAGE_RATE * multiplierFor(streak));
    troops -= counterFor(battle.tileLevel);
  }
  return total;
}

/** 這一回合要出的題。戰鬥結束後回傳 undefined。 */
export function currentQuestion(battle: BattleState): RoundQuestion | undefined {
  return battle.outcome === 'ongoing' ? battle.questions[battle.round] : undefined;
}

export function multiplierFor(streak: number): number {
  if (streak <= 0) {
    return 1;
  }
  return Math.min(CRIT_BASE + (streak - 1) * CRIT_STEP, CRIT_MAX);
}

/**
 * 這一回合答對／沒答對分別會打出多少傷害。
 *
 * 給介面在玩家「還沒選」的時候就把兩個數字擺出來。#7 的可玩定義有兩句，
 * 第二句是「說得出答題跟打贏之間的關係」——把因果寫在事後的戰報裡太晚了，
 * 沒看過說明的人整場都可能沒把兩件事連起來。
 */
export function previewDamage(battle: BattleState, correct: boolean): number {
  const streak = correct ? battle.streak + 1 : Math.max(0, battle.streak - 1);
  return Math.floor(battle.troops * BASE_DAMAGE_RATE * multiplierFor(streak));
}

/** 這一回合答對的話會是幾倍。 */
export function previewMultiplier(battle: BattleState): number {
  return multiplierFor(battle.streak + 1);
}

/**
 * 結算一回合。`choiceIndex` 傳 null 代表跳過。
 *
 * 純函式：同樣的 battle 加同樣的作答，永遠得到同樣的結果。
 */
export function resolveRound(battle: BattleState, choiceIndex: number | null): BattleState {
  if (battle.outcome !== 'ongoing') {
    return battle;
  }

  const question = battle.questions[battle.round];
  if (question === undefined) {
    throw new RangeError(`no question for round ${battle.round}`);
  }
  if (choiceIndex !== null && (choiceIndex < 0 || choiceIndex >= question.choiceCount)) {
    throw new RangeError(`choiceIndex ${choiceIndex} out of range for question ${question.id}`);
  }

  const correct = choiceIndex !== null && choiceIndex === question.answerIndex;
  // 退一階而不是歸零：一次失誤付一次的代價（#14）。
  const streak = correct ? battle.streak + 1 : Math.max(0, battle.streak - 1);
  const multiplier = multiplierFor(streak);
  const damage = Math.floor(battle.troops * BASE_DAMAGE_RATE * multiplier);

  const defenderHp = battle.defenderHp - damage;
  const round = battle.round + 1;

  // 打贏就不吃這回合的反擊——守軍已經沒了。
  const won = defenderHp <= 0;
  const troops = won ? battle.troops : battle.troops - counterFor(battle.tileLevel);

  const result: RoundResult = {
    round: battle.round,
    questionId: question.id,
    choiceIndex,
    correct,
    multiplier,
    damage,
    streakAfter: streak,
    defenderHpAfter: Math.max(0, defenderHp),
    troopsAfter: Math.max(0, troops),
  };

  const next: BattleState = {
    ...battle,
    round,
    troops: Math.max(0, troops),
    defenderHp: Math.max(0, defenderHp),
    streak,
    maxStreak: Math.max(battle.maxStreak, streak),
    correctCount: battle.correctCount + (correct ? 1 : 0),
    outcome: 'ongoing',
    lossReason: null,
    log: [...battle.log, result],
  };

  if (won) {
    return { ...next, outcome: 'won' };
  }
  if (troops <= 0) {
    return { ...next, outcome: 'lost', lossReason: 'out-of-troops' };
  }
  if (round >= MAX_ROUNDS) {
    return { ...next, outcome: 'lost', lossReason: 'out-of-rounds' };
  }
  // 剩下的回合就算全部暴擊也打不穿，就別再出題了。
  if (maxRemainingDamage(next) < next.defenderHp) {
    return { ...next, outcome: 'lost', lossReason: 'hopeless' };
  }
  return next;
}

/** 玩家中途離開。#7 要靠這個算單場放棄率。 */
export function abandonBattle(battle: BattleState): BattleState {
  return battle.outcome === 'ongoing' ? { ...battle, outcome: 'lost', lossReason: 'retreated' } : battle;
}
