import { describe, expect, it } from 'vitest';

import { KeyedQueue } from './keyed-queue.ts';

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
  it('runs one job per key at a time, in order, and keys independently', async () => {
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
    expect(log).toEqual(['start a1', 'start b1']);
    expect(queue.isBusy('a')).toBe(true);
    expect(queue.running('a')).toBe('a1');
    expect(queue.waiting('a')).toEqual(['a2']);
    expect(queue.all().toSorted((left, right) => left.localeCompare(right))).toEqual([
      'a1',
      'a2',
      'b1',
    ]);

    gates.get('a1')?.open();
    await settle();
    expect(log).toEqual(['start a1', 'start b1', 'end a1', 'start a2']);
    gates.get('a2')?.open();
    gates.get('b1')?.open();
    await queue.idle();
    await settle();
    expect(queue.isBusy('a')).toBe(false);
    expect(queue.all()).toEqual([]);
  });

  it('bounds the waiting jobs and lets them be removed', async () => {
    const opened = gate();
    const ran: number[] = [];
    const queue = new KeyedQueue<string, number>(async (job) => {
      ran.push(job);
      await opened.promise;
    }, 2);
    expect([1, 2, 3, 4].map((job) => queue.enqueue('k', job))).toEqual([true, true, true, false]);
    expect(queue.isFull('k')).toBe(true);
    expect(queue.remove('k', (job) => job === 2)).toEqual([2]);
    expect(queue.waiting('k')).toEqual([3]);
    opened.open();
    await settle();
    await queue.idle();
    await settle();
    expect(ran).toEqual([1, 3]);
  });

  it('starts the next job after one fails', async () => {
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
    expect(ran).toEqual(['bad', 'good']);
  });

  it('refuses a negative bound', () => {
    expect(() => new KeyedQueue(idleRunner, -1)).toThrow(RangeError);
  });
});
