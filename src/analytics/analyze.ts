import type { AnalyticsRecord } from './events';

/**
 * 從埋點記錄算出 #7 要的五個數字，並對照 v0.1 事先寫下的喊停條件。
 *
 * 純函式，不碰檔案也不碰瀏覽器——瀏覽器裡的匯出鍵和 scripts/analyze-playtest.mjs
 * 都呼叫同一份實作，所以測試場上看到的數字跟事後分析出來的一定一致。
 */

/**
 * 低於這個時間的錯誤作答視為亂猜。
 *
 * 800ms 是拍腦袋定的：讀一個英文單字加掃四個中文選項，快也要一秒出頭。
 * 真人資料進來之後應該用作答時間分佈的左尾重新定，而不是繼續用這個猜的值。
 */
export const GUESS_THRESHOLD_MS = 800;

/** #7 的喊停條件：主動亂猜跳題率超過三成就停下來重做設計，不要加內容。 */
export const DISENGAGE_LIMIT = 0.3;

export interface PlaytestReport {
  readonly sessions: number;
  readonly battlesStarted: number;
  readonly battlesFinished: number;

  readonly questionsShown: number;
  readonly answered: number;
  readonly skipped: number;
  /** 答錯且快得不像有讀題。 */
  readonly guessed: number;
  /** (skipped + guessed) / questionsShown。這個數字對照喊停條件。 */
  readonly disengageRate: number;

  readonly elapsedMs: {
    readonly p25: number | null;
    readonly median: number | null;
    readonly p75: number | null;
  };

  /** 每場戰鬥的最長連對，index 是連對長度。 */
  readonly maxStreakHistogram: readonly number[];

  readonly abandoned: number;
  readonly abandonRate: number;

  /** 每個 session 佔下第三塊地花的時間。沒到三塊的 session 不計入。 */
  readonly timeToThreeTilesMs: readonly number[];

  readonly verdict: 'pass' | 'fail' | 'not-enough-data';
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index];
}

export function analyze(records: readonly AnalyticsRecord[]): PlaytestReport {
  const sessions = new Set(records.map((record) => record.sessionId));

  let battlesStarted = 0;
  let battlesFinished = 0;
  let questionsShown = 0;
  let answered = 0;
  let skipped = 0;
  let guessed = 0;
  let abandoned = 0;

  const elapsed: number[] = [];
  const maxStreaks: number[] = [];
  const timeToThree: number[] = [];

  for (const { event } of records) {
    switch (event.type) {
      case 'battle_start':
        battlesStarted += 1;
        break;
      case 'question_shown':
        questionsShown += 1;
        break;
      case 'question_answered':
        answered += 1;
        elapsed.push(event.elapsedMs);
        if (!event.correct && event.elapsedMs < GUESS_THRESHOLD_MS) {
          guessed += 1;
        }
        break;
      case 'question_skipped':
        skipped += 1;
        elapsed.push(event.elapsedMs);
        break;
      case 'battle_end':
        battlesFinished += 1;
        maxStreaks.push(event.maxStreak);
        if (event.abandoned) {
          abandoned += 1;
        }
        break;
      case 'tile_captured':
        if (event.totalCaptured === 3) {
          timeToThree.push(event.sinceSessionStartMs);
        }
        break;
      default:
        break;
    }
  }

  const sorted = [...elapsed].sort((a, b) => a - b);
  const disengageRate = questionsShown === 0 ? 0 : (skipped + guessed) / questionsShown;

  const histogram: number[] = [];
  for (const streak of maxStreaks) {
    histogram[streak] = (histogram[streak] ?? 0) + 1;
  }
  for (let i = 0; i < histogram.length; i += 1) {
    histogram[i] = histogram[i] ?? 0;
  }

  return {
    sessions: sessions.size,
    battlesStarted,
    battlesFinished,
    questionsShown,
    answered,
    skipped,
    guessed,
    disengageRate,
    elapsedMs: {
      p25: percentile(sorted, 0.25),
      median: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
    },
    maxStreakHistogram: histogram,
    abandoned,
    abandonRate: battlesFinished === 0 ? 0 : abandoned / battlesFinished,
    timeToThreeTilesMs: timeToThree,
    // 樣本太少的話，通過與否都不該當結論看。#7 要求至少五個人。
    verdict: questionsShown < 30 ? 'not-enough-data' : disengageRate > DISENGAGE_LIMIT ? 'fail' : 'pass',
  };
}
