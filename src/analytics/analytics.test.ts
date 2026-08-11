import { beforeEach, describe, expect, it } from 'vitest';

import { clearStoredRecords, configureAnalytics, storedRecordCount, storedRecords, subscribe, track } from './index';
import { MAX_STORED_RECORDS, createLocalStorageSink, createMemorySink } from './sinks';

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
