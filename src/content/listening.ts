import type { ReviewState } from './review';

/**
 * 什麼時候出聽力題。
 *
 * ## 規則：第一次看字，之後聽音
 *
 * 第一次遇到一個字要看得到拼字，否則玩家沒有任何線索可以猜。
 * 之後再遇到就改成聽發音——同一個字，回想的難度往上加一階。
 *
 * 這條規則刻意做得一句話講得完。#7 的可玩定義要玩家「說得出規則」，
 * 一個他講不出來的機制對他來說等於隨機。
 *
 * ## 為什麼不隨機混
 *
 * 隨機混（例如三成出聽力）看起來比較不單調，但玩家會覺得是抽籤，
 * 而不是「因為我認得這個字了，所以它變難了」。後者是進步的感覺，
 * 前者只是噪音。
 */

export type QuestionMode = 'read' | 'listen';

/** 看過幾次之後改出聽力題。 */
export const LISTEN_AFTER_SEEN = 1;

/** 這個字這次該用哪種題型。沒背過的字傳 undefined。 */
export function modeFor(state: ReviewState | undefined): QuestionMode {
  return (state?.seen ?? 0) >= LISTEN_AFTER_SEEN ? 'listen' : 'read';
}

/**
 * 裝置放不出聲音時降級成文字題。
 *
 * 降級是必須的而不是體貼：沒有 speechSynthesis 的環境下，聽力題等於
 * 一題沒有題目的選擇題，玩家只能亂猜。與其讓他猜，不如給他字看。
 */
export function resolveMode(mode: QuestionMode, canSpeak: boolean): QuestionMode {
  return mode === 'listen' && !canSpeak ? 'read' : mode;
}
