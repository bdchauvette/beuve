import { describe } from 'vitest';

import { KeyedQueue } from './keyed-queue.ts';
import { test } from '#testing/test.ts';

interface Gate {
  readonly promise: Promise<boolean>;
  readonly open: () => void;
}

function gate(): Gate {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  return {
    promise,
    open: (): void => {
      resolve(true);
    },
  };
}

async function idleRunner(): Promise<void> {
  await Promise.resolve();
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) {
    await Promise.resolve();
  }
}

describe('KeyedQueue', () => {
  test('runs one job per key at a time, in order, and keys independently', async ({ expect }) => {
    const gates = new Map<string, Gate>();
    const log: string[] = [];
    const queue = new KeyedQueue<string, string>(async (job) => {
      log.push(`start ${job}`);
      const opened = gate();
      gates.set(job, opened);
      await opened.promise;
      log.push(`end ${job}`);
    }, 10);

    queue.enqueue('a', 'a1');
    queue.enqueue('a', 'a2');
    queue.enqueue('b', 'b1');
    expect(log).toStrictEqual(['start a1', 'start b1']);
    expect(queue.isBusy('a')).toBe(true);
    expect(queue.running('a')).toBe('a1');
    expect(queue.waiting('a')).toStrictEqual(['a2']);
    expect(queue.all().toSorted((left, right) => left.localeCompare(right))).toStrictEqual([
      'a1',
      'a2',
      'b1',
    ]);

    gates.get('a1')?.open();
    await settle();
    expect(log).toStrictEqual(['start a1', 'start b1', 'end a1', 'start a2']);
    gates.get('a2')?.open();
    gates.get('b1')?.open();
    await queue.idle();
    await settle();
    expect(queue.isBusy('a')).toBe(false);
    expect(queue.all()).toStrictEqual([]);
  });

  test('bounds the waiting jobs and lets them be removed', async ({ expect }) => {
    const opened = gate();
    const ran: number[] = [];
    const queue = new KeyedQueue<string, number>(async (job) => {
      ran.push(job);
      await opened.promise;
    }, 2);
    expect([1, 2, 3, 4].map((job) => queue.enqueue('k', job))).toStrictEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(queue.isFull('k')).toBe(true);
    expect(queue.remove('k', (job) => job === 2)).toStrictEqual([2]);
    expect(queue.waiting('k')).toStrictEqual([3]);
    opened.open();
    await settle();
    await queue.idle();
    await settle();
    expect(ran).toStrictEqual([1, 3]);
  });

  test('starts the next job after one fails', async ({ expect }) => {
    const ran: string[] = [];
    const queue = new KeyedQueue<string, string>(async (job) => {
      ran.push(job);
      if (job === 'bad') {
        throw new Error('boom');
      }
      await Promise.resolve();
    }, 5);
    queue.enqueue('k', 'bad');
    queue.enqueue('k', 'good');
    await settle();
    await queue.idle();
    expect(ran).toStrictEqual(['bad', 'good']);
  });

  test('refuses a negative bound', ({ expect }) => {
    expect(() => new KeyedQueue(idleRunner, -1)).toThrow(RangeError);
  });
});
