import type { AnalyticsRecord } from './events';

/**
 * 地格等級與回合上限刻意內聯，不從 @/core import。
 *
 * 因為 scripts/analyze-playtest.mjs 是用純 Node 跑的，解不了 `@/` 路徑別名；
 * 讓分析器不相依任何東西，就不需要為了看一份測試資料先跑打包。
 *
 * 代價是會跟 core 漂移，所以 analyze.test.ts 有一個測試盯著這兩份值一致。
 */
const TILE_LEVELS: Readonly<Record<string, number>> = {
  '0,0': 2,
  '1,0': 1,
  '2,0': 3,
  '0,1': 1,
  '1,1': 0,
  '2,1': 2,
  '0,2': 3,
  '1,2': 2,
  '2,2': 1,
};

/** 最長的一場（LV.3）有三回合。 */
const ROUNDS_PER_BATTLE = 3;

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

/** 給防漂移測試用。 */
export const ANALYZER_TILE_LEVELS = TILE_LEVELS;
export const ANALYZER_ROUNDS_PER_BATTLE = ROUNDS_PER_BATTLE;

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

  /**
   * 以下三組是診斷用的拆解。
   *
   * 第一次實測時，總體的亂猜跳題率只告訴我「未通過」，說不出為什麼。
   * 是這三張表指出根因不是「學習變成過路費」，而是「打不贏的仗打太久」（#14）。
   * 下一次測試不該再靠臨時腳本重做一次。
   */
  readonly byTileLevel: readonly TileLevelBreakdown[];
  /** index 是回合序（0 起），值是該回合沒在讀題的比例。 */
  readonly disengageByRound: readonly (number | null)[];
  /** index 是這場之前連敗幾場（3 以上併在一起），值是沒在讀題的比例。 */
  readonly disengageByLosingStreak: readonly (number | null)[];

  readonly verdict: 'pass' | 'fail' | 'not-enough-data';
}

export interface TileLevelBreakdown {
  readonly level: number;
  readonly questionsShown: number;
  readonly skipped: number;
  readonly correct: number;
  readonly wrong: number;
  readonly accuracy: number | null;
  readonly battles: number;
  readonly won: number;
  readonly winRate: number | null;
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index];
}

/** 跳過，或答錯得快到不像有讀題。 */
function isDisengaged(event: AnalyticsRecord['event']): boolean {
  if (event.type === 'question_skipped') {
    return true;
  }
  return event.type === 'question_answered' && !event.correct && event.elapsedMs < GUESS_THRESHOLD_MS;
}

const rate = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

export function analyze(records: readonly AnalyticsRecord[]): PlaytestReport {
  const sessions = new Set(records.map((record) => record.sessionId));

  // 地格等級要從地圖查，事件本身只帶 tileId。
  const battleLevel = new Map<string, number>();

  const perLevel = new Map<
    number,
    { shown: number; skipped: number; correct: number; wrong: number; battles: number; won: number }
  >();
  const perRound = Array.from({ length: ROUNDS_PER_BATTLE }, () => ({ n: 0, off: 0 }));
  const perLosingStreak = Array.from({ length: 4 }, () => ({ n: 0, off: 0 }));
  let losingStreak = 0;

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

  const bucketFor = (battleId: string) => {
    const level = battleLevel.get(battleId);
    if (level === undefined) {
      return undefined;
    }
    let bucket = perLevel.get(level);
    if (bucket === undefined) {
      bucket = { shown: 0, skipped: 0, correct: 0, wrong: 0, battles: 0, won: 0 };
      perLevel.set(level, bucket);
    }
    return bucket;
  };

  for (const { event } of records) {
    // 診斷用的拆解：回合、連敗、地格等級。
    if (event.type === 'question_answered' || event.type === 'question_skipped') {
      const off = isDisengaged(event) ? 1 : 0;
      const round = perRound[event.round];
      if (round !== undefined) {
        round.n += 1;
        round.off += off;
      }
      const streakBucket = perLosingStreak[Math.min(losingStreak, perLosingStreak.length - 1)];
      streakBucket.n += 1;
      streakBucket.off += off;

      const bucket = bucketFor(event.battleId);
      if (bucket !== undefined) {
        if (event.type === 'question_skipped') {
          bucket.skipped += 1;
        } else if (event.correct) {
          bucket.correct += 1;
        } else {
          bucket.wrong += 1;
        }
      }
    }
    if (event.type === 'question_shown') {
      const bucket = bucketFor(event.battleId);
      if (bucket !== undefined) {
        bucket.shown += 1;
      }
    }
    if (event.type === 'battle_end') {
      const bucket = bucketFor(event.battleId);
      if (bucket !== undefined) {
        bucket.battles += 1;
        if (event.won) {
          bucket.won += 1;
        }
      }
      losingStreak = event.won ? 0 : losingStreak + 1;
    }

    switch (event.type) {
      case 'battle_start':
        battlesStarted += 1;
        battleLevel.set(event.battleId, TILE_LEVELS[event.tileId] ?? -1);
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
    byTileLevel: [...perLevel.entries()]
      .filter(([level]) => level > 0)
      .sort((a, b) => a[0] - b[0])
      .map(([level, b]) => ({
        level,
        questionsShown: b.shown,
        skipped: b.skipped,
        correct: b.correct,
        wrong: b.wrong,
        accuracy: rate(b.correct, b.correct + b.wrong),
        battles: b.battles,
        won: b.won,
        winRate: rate(b.won, b.battles),
      })),
    disengageByRound: perRound.map((r) => rate(r.off, r.n)),
    disengageByLosingStreak: perLosingStreak.map((r) => rate(r.off, r.n)),
    // 樣本太少的話，通過與否都不該當結論看。#7 要求至少五個人。
    verdict: questionsShown < 30 ? 'not-enough-data' : disengageRate > DISENGAGE_LIMIT ? 'fail' : 'pass',
  };
}
