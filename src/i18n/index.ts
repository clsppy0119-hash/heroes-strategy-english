import messages from './locales/zh-TW.json';

/**
 * v0.1 只有繁中一種語系，但文案一律走 key。
 *
 * 理由不是現在要多語系，是之後要。等到有第二種語言才回頭抽字串，
 * 等於全站掃一次；現在做的成本接近零，由 CI 檢查元件裡不得出現硬編中文
 * （scripts/check-no-hardcoded-cjk.mjs）。
 */

export const DEFAULT_LOCALE = 'zh-TW' as const;

export type Locale = typeof DEFAULT_LOCALE;
export type MessageKey = keyof typeof messages;

export type MessageParams = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * 取一段文案。缺 key 時回傳 key 本身而不是丟錯——
 * 少一行字不該讓整頁掛掉，但在畫面上會很明顯，所以不會被忽略。
 */
export function t(key: MessageKey, params?: MessageParams): string {
  const template: string | undefined = messages[key];
  if (template === undefined) {
    return key;
  }
  if (params === undefined) {
    return template;
  }
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** 給檢查腳本與測試用：目前語系的全部 key。 */
export function messageKeys(): MessageKey[] {
  return Object.keys(messages) as MessageKey[];
}
