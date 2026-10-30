import { describe } from 'vitest';

import { LruCache } from './lru-cache.ts';
import { test } from '#testing/test.ts';

describe('LruCache', () => {
  test('evicts the least recently used entry when over capacity', ({ expect }) => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1).set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.has('b')).toBe(false);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  test('treats overwriting a key as a use', ({ expect }) => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1).set('b', 2).set('a', 10).set('c', 3);
    expect(cache.get('a')).toBe(10);
    expect(cache.has('b')).toBe(false);
  });

  test('stores undefined values distinctly from missing keys', ({ expect }) => {
    const cache = new LruCache<string, number | undefined>(1);
    cache.set('a', undefined);
    expect(cache.has('a')).toBe(true);
    expect(cache.get('a')).toBeUndefined();
  });

  test('computes a missing entry once and counts a hit as a use', ({ expect }) => {
    const cache = new LruCache<string, number>(2);
    const calls: string[] = [];
    const compute = (key: string, value: number): (() => number) => {
      return (): number => {
        calls.push(key);
        return value;
      };
    };

    expect(cache.getOrInsertComputed('a', compute('a', 1))).toBe(1);
    expect(cache.getOrInsertComputed('b', compute('b', 2))).toBe(2);
    expect(cache.getOrInsertComputed('a', compute('a', 9))).toBe(1);
    cache.set('c', 3);

    expect(calls).toStrictEqual(['a', 'b']);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
  });

  test('deletes and clears', ({ expect }) => {
    const cache = new LruCache<string, number>(3);
    cache.set('a', 1).set('b', 2);
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  test.for([0, -1, 1.5, NaN])('rejects capacity %s', (capacity, { expect }) => {
    expect(() => new LruCache(capacity)).toThrow(RangeError);
  });
});
