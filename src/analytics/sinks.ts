import { SESSION_EVENT_TYPES, type AnalyticsRecord } from './events';

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

/**
 * 超過就丟掉最舊的。localStorage 有容量上限，塞爆會整個寫入失敗。
 *
 * v0.2 從 500 調到 2000：有存檔之後玩家會跨天回來，而隔日回訪的分析
 * 需要看得到好幾天前的紀錄。500 筆大約是兩三場遊玩就滿了。
 */
export const MAX_STORED_RECORDS = 2_000;

/**
 * 丟舊資料時保留 session 邊界。
 *
 * 直接砍最舊的那一段，最先消失的就是最早那幾天的 session_start——
 * 那正好是隔日回訪唯一需要的東西。一題一筆的作答紀錄很多，
 * session 邊界很少，所以先砍前者。
 */
export function trimRecords(records: readonly AnalyticsRecord[], max: number): AnalyticsRecord[] {
  if (records.length <= max) {
    return [...records];
  }
  const sessions = records.filter((record) => SESSION_EVENT_TYPES.includes(record.event.type));
  const rest = records.filter((record) => !SESSION_EVENT_TYPES.includes(record.event.type));

  // 連 session 邊界都放不下的話，那就只留最近的那些——沒有別的選擇了。
  if (sessions.length >= max) {
    return sessions.slice(sessions.length - max);
  }
  const keptRest = rest.slice(rest.length - (max - sessions.length));
  const kept = new Set<AnalyticsRecord>([...sessions, ...keptRest]);
  return records.filter((record) => kept.has(record));
}

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
      const trimmed = trimRecords(records, MAX_STORED_RECORDS);
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
