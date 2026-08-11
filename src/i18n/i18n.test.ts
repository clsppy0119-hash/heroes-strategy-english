import { describe, expect, it } from 'vitest';

import { messageKeys, t } from './index';

describe('t', () => {
  it('取得存在的 key', () => {
    expect(t('app.title')).toBe('群英戰略版');
  });

  it('代入參數', () => {
    expect(t('selfcheck.analytics.count', { count: 3 })).toBe('已記錄 3 筆事件');
  });

  it('缺參數時保留佔位符，不會變成 undefined', () => {
    expect(t('selfcheck.analytics.count', {})).toBe('已記錄 {count} 筆事件');
  });

  it('缺 key 時回傳 key 本身', () => {
    // @ts-expect-error 故意傳不存在的 key，驗證執行期行為
    expect(t('nope.not.here')).toBe('nope.not.here');
  });
});

describe('locale 檔', () => {
  it('沒有空字串', () => {
    for (const key of messageKeys()) {
      expect(t(key).length, key).toBeGreaterThan(0);
    }
  });

  it('沒有重複的文案值（重複通常代表複製貼上忘了改）', () => {
    const seen = new Map<string, string>();
    for (const key of messageKeys()) {
      const value = t(key);
      const previous = seen.get(value);
      expect(previous, `${key} 與 ${previous} 文案重複：${value}`).toBeUndefined();
      seen.set(value, key);
    }
  });
});
