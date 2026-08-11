import type { AnalyticsRecord } from './events';

/**
 * v0.1 把事件寫在瀏覽器裡；v0.2 換成後端。
 * 換的時候只動這個檔和 index.ts 的預設 sink 組合，呼叫端一行都不改。
 */
export interface AnalyticsSink {
  readonly name: string;
  write(record: AnalyticsRecord): void;
  read?(): AnalyticsRecord[];
  clear?(): void;
}

export const STORAGE_KEY = 'hse.analytics.v0';

/** 超過就丟掉最舊的。localStorage 有容量上限，塞爆會整個寫入失敗。 */
export const MAX_STORED_RECORDS = 500;

export function createLocalStorageSink(storage: Storage): AnalyticsSink {
  const load = (): AnalyticsRecord[] => {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as AnalyticsRecord[]) : [];
    } catch {
      // 壞掉的資料不值得救，也不該讓遊戲掛掉。
      return [];
    }
  };

  return {
    name: 'localStorage',
    write(record) {
      const records = load();
      records.push(record);
      const trimmed =
        records.length > MAX_STORED_RECORDS ? records.slice(records.length - MAX_STORED_RECORDS) : records;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      } catch {
        // 配額滿了：砍半再試一次，還是失敗就放棄這一筆。
        try {
          storage.setItem(STORAGE_KEY, JSON.stringify(trimmed.slice(Math.floor(trimmed.length / 2))));
        } catch {
          /* 埋點失敗不該影響玩家 */
        }
      }
    },
    read: load,
    clear() {
      storage.removeItem(STORAGE_KEY);
    },
  };
}

export function createConsoleSink(logger: Pick<Console, 'debug'> = console): AnalyticsSink {
  return {
    name: 'console',
    write(record) {
      logger.debug('[analytics]', record.event.type, record);
    },
  };
}

/** 測試與伺服器端 render 用。 */
export function createMemorySink(): AnalyticsSink {
  const records: AnalyticsRecord[] = [];
  return {
    name: 'memory',
    write(record) {
      records.push(record);
    },
    read: () => [...records],
    clear() {
      records.length = 0;
    },
  };
}
