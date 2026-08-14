import { EMPTY_REVIEW_BOOK, type ReviewBook, type ReviewState } from '@/content';

/**
 * 複習簿的去處。
 *
 * ## 為什麼跟局面的存檔分開
 *
 * 複習簿是**學習狀態**，局面是**遊戲狀態**。兩者的生命週期不一樣：
 * 重開一局（重整旗鼓）會丟掉領地與糧草，但不該丟掉「哪些字你背過」。
 * 存在一起的話，重開一局就會把學習進度一起洗掉——那是最不該發生的事。
 *
 * 分開也讓 core 保持乾淨：`GameState` 不認識 ReviewBook，
 * `check:core` 擋著 core 相依 `@/content`。
 *
 * ## 為什麼沒有版本號
 *
 * 局面的存檔版本不合就整份作廢，因為錯的形狀會讓遊戲跑不動。複習簿不一樣：
 * 它是一個 id 對狀態的表，逐筆檢查就好，壞掉的那幾筆丟掉，其餘留著。
 * 學習進度比一局遊戲珍貴，能救多少救多少。
 */

export const REVIEW_KEY_PREFIX = 'hse.review';

export function reviewKey(playerId: string): string {
  return `${REVIEW_KEY_PREFIX}.${playerId}`;
}

export interface ReviewRepository {
  readonly name: string;
  load(playerId: string): Promise<ReviewBook>;
  save(playerId: string, book: ReviewBook): Promise<void>;
  clear(playerId: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nullOrFinite(value: unknown): value is number | null {
  return value === null || finite(value);
}

/** 逐筆檢查。壞掉的那筆丟掉，不是整本作廢——學習進度能救多少救多少。 */
export function readReviewBook(raw: string | null): ReviewBook {
  if (raw === null || raw === '') {
    return EMPTY_REVIEW_BOOK;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_REVIEW_BOOK;
  }
  if (!isRecord(parsed)) {
    return EMPTY_REVIEW_BOOK;
  }

  const book: Record<string, ReviewState> = {};
  for (const [id, value] of Object.entries(parsed)) {
    if (!isRecord(value)) {
      continue;
    }
    const { seen, lapses, lastSeenAt, stability, difficulty, dueAt } = value;
    if (
      typeof id !== 'string' ||
      id === '' ||
      !finite(seen) ||
      seen < 0 ||
      !finite(lapses) ||
      lapses < 0 ||
      lapses > seen ||
      !finite(lastSeenAt) ||
      lastSeenAt < 0 ||
      !nullOrFinite(stability) ||
      !nullOrFinite(difficulty) ||
      !nullOrFinite(dueAt)
    ) {
      continue;
    }
    book[id] = { itemId: id, seen, lapses, lastSeenAt, stability, difficulty, dueAt };
  }
  return book;
}

export function createLocalStorageReviewRepository(storage: Storage): ReviewRepository {
  return {
    name: 'localStorage',
    async load(playerId) {
      try {
        return readReviewBook(storage.getItem(reviewKey(playerId)));
      } catch {
        // 無痕模式碰 localStorage 會丟例外。讀不到就當作沒背過，
        // 不該讓遊戲開不起來。
        return EMPTY_REVIEW_BOOK;
      }
    },
    async save(playerId, book) {
      try {
        storage.setItem(reviewKey(playerId), JSON.stringify(book));
      } catch {
        /* 配額滿或無痕模式：下一次還會再試 */
      }
    },
    async clear(playerId) {
      try {
        storage.removeItem(reviewKey(playerId));
      } catch {
        /* 同上 */
      }
    },
  };
}

export function createMemoryReviewRepository(): ReviewRepository {
  const books = new Map<string, string>();
  return {
    name: 'memory',
    async load(playerId) {
      return readReviewBook(books.get(playerId) ?? null);
    },
    async save(playerId, book) {
      books.set(playerId, JSON.stringify(book));
    },
    async clear(playerId) {
      books.delete(playerId);
    },
  };
}

let repository: ReviewRepository | null = null;

export function reviewRepository(): ReviewRepository {
  if (repository === null) {
    repository =
      typeof window === 'undefined'
        ? createMemoryReviewRepository()
        : createLocalStorageReviewRepository(window.localStorage);
  }
  return repository;
}

/** 測試用。 */
export function configureReviewRepository(next: ReviewRepository | null): void {
  repository = next;
}
