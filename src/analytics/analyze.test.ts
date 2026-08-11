import { describe, expect, it } from 'vitest';

import { createMap, MAX_ROUNDS } from '@/core';

import {
  ANALYZER_ROUNDS_PER_BATTLE,
  ANALYZER_TILE_LEVELS,
  DISENGAGE_LIMIT,
  GUESS_THRESHOLD_MS,
  analyze,
} from './analyze';
import type { AnalyticsEvent, AnalyticsRecord } from './events';

/**
 * analyze.ts 內聯了地圖等級與回合上限，好讓 scripts/analyze-playtest.mjs
 * 用純 Node 就跑得起來。代價是可能跟 core 漂移，這兩個測試盯著。
 */
describe('分析器沒有跟 core 漂移', () => {
  it('地格等級一致', () => {
    const fromCore = Object.fromEntries(createMap().map((tile) => [tile.id, tile.level]));
    expect(ANALYZER_TILE_LEVELS).toEqual(fromCore);
  });

  it('回合上限一致', () => {
    expect(ANALYZER_ROUNDS_PER_BATTLE).toBe(MAX_ROUNDS);
  });
});

let ts = 0;
const rec = (event: AnalyticsEvent, sessionId = 's1'): AnalyticsRecord => ({
  schemaVersion: 0,
  sessionId,
  ts: (ts += 1),
  event,
});

const shown = (round: number) =>
  rec({ type: 'question_shown', battleId: 'b1', round, questionId: `q${round}` });

const answered = (round: number, correct: boolean, elapsedMs: number) =>
  rec({
    type: 'question_answered',
    battleId: 'b1',
    round,
    questionId: `q${round}`,
    correct,
    elapsedMs,
    streak: correct ? 1 : 0,
  });

const skippedAt = (round: number, elapsedMs = 400) =>
  rec({ type: 'question_skipped', battleId: 'b1', round, questionId: `q${round}`, elapsedMs });

describe('亂猜跳題率', () => {
  it('跳題算進去', () => {
    const report = analyze([shown(0), skippedAt(0), shown(1), answered(1, true, 3000)]);
    expect(report.skipped).toBe(1);
    expect(report.disengageRate).toBe(0.5);
  });

  it('答錯而且快得不像有讀題，算亂猜', () => {
    const report = analyze([shown(0), answered(0, false, GUESS_THRESHOLD_MS - 1)]);
    expect(report.guessed).toBe(1);
    expect(report.disengageRate).toBe(1);
  });

  it('答錯但有花時間，不算亂猜——那是真的不會', () => {
    const report = analyze([shown(0), answered(0, false, GUESS_THRESHOLD_MS + 1)]);
    expect(report.guessed).toBe(0);
    expect(report.disengageRate).toBe(0);
  });

  it('答對再快也不算亂猜', () => {
    const report = analyze([shown(0), answered(0, true, 100)]);
    expect(report.guessed).toBe(0);
  });
});

describe('喊停條件', () => {
  const many = (count: number, make: (i: number) => AnalyticsRecord[]) =>
    Array.from({ length: count }, (_, i) => make(i)).flat();

  it('樣本不足時不下結論', () => {
    expect(analyze([shown(0), skippedAt(0)]).verdict).toBe('not-enough-data');
  });

  it('亂猜跳題率超過三成就是未通過', () => {
    // 40 題裡跳掉 20 題。
    const records = many(40, (i) => (i < 20 ? [shown(i), skippedAt(i)] : [shown(i), answered(i, true, 2000)]));
    const report = analyze(records);
    expect(report.disengageRate).toBeGreaterThan(DISENGAGE_LIMIT);
    expect(report.verdict).toBe('fail');
  });

  it('都有好好作答就是通過', () => {
    const records = many(40, (i) => [shown(i), answered(i, i % 3 !== 0, 2500)]);
    expect(analyze(records).verdict).toBe('pass');
  });
});

describe('其他四個數字', () => {
  it('作答時間分佈', () => {
    const records = [100, 200, 300, 400].flatMap((ms, i) => [shown(i), answered(i, true, ms)]);
    const report = analyze(records);
    expect(report.elapsedMs.median).toBe(300);
    expect(report.elapsedMs.p25).toBe(200);
  });

  it('連對長度分佈', () => {
    const end = (maxStreak: number) =>
      rec({
        type: 'battle_end',
        battleId: 'b1',
        won: true,
        rounds: 3,
        correctCount: maxStreak,
        maxStreak,
        abandoned: false,
      });
    const report = analyze([end(0), end(2), end(2), end(3)]);
    expect(report.maxStreakHistogram).toEqual([1, 0, 2, 1]);
  });

  it('單場放棄率', () => {
    const end = (abandoned: boolean) =>
      rec({
        type: 'battle_end',
        battleId: 'b1',
        won: false,
        rounds: 2,
        correctCount: 0,
        maxStreak: 0,
        abandoned,
      });
    const report = analyze([end(true), end(false), end(false), end(false)]);
    expect(report.abandonRate).toBe(0.25);
  });

  it('首次佔下三塊地的耗時，只取第三塊', () => {
    const captured = (totalCaptured: number, sinceSessionStartMs: number) =>
      rec({ type: 'tile_captured', tileId: '1,0', totalCaptured, sinceSessionStartMs });
    const report = analyze([captured(1, 10_000), captured(2, 40_000), captured(3, 95_000)]);
    expect(report.timeToThreeTilesMs).toEqual([95_000]);
  });

  it('多個測試者的資料合得起來', () => {
    const report = analyze([shown(0), rec({ type: 'session_end', durationMs: 1, battlesStarted: 1, battlesFinished: 1 }, 's2')]);
    expect(report.sessions).toBe(2);
  });

  it('空資料不會炸', () => {
    const report = analyze([]);
    expect(report.disengageRate).toBe(0);
    expect(report.elapsedMs.median).toBeNull();
    expect(report.verdict).toBe('not-enough-data');
  });
});
