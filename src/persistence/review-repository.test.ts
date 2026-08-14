import { beforeEach, describe, expect, it } from 'vitest';

import { EMPTY_REVIEW_BOOK, recordAttempt, type ReviewBook } from '@/content';

import {
  createLocalStorageReviewRepository,
  createMemoryReviewRepository,
  readReviewBook,
  reviewKey,
  type ReviewRepository,
} from './review-repository';

const T0 = 1_700_000_000_000;

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  } as Storage;
}

const answered = (itemId: string, correct: boolean, at = T0): ReviewBook =>
  recordAttempt(EMPTY_REVIEW_BOOK, { itemId, correct, elapsedMs: 900, at, context: 'b1' });

function behavesLikeAReviewRepository(name: string, make: () => ReviewRepository) {
  describe(name, () => {
    let repository: ReviewRepository;

    beforeEach(() => {
      repository = make();
    });

    it('沒存過就是空的', async () => {
      expect(await repository.load('local')).toEqual(EMPTY_REVIEW_BOOK);
    });

    it('存了就讀得回來，排程也在', async () => {
      const book = answered('v001', false);
      await repository.save('local', book);
      const loaded = await repository.load('local');
      expect(loaded).toEqual(book);
      expect(loaded.v001.dueAt).toBe(book.v001.dueAt);
    });

    it('清掉之後就空了', async () => {
      await repository.save('local', answered('v001', true));
      await repository.clear('local');
      expect(await repository.load('local')).toEqual(EMPTY_REVIEW_BOOK);
    });

    it('不同玩家各背各的', async () => {
      await repository.save('a', answered('v001', true));
      await repository.save('b', answered('v002', true));
      expect(Object.keys(await repository.load('a'))).toEqual(['v001']);
      expect(Object.keys(await repository.load('b'))).toEqual(['v002']);
    });
  });
}

behavesLikeAReviewRepository('記憶體實作', createMemoryReviewRepository);
behavesLikeAReviewRepository('localStorage 實作', () =>
  createLocalStorageReviewRepository(fakeStorage()),
);

/**
 * 局面的存檔是「版本不合就整份作廢」，複習簿不是：它是一個 id 對狀態的表，
 * 壞掉的那幾筆丟掉、其餘留著。學習進度比一局遊戲珍貴，能救多少救多少。
 */
describe('壞掉的資料只丟壞掉的那幾筆', () => {
  it('壞掉的那筆丟掉，好的留著', () => {
    const raw = JSON.stringify({
      good: { seen: 2, lapses: 1, lastSeenAt: T0, stability: 1000, difficulty: 0.3, dueAt: T0 + 1000 },
      bad: { seen: 'many', lapses: 1, lastSeenAt: T0, stability: null, difficulty: null, dueAt: null },
    });
    const book = readReviewBook(raw);
    expect(Object.keys(book)).toEqual(['good']);
  });

  it('整份不是 JSON 就當作沒背過，不會丟錯', () => {
    expect(readReviewBook('{ 壞掉的')).toEqual(EMPTY_REVIEW_BOOK);
    expect(readReviewBook('[]')).toEqual(EMPTY_REVIEW_BOOK);
    expect(readReviewBook(null)).toEqual(EMPTY_REVIEW_BOOK);
  });

  const broken: Record<string, unknown> = {
    'seen 是負的': { seen: -1, lapses: 0, lastSeenAt: T0, stability: null, difficulty: null, dueAt: null },
    '錯的次數比看過的次數還多': {
      seen: 1,
      lapses: 5,
      lastSeenAt: T0,
      stability: null,
      difficulty: null,
      dueAt: null,
    },
    // NaN 不列在這裡：JSON.stringify 會把它變成 null，而 null 是合法值，
    // 所以那個情況從 localStorage 進不來。
    'dueAt 不是數字': {
      seen: 1,
      lapses: 0,
      lastSeenAt: T0,
      stability: 1,
      difficulty: 0.3,
      dueAt: 'soon',
    },
    '時間戳是負的': { seen: 1, lapses: 0, lastSeenAt: -5, stability: null, difficulty: null, dueAt: null },
    '不是物件': 42,
  };

  for (const [name, value] of Object.entries(broken)) {
    it(name, () => {
      expect(readReviewBook(JSON.stringify({ v001: value }))).toEqual(EMPTY_REVIEW_BOOK);
    });
  }
});

describe('localStorage 實作的細節', () => {
  it('key 帶玩家 id，也跟局面的存檔分開', () => {
    expect(reviewKey('a')).not.toBe(reviewKey('b'));
    expect(reviewKey('local')).not.toContain('save');
  });

  it('storage 一碰就丟例外時，回空的而不是往上炸', async () => {
    const hostile = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
      removeItem() {
        throw new Error('SecurityError');
      },
    } as unknown as Storage;

    const repository = createLocalStorageReviewRepository(hostile);
    expect(await repository.load('local')).toEqual(EMPTY_REVIEW_BOOK);
    await expect(repository.save('local', answered('v001', true))).resolves.toBeUndefined();
    await expect(repository.clear('local')).resolves.toBeUndefined();
  });
});

/** 這是複習池唯一真正要成立的行為：答錯的字，下次會先回來找你。 */
describe('跨 session 的複習', () => {
  it('這一場答錯，關掉再開，那個字排在最前面', async () => {
    const repository = createMemoryReviewRepository();
    await repository.save('local', answered('v007', false, T0));

    const book = await repository.load('local');
    expect(book.v007.dueAt).not.toBeNull();
    expect(book.v007.dueAt!).toBeGreaterThan(T0);
    expect(book.v007.lapses).toBe(1);
  });
});
