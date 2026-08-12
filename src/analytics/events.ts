import type { RulesVersion } from '@/core';

/**
 * 埋點事件 schema v0。
 *
 * 這份 schema 存在的理由：#7 要用它算出「亂猜跳題率、每題作答時間、
 * 連對長度分佈、單場放棄率、首次佔三塊地耗時」五個數字，
 * 對照 v0.1 事先寫下的喊停條件。前期沒埋的欄位事後補不回來，
 * 所以功能寫到哪，事件就埋到哪。
 *
 * 新增欄位可以直接加；改名或改語意要遞增 SCHEMA_VERSION。
 */
export const SCHEMA_VERSION = 0;

/**
 * 下令出兵。v0.2 起 battle_start 不再等於「玩家決定打這一塊」——
 * 中間隔了一段行軍時間，玩家可能就此離開。
 *
 * 兩個事件之間的落差就是 v0.2 最需要知道的數字：等待有沒有把人趕走。
 * 沒有這個事件的話，放棄的行軍在資料裡完全看不見。
 */
export interface MarchOrdered {
  readonly type: 'march_ordered';
  readonly tileId: string;
  readonly tileLevel: number;
  readonly durationMs: number;
}

/** 鳴金收兵，軍隊還沒接敵就撤回。 */
export interface MarchRecalled {
  readonly type: 'march_recalled';
  readonly tileId: string;
  /** 已經走了多久才撤回。接近 0 是點錯，接近行軍時間是等不下去。 */
  readonly elapsedMs: number;
  readonly arrived: boolean;
}

export interface BattleStart {
  readonly type: 'battle_start';
  readonly battleId: string;
  readonly tileId: string;
  readonly seed: number;
  readonly rulesVersion: RulesVersion;
  /** 從下令到接敵等了多久。行軍時間是下限，超出的部分是玩家自己晾著的。 */
  readonly waitedMs: number;
}

export interface QuestionShown {
  readonly type: 'question_shown';
  readonly battleId: string;
  readonly round: number;
  readonly questionId: string;
}

export interface QuestionAnswered {
  readonly type: 'question_answered';
  readonly battleId: string;
  readonly round: number;
  readonly questionId: string;
  readonly correct: boolean;
  /** 從題目出現到送出答案。#7 用它判定亂猜（低於閾值且答錯）。 */
  readonly elapsedMs: number;
  /** 送出這一題之後的連對數。 */
  readonly streak: number;
}

export interface QuestionSkipped {
  readonly type: 'question_skipped';
  readonly battleId: string;
  readonly round: number;
  readonly questionId: string;
  readonly elapsedMs: number;
}

export interface BattleEnd {
  readonly type: 'battle_end';
  readonly battleId: string;
  readonly won: boolean;
  readonly rounds: number;
  readonly correctCount: number;
  readonly maxStreak: number;
  /** 玩家中途離開，而不是打完。單場放棄率靠這個算。 */
  readonly abandoned: boolean;
}

export interface TileCaptured {
  readonly type: 'tile_captured';
  readonly tileId: string;
  readonly totalCaptured: number;
  /** 從本次 session 開始到佔下這一塊的時間。首次佔三塊地耗時靠這個算。 */
  readonly sinceSessionStartMs: number;
}

export interface SessionEnd {
  readonly type: 'session_end';
  readonly durationMs: number;
  readonly battlesStarted: number;
  readonly battlesFinished: number;
}

/** v0.1-1 骨架自檢用，#5 進來後即可移除。 */
export interface SelfCheckPing {
  readonly type: 'selfcheck_ping';
  readonly note: string;
}

export type AnalyticsEvent =
  | MarchOrdered
  | MarchRecalled
  | BattleStart
  | QuestionShown
  | QuestionAnswered
  | QuestionSkipped
  | BattleEnd
  | TileCaptured
  | SessionEnd
  | SelfCheckPing;

export type AnalyticsEventType = AnalyticsEvent['type'];

/** 寫進 sink 的完整記錄：事件本身加上不屬於事件的環境資訊。 */
export interface AnalyticsRecord {
  readonly schemaVersion: number;
  readonly sessionId: string;
  readonly ts: number;
  readonly event: AnalyticsEvent;
}
