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

export interface BattleStart {
  readonly type: 'battle_start';
  readonly battleId: string;
  readonly tileId: string;
  readonly seed: number;
  readonly rulesVersion: RulesVersion;
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
