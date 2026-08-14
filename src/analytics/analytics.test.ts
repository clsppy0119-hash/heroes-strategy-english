import { beforeEach, describe, expect, it } from 'vitest';

import { clearStoredRecords, configureAnalytics, storedRecordCount, storedRecords, subscribe, track } from './index';
import type { AnalyticsRecord } from './events';
import { MAX_STORED_RECORDS, createLocalStorageSink, createMemorySink, trimRecords } from './sinks';

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  /** 設成非 null 就模擬配額爆掉。 */
  quota: number | null = null;

  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.quota !== null && value.length > this.quota) {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    }
    this.map.set(key, value);
  }
}

describe('track', () => {
  beforeEach(() => {
    configureAnalytics([createMemorySink()]);
  });

  it('寫進 sink 並帶上 session 與 schema 版本', () => {
    const record = track({ type: 'selfcheck_ping', note: 'hello' });
    expect(record.sessionId).toBe('test-session');
    expect(record.schemaVersion).toBe(0);
    expect(storedRecords()).toHaveLength(1);
  });

  it('清得掉', () => {
    track({ type: 'selfcheck_ping', note: 'a' });
    clearStoredRecords();
    expect(storedRecords()).toHaveLength(0);
  });

  it('訂閱者在寫入與清空時都會被通知', () => {
    let calls = 0;
    const unsubscribe = subscribe(() => {
      calls += 1;
    });
    track({ type: 'selfcheck_ping', note: 'notify' });
    expect(calls).toBe(1);
    clearStoredRecords();
    expect(calls).toBe(2);
    unsubscribe();
    track({ type: 'selfcheck_ping', note: 'after-unsubscribe' });
    expect(calls).toBe(2);
  });

  it('storedRecordCount 跟著記錄數走', () => {
    expect(storedRecordCount()).toBe(0);
    track({ type: 'selfcheck_ping', note: 'a' });
    track({ type: 'selfcheck_ping', note: 'b' });
    expect(storedRecordCount()).toBe(2);
  });

  it('多個 sink 都收得到', () => {
    const a = createMemorySink();
    const b = createMemorySink();
    configureAnalytics([a, b]);
    track({ type: 'selfcheck_ping', note: 'fanout' });
    expect(a.read?.()).toHaveLength(1);
    expect(b.read?.()).toHaveLength(1);
  });
});

describe('localStorage sink', () => {
  it('超過上限就丟掉最舊的', () => {
    const storage = new FakeStorage();
    const sink = createLocalStorageSink(storage);
    for (let i = 0; i < MAX_STORED_RECORDS + 20; i += 1) {
      sink.write({
        schemaVersion: 0,
        sessionId: 's',
        ts: i,
        event: { type: 'selfcheck_ping', note: String(i) },
      });
    }
    const records = sink.read?.() ?? [];
    expect(records).toHaveLength(MAX_STORED_RECORDS);
    expect(records[0].ts).toBe(20);
  });

  /**
   * 有存檔之後玩家會跨天回來，而隔日回訪只需要 session 邊界。
   * 一題一筆的作答紀錄很多、session 邊界很少，所以砍的時候要先砍前者——
   * 直接砍最舊的那一段，最先消失的正好是最早那幾天的 session_start。
   */
  it('丟舊資料時保留 session 邊界', () => {
    const noise: AnalyticsRecord[] = Array.from({ length: 50 }, (_, i) => ({
      schemaVersion: 0,
      sessionId: 's',
      ts: i,
      event: { type: 'selfcheck_ping', note: String(i) },
    }));
    const session: AnalyticsRecord = {
      schemaVersion: 0,
      sessionId: 'oldest',
      ts: -1,
      event: { type: 'session_start', sinceLastSaveMs: null, loaded: 'empty', offlineGrain: 0 },
    };

    const trimmed = trimRecords([session, ...noise], 10);

    expect(trimmed).toHaveLength(10);
    expect(trimmed[0]).toBe(session);
    // 最舊的 session 活下來，被砍掉的是中間那堆作答紀錄。
    expect(trimmed.slice(1).every((record) => record.event.type === 'selfcheck_ping')).toBe(true);
  });

  it('沒超過上限就原封不動', () => {
    const records: AnalyticsRecord[] = [
      { schemaVersion: 0, sessionId: 's', ts: 1, event: { type: 'selfcheck_ping', note: 'a' } },
    ];
    expect(trimRecords(records, 10)).toEqual(records);
  });

  it('連 session 邊界都放不下時，留最近的那些', () => {
    const sessions: AnalyticsRecord[] = Array.from({ length: 20 }, (_, i) => ({
      schemaVersion: 0,
      sessionId: `s${i}`,
      ts: i,
      event: { type: 'session_end', durationMs: i, battlesStarted: 0, battlesFinished: 0 },
    }));
    const trimmed = trimRecords(sessions, 5);
    expect(trimmed).toHaveLength(5);
    expect(trimmed[trimmed.length - 1].ts).toBe(19);
  });

  it('資料壞掉時回傳空陣列而不是丟錯', () => {
    const storage = new FakeStorage();
    storage.setItem('hse.analytics.v0', '{not json');
    const sink = createLocalStorageSink(storage);
    expect(sink.read?.()).toEqual([]);
  });

  it('配額爆掉時不會把例外丟給呼叫端', () => {
    const storage = new FakeStorage();
    const sink = createLocalStorageSink(storage);
    storage.quota = 1;
    expect(() =>
      sink.write({
        schemaVersion: 0,
        sessionId: 's',
        ts: 1,
        event: { type: 'selfcheck_ping', note: 'boom' },
      }),
    ).not.toThrow();
  });
});
