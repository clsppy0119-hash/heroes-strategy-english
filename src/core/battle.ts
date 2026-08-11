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
    questions: input.questions.slice(0, MAX_ROUNDS),
    log: [],
  };
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
  const streak = correct ? battle.streak + 1 : 0;
  const multiplier = multiplierFor(streak);
  const damage = Math.floor(battle.troops * BASE_DAMAGE_RATE * multiplier);

  const defenderHp = battle.defenderHp - damage;
  const round = battle.round + 1;

  // 打贏就不吃這回合的反擊——守軍已經沒了。
  const won = defenderHp <= 0;
  const troops = won ? battle.troops : battle.troops - counterFor(battle.tileLevel);

  const outcome: BattleOutcome = won ? 'won' : troops <= 0 || round >= MAX_ROUNDS ? 'lost' : 'ongoing';

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

  return {
    ...battle,
    round,
    troops: Math.max(0, troops),
    defenderHp: Math.max(0, defenderHp),
    streak,
    maxStreak: Math.max(battle.maxStreak, streak),
    correctCount: battle.correctCount + (correct ? 1 : 0),
    outcome,
    log: [...battle.log, result],
  };
}

/** 玩家中途離開。#7 要靠這個算單場放棄率。 */
export function abandonBattle(battle: BattleState): BattleState {
  return battle.outcome === 'ongoing' ? { ...battle, outcome: 'lost' } : battle;
}
