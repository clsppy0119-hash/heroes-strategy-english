import { SCHEMA_VERSION, type AnalyticsEvent, type AnalyticsRecord } from './events';
import { createConsoleSink, createLocalStorageSink, createMemorySink, type AnalyticsSink } from './sinks';

export * from './events';
export {
  createConsoleSink,
  createLocalStorageSink,
  createMemorySink,
  MAX_STORED_RECORDS,
  STORAGE_KEY,
  trimRecords,
  type AnalyticsSink,
} from './sinks';

let sinks: AnalyticsSink[] | null = null;
let sessionId = '';
let sessionStartedAt = 0;

const listeners = new Set<() => void>();

/**
 * 訂閱事件記錄的變動。
 *
 * 存在的理由是 React：埋點是 React 之外的狀態，UI 要顯示它就得訂閱，
 * 而不是在 effect 裡 setState 造成連鎖 render。搭配 useSyncExternalStore 使用。
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function browserSinks(): AnalyticsSink[] {
  if (typeof window === 'undefined') {
    // 伺服器端 render 沒有 localStorage，也不該把 render 當成玩家行為記錄。
    return [createMemorySink()];
  }
  const list: AnalyticsSink[] = [createLocalStorageSink(window.localStorage)];
  if (process.env.NODE_ENV !== 'production') {
    list.push(createConsoleSink());
  }
  return list;
}

function ensureInit(): void {
  if (sinks !== null) {
    return;
  }
  sinks = browserSinks();
  sessionStartedAt = Date.now();
  sessionId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `s-${sessionStartedAt.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** 測試用：換掉 sink 組合並重設 session。 */
export function configureAnalytics(next: AnalyticsSink[], id = 'test-session'): void {
  sinks = next;
  sessionId = id;
  sessionStartedAt = Date.now();
}

export function currentSessionId(): string {
  ensureInit();
  return sessionId;
}

export function sessionElapsedMs(now: number = Date.now()): number {
  ensureInit();
  return now - sessionStartedAt;
}

/**
 * 送出一筆事件。呼叫端只認識這一個函式——
 * v0.2 換成後端 sink 時，這行以上的程式碼一個字都不用改。
 */
export function track(event: AnalyticsEvent): AnalyticsRecord {
  ensureInit();
  const record: AnalyticsRecord = {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    ts: Date.now(),
    event,
  };
  for (const sink of sinks ?? []) {
    sink.write(record);
  }
  notify();
  return record;
}

/** 目前記錄筆數。給 useSyncExternalStore 當 snapshot 用——回傳 number 才不會每次都判定成變了。 */
export function storedRecordCount(): number {
  return storedRecords().length;
}

/** 讀回目前存下來的事件（#7 的分析先靠這個手動導出）。 */
export function storedRecords(): AnalyticsRecord[] {
  ensureInit();
  for (const sink of sinks ?? []) {
    if (sink.read) {
      return sink.read();
    }
  }
  return [];
}

export function clearStoredRecords(): void {
  ensureInit();
  for (const sink of sinks ?? []) {
    sink.clear?.();
  }
  notify();
}
