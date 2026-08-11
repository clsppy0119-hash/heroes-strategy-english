import { describe, expect, it } from 'vitest';

import { nextFloat, nextInt, seedFrom, shuffle } from './rng';

describe('seedFrom', () => {
  it('同樣的字串給同樣的種子', () => {
    expect(seedFrom('battle-1')).toBe(seedFrom('battle-1'));
  });

  it('不同字串給不同種子', () => {
    expect(seedFrom('battle-1')).not.toBe(seedFrom('battle-2'));
  });
});

describe('nextFloat', () => {
  it('同樣的狀態給同樣的值', () => {
    expect(nextFloat(42)).toEqual(nextFloat(42));
  });

  it('值落在 [0,1)', () => {
    let state = seedFrom('range-check');
    for (let i = 0; i < 500; i += 1) {
      const [value, next] = nextFloat(state);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      state = next;
    }
  });
});

describe('nextInt', () => {
  it('值落在 [0, maxExclusive)', () => {
    let state = seedFrom('int-range');
    for (let i = 0; i < 500; i += 1) {
      const [value, next] = nextInt(state, 4);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(4);
      expect(Number.isInteger(value)).toBe(true);
      state = next;
    }
  });

  it('四個值都出得來，不會卡在同一個', () => {
    const seen = new Set<number>();
    let state = seedFrom('coverage');
    for (let i = 0; i < 200; i += 1) {
      const [value, next] = nextInt(state, 4);
      seen.add(value);
      state = next;
    }
    expect(seen.size).toBe(4);
  });

  it('maxExclusive 不合法時丟錯', () => {
    expect(() => nextInt(1, 0)).toThrow(RangeError);
    expect(() => nextInt(1, 2.5)).toThrow(RangeError);
  });
});

describe('shuffle', () => {
  it('同樣的狀態給同樣的排列', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const [first] = shuffle(items, 123);
    const [second] = shuffle(items, 123);
    expect(first).toEqual(second);
  });

  it('不改動輸入陣列', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    shuffle(items, 123);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('保留全部元素', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const [shuffled] = shuffle(items, seedFrom('keep-all'));
    expect([...shuffled].sort()).toEqual([...items].sort());
  });
});
