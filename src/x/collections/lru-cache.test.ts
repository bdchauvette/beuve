import { describe, expect, it } from 'vitest';

import { LruCache } from './lru-cache.ts';

describe('LruCache', () => {
  it('evicts the least recently used entry when over capacity', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1).set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.has('b')).toBe(false);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('treats overwriting a key as a use', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1).set('b', 2).set('a', 10).set('c', 3);
    expect(cache.get('a')).toBe(10);
    expect(cache.has('b')).toBe(false);
  });

  it('stores undefined values distinctly from missing keys', () => {
    const cache = new LruCache<string, number | undefined>(1);
    cache.set('a', undefined);
    expect(cache.has('a')).toBe(true);
    expect(cache.get('a')).toBeUndefined();
  });

  it('deletes and clears', () => {
    const cache = new LruCache<string, number>(3);
    cache.set('a', 1).set('b', 2);
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it.each([0, -1, 1.5, NaN])('rejects capacity %s', (capacity) => {
    expect(() => new LruCache(capacity)).toThrow(RangeError);
  });
});
