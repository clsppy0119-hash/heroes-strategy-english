import { MAX_ROUNDS, nextInt, shuffle, type RngState } from '@/core';

import { modeFor } from './listening';
import type { ContentProvider, Question, QuestionRequest } from './provider';
import { orderCandidates } from './select';

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

/**
 * 一個字的例句。
 *
 * 跟 VocabEntry 分開存而不是多兩個欄位：不是每個字都有例句，而選配的欄位
 * 混在必填的結構裡，每個讀它的地方都要先判斷有沒有。分開之後「有沒有例句」
 * 就是一次查表，型別上也看得出來。
 */
export interface VocabExample {
  readonly en: string;
  readonly zh: string;
}

const CHOICE_COUNT = 4;

export function createStaticProvider(bank: readonly VocabEntry[]): ContentProvider {
  return {
    name: 'static',
    getQuestions(request: QuestionRequest): readonly Question[] {
      // 出哪幾個字由 select.ts 決定（到期的優先），這裡只負責把字包成題目。
      const ordered = orderCandidates(bank, {
        count: request.count,
        level: request.level,
        excludeIds: request.excludeIds,
        seed: request.seed,
        book: request.review?.book,
        now: request.review?.now,
      });

      // 選項的亂數從同一顆種子往下走，所以同樣的輸入永遠給同樣的題目。
      let state: RngState = request.seed;
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
          // 第一次看字，之後聽音。沒有複習簿時一律看字——
          // 讀不到學習狀態就不知道玩家看過沒有，那時出聽力題只是刁難。
          mode: modeFor(request.review?.book[entry.id]),
        });
      }

      return questions;
    },
  };
}

/**
 * 每個 level 至少要有這麼多題。
 *
 * 兩個下限取大的：
 *   CHOICE_COUNT  湊不滿四個選項，會出一題只有兩個選項
 *   MAX_ROUNDS    抽不滿一場戰鬥的題數，startBattle 會丟 RangeError——
 *                 而那是在玩家按下「出兵」的當下丟，等於整頁掛掉
 *
 * 原本只檢查前者。題庫縮到每級五題就會通過驗證但一開打就崩，
 * 這種洞要在載入題庫時就擋掉，不是等玩家踩。
 */
const MIN_ENTRIES_PER_LEVEL = Math.max(CHOICE_COUNT, MAX_ROUNDS);

export function assertBankUsable(bank: readonly VocabEntry[]): void {
  const byLevel = new Map<number, number>();
  for (const entry of bank) {
    byLevel.set(entry.level, (byLevel.get(entry.level) ?? 0) + 1);
  }
  for (const [level, count] of byLevel) {
    if (count < MIN_ENTRIES_PER_LEVEL) {
      throw new Error(`level ${level} only has ${count} entries, need at least ${MIN_ENTRIES_PER_LEVEL}`);
    }
  }
}

/** 匯出給測試與 #6 用。 */
export { CHOICE_COUNT, MIN_ENTRIES_PER_LEVEL };

/** 決定性地抽一個。#5 的戰鬥回合要抽單題時用。 */
export function pickOne<T>(items: readonly T[], state: RngState): readonly [item: T, next: RngState] {
  if (items.length === 0) {
    throw new RangeError('cannot pick from an empty list');
  }
  const [index, next] = nextInt(state, items.length);
  return [items[index], next] as const;
}
