import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { CoalescingCache } from './coalescing-cache.ts';

/** A computation that settles only when released, or answers `'aborted'` when its signal aborts. */
interface HeldComputation {
  readonly compute: (signal: AbortSignal) => Promise<string>;
  readonly starts: () => number;
  readonly signals: readonly AbortSignal[];
  readonly release: (value: string) => void;
}

function heldComputation(): HeldComputation {
  const signals: AbortSignal[] = [];
  const held = Promise.withResolvers<string>();
  return {
    compute: async (signal): Promise<string> => {
      signals.push(signal);
      const aborted = new Promise<string>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            resolve('aborted');
          },
          { once: true },
        );
      });
      return Promise.race([held.promise, aborted]);
    },
    starts: (): number => signals.length,
    signals,
    release: (value): void => {
      held.resolve(value);
    },
  };
}

function immediate(value: string): (signal: AbortSignal) => Promise<string> {
  return async (): Promise<string> => {
    await Promise.resolve();
    return value;
  };
}

async function failing(): Promise<string> {
  await Promise.resolve();
  throw new Error('boom');
}

describe('CoalescingCache', () => {
  test('computes a key once and answers later gets from what it kept', async ({
    expect,
    signal,
  }) => {
    const cache = new CoalescingCache<string, string>({ maxEntries: 4 });
    const held = heldComputation();
    const first = cache.get('a', held.compute, { signal });
    const second = cache.get('a', held.compute, { signal });
    held.release('one');
    await expect(Promise.all([first, second])).resolves.toStrictEqual(['one', 'one']);
    await expect(cache.get('a', immediate('two'), { signal })).resolves.toBe('one');
    expect(held.starts()).toBe(1);
  });

  test('a waiter that gives up stops waiting, and the computation goes on for the others', async ({
    expect,
    signal,
  }) => {
    const cache = new CoalescingCache<string, string>({ maxEntries: 4 });
    const held = heldComputation();
    const leaving = new AbortController();
    const left = cache.get('a', held.compute, {
      signal: AbortSignal.any([signal, leaving.signal]),
    });
    const staying = cache.get('a', held.compute, { signal });
    leaving.abort();
    await expect(left).resolves.toBe('aborted');
    expect(held.signals.map((computing) => computing.aborted)).toStrictEqual([false]);
    held.release('done');
    await expect(staying).resolves.toBe('done');
    await expect(cache.get('a', immediate('again'), { signal })).resolves.toBe('done');
  });

  test('the last waiter to give up aborts the computation, which is not kept', async ({
    expect,
    signal,
  }) => {
    const cache = new CoalescingCache<string, string>({ maxEntries: 4 });
    const held = heldComputation();
    const first = new AbortController();
    const second = new AbortController();
    const waitingFirst = cache.get('a', held.compute, {
      signal: AbortSignal.any([signal, first.signal]),
    });
    const waitingSecond = cache.get('a', held.compute, {
      signal: AbortSignal.any([signal, second.signal]),
    });
    first.abort();
    await expect(waitingFirst).resolves.toBe('aborted');
    expect(held.signals[0]?.aborted).toBe(false);
    second.abort();
    await expect(waitingSecond).resolves.toBe('aborted');
    expect(held.signals[0]?.aborted).toBe(true);
    await expect(cache.get('a', immediate('fresh'), { signal })).resolves.toBe('fresh');
    expect(cache.size).toBe(1);
  });

  test('a waiter without a signal keeps the computation alive', async ({ expect, signal }) => {
    const cache = new CoalescingCache<string, string>({ maxEntries: 4 });
    const held = heldComputation();
    const leaving = new AbortController();
    // eslint-disable-next-line local/forward-abort-signal -- the waiter without a signal is the case under test
    const anchored = cache.get('a', held.compute);
    const left = cache.get('a', held.compute, {
      signal: AbortSignal.any([signal, leaving.signal]),
    });
    leaving.abort();
    await expect(left).resolves.toBe('aborted');
    expect(held.signals[0]?.aborted).toBe(false);
    held.release('kept');
    await expect(anchored).resolves.toBe('kept');
  });

  test('starts nothing for an already aborted signal', async ({ expect, signal }) => {
    const cache = new CoalescingCache<string, string>({ maxEntries: 4 });
    const held = heldComputation();
    const aborted = AbortSignal.any([signal, AbortSignal.abort()]);
    await expect(cache.get('a', held.compute, { signal: aborted })).resolves.toBe('aborted');
    expect(held.starts()).toBe(0);
  });

  test('keeps only the values `keep` accepts', async ({ expect, signal }) => {
    const cache = new CoalescingCache<string, string>({
      maxEntries: 4,
      keep: (value): boolean => value !== 'failed',
    });
    await expect(cache.get('a', immediate('failed'), { signal })).resolves.toBe('failed');
    await expect(cache.get('a', immediate('ok'), { signal })).resolves.toBe('ok');
    await expect(cache.get('a', immediate('later'), { signal })).resolves.toBe('ok');
  });

  test('evicts the least recently used past its count or weight', async ({ expect, signal }) => {
    const cache = new CoalescingCache<string, string>({
      maxEntries: 3,
      maxWeight: 10,
      weigh: (value): number => value.length,
    });
    const put = async (key: string, value: string): Promise<string> =>
      cache.get(key, immediate(value), { signal });
    await put('a', 'aaaa');
    await put('b', 'bbbb');
    await put('a', 'unused');
    await put('c', 'cccc');
    expect(cache.weight).toBe(8);
    await expect(put('b', 'recomputed')).resolves.toBe('recomputed');
    expect(cache.size).toBe(1);
    await put('heavy', 'x'.repeat(11));
    expect(cache.size).toBe(1);
    await put('d', 'd');
    await put('e', 'e');
    await put('f', 'f');
    expect(cache.size).toBe(3);
  });

  test('a rejection reaches its waiters and is not kept', async ({ expect, signal }) => {
    const cache = new CoalescingCache<string, string>({ maxEntries: 4 });
    await expect(cache.get('a', failing, { signal })).rejects.toThrow('boom');
    await expect(cache.get('a', immediate('ok'), { signal })).resolves.toBe('ok');
  });

  test('delete drops a kept value, and keeps a computation in flight from being kept', async ({
    expect,
    signal,
  }) => {
    const cache = new CoalescingCache<string, string>({ maxEntries: 4 });
    await cache.get('a', immediate('old'), { signal });
    cache.delete('a');
    const held = heldComputation();
    const computing = cache.get('b', held.compute, { signal });
    cache.delete('b');
    held.release('late');
    await expect(computing).resolves.toBe('late');
    await expect(cache.get('a', immediate('new'), { signal })).resolves.toBe('new');
    await expect(cache.get('b', immediate('fresh'), { signal })).resolves.toBe('fresh');
  });
});
