import { VOCAB } from './vocab.generated';
import { assertBankUsable, createStaticProvider } from './static-provider';

export * from './provider';
export * from './static-provider';
export * from './listening';
export * from './review';
export * from './select';
export * from './srs';
export { VOCAB, VOCAB_SOURCE } from './vocab.generated';

// 題庫湊不出四個選項的話，越早炸越好——不要等到玩家看到一題只有兩個選項。
assertBankUsable(VOCAB);

/** v0.1 唯一的題目來源。之後接 AI 產線時，這個會變成 withBudgetGuard 的 fallback。 */
export const vocabProvider = createStaticProvider(VOCAB);
