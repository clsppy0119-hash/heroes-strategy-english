/**
 * 規則版本。任何會改變戰鬥結果的規則調整都必須遞增這個值。
 *
 * 之所以要有它：戰鬥結果由 (初始狀態, seed, rulesVersion, 作答序列) 完全決定，
 * 沒有版本號就無法判斷一場舊戰鬥為什麼重現不出來——是資料壞了還是規則改了。
 */
export const RULES_VERSION = '0.1.0';

export type RulesVersion = typeof RULES_VERSION;
