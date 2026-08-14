import { shuffle, type RngState } from '@/core';

import type { ReviewBook } from './review';
import { overdueBy } from './srs';
import type { VocabEntry } from './static-provider';

/**
 * 出哪幾個字。
 *
 * ## 三層，順序不能倒過來
 *
 *   1. 到期該複習的 —— 過期最久的先
 *   2. 從沒出過的   —— 學新東西
 *   3. 其餘的       —— 最久沒看到的先
 *
 * 「到期的優先」是 #28 的驗收條件。但**不能只出到期的**：題庫只有二十個字，
 * 玩家玩幾場之後每個字都排到幾小時後，那時「只出到期的」會抽不到任何東西，
 * 戰鬥直接開不起來。所以後面兩層是保底，不是備案。
 *
 * ## 為什麼每一層裡面要洗牌
 *
 * 純照優先序出的話，同一層裡的字順序永遠一樣，玩家會背下順序而不是背字。
 * 洗牌只在層內進行，所以優先序不會被打亂。
 *
 * ## 決定性
 *
 * 同樣的 (題庫, 複習簿, now, seed) 一定給同樣的結果。加入複習簿之後，
 * 「同一場戰鬥重播會拿到同樣的題目」需要連複習簿一起相同——但戰鬥的
 * 勝負只取決於答對幾題，不取決於是哪些字，所以 rules.ts 那條
 * 「戰鬥結果由 (初始狀態, seed, rulesVersion, 作答序列) 決定」仍然成立。
 */

export interface SelectionRequest {
  readonly count: number;
  readonly level?: number;
  readonly excludeIds?: readonly string[];
  readonly seed: RngState;
  readonly book?: ReviewBook;
  /** 判斷到期用的現在。沒有 book 時不需要。 */
  readonly now?: number;
}

/** 分層並在層內洗牌，回傳排好序的候選。呼叫端自己取前 count 個。 */
export function orderCandidates(
  bank: readonly VocabEntry[],
  request: SelectionRequest,
): readonly VocabEntry[] {
  const excluded = new Set(request.excludeIds ?? []);
  const pool = bank.filter(
    (entry) =>
      !excluded.has(entry.id) && (request.level === undefined || entry.level === request.level),
  );

  const book = request.book;
  const now = request.now;

  let state: RngState = request.seed;
  const [shuffled, next] = shuffle(pool, state);
  state = next;

  // 沒有複習簿就是純隨機——v0.1 的行為，也是任何讀不到學習狀態時的退路。
  if (book === undefined || now === undefined) {
    return shuffled;
  }

  const due: VocabEntry[] = [];
  const fresh: VocabEntry[] = [];
  const rest: VocabEntry[] = [];

  for (const entry of shuffled) {
    const seen = book[entry.id];
    if (seen === undefined) {
      fresh.push(entry);
    } else if (seen.dueAt !== null && seen.dueAt <= now) {
      due.push(entry);
    } else {
      rest.push(entry);
    }
  }

  // 到期的那一層照過期程度排，不洗牌——欠最久的先還。
  due.sort((a, b) => overdueBy(book[b.id].dueAt, now) - overdueBy(book[a.id].dueAt, now));
  // 剩下的照多久沒看到排，最久的先。
  rest.sort((a, b) => book[a.id].lastSeenAt - book[b.id].lastSeenAt);

  return [...due, ...fresh, ...rest];
}
