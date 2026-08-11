import { nextInt, shuffle, type RngState } from '@/core';

import type { ContentProvider, Question, QuestionRequest } from './provider';

/**
 * 從固定題庫出題。v0.1 唯一的實作，也是之後所有 AI 來源的 fallback。
 *
 * 題庫內容本身由 #6 接上（content/vocab.v1.csv）；這裡只負責「怎麼抽」。
 */

export interface VocabEntry {
  readonly id: string;
  readonly en: string;
  readonly zh: string;
  readonly level: number;
  readonly source: string;
}

const CHOICE_COUNT = 4;

export function createStaticProvider(bank: readonly VocabEntry[]): ContentProvider {
  return {
    name: 'static',
    getQuestions(request: QuestionRequest): readonly Question[] {
      const excluded = new Set(request.excludeIds ?? []);
      const pool = bank.filter(
        (entry) => !excluded.has(entry.id) && (request.level === undefined || entry.level === request.level),
      );

      let state: RngState = request.seed;
      const [ordered, afterShuffle] = shuffle(pool, state);
      state = afterShuffle;

      const picked = ordered.slice(0, request.count);
      const questions: Question[] = [];

      for (const entry of picked) {
        // 干擾項從同 level 抽，避免「只有正確答案看起來像那個難度」的洩題。
        const distractorPool = bank.filter((other) => other.id !== entry.id && other.level === entry.level);
        const [shuffledDistractors, afterDistractors] = shuffle(distractorPool, state);
        state = afterDistractors;

        const distractors = shuffledDistractors.slice(0, CHOICE_COUNT - 1).map((other) => other.zh);
        const [choices, afterChoices] = shuffle([entry.zh, ...distractors], state);
        state = afterChoices;

        questions.push({
          id: entry.id,
          prompt: entry.en,
          choices,
          answerIndex: choices.indexOf(entry.zh),
          sourceId: entry.source,
        });
      }

      return questions;
    },
  };
}

/** 題庫不足以湊滿四個選項時，讓呼叫端早點知道，而不是出一題只有兩個選項。 */
export function assertBankUsable(bank: readonly VocabEntry[]): void {
  const byLevel = new Map<number, number>();
  for (const entry of bank) {
    byLevel.set(entry.level, (byLevel.get(entry.level) ?? 0) + 1);
  }
  for (const [level, count] of byLevel) {
    if (count < CHOICE_COUNT) {
      throw new Error(`level ${level} only has ${count} entries, need at least ${CHOICE_COUNT}`);
    }
  }
}

/** 匯出給測試與 #6 用。 */
export { CHOICE_COUNT };

/** 決定性地抽一個。#5 的戰鬥回合要抽單題時用。 */
export function pickOne<T>(items: readonly T[], state: RngState): readonly [item: T, next: RngState] {
  if (items.length === 0) {
    throw new RangeError('cannot pick from an empty list');
  }
  const [index, next] = nextInt(state, items.length);
  return [items[index], next] as const;
}
